"""
roster_generator.py — fair, rotating weekly staff roster generator for a creche.

Reads and writes a single Excel workbook (Roster_Planner.xlsx by default).
Input tabs (edited by the user): "How to use", "Staff", "Leave", "Settings", "History".
Output tabs (rebuilt on every run): one "Week N (dd Mon)" tab per week, plus "Checks".

Usage:
    python roster_generator.py --start 2026-09-28 --weeks 4 [--file Roster_Planner.xlsx]
                                [--out other.xlsx] [--commit]

Only depends on openpyxl (Python 3.10+).
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import math
import random
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
DAY_FULL = {"Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday", "Fri": "Friday"}
SLOTS = ["early", "mid1", "mid2", "late"]
SLOT_LABEL = {"early": "Early", "mid1": "Middle 1", "mid2": "Middle 2", "late": "Late"}

ROLE_ROTATING = "rotating"
ROLE_FIXED = "fixed"
ROLE_STATIC = "static"
ROLE_VACANT = "vacant"
ROLE_BLANK = "blank"
VALID_ROLES = {ROLE_ROTATING, ROLE_FIXED, ROLE_STATIC, ROLE_VACANT, ROLE_BLANK, ""}

LEAVE_TYPES = ["Holiday", "Maternity Leave", "Sick", "Other"]
FLOORS = {"down", "up", ""}

# Colours
COLOR_TITLE = "E0533A"
COLOR_OFF = "B5D56A"
COLOR_MATERNITY = "00B050"
COLOR_HOLIDAY = "D9502B"
COLOR_OTHER_LEAVE = "FFE699"
COLOR_OK = "C6EFCE"
COLOR_ISSUE = "FFC7CE"

# Soft-rule cost weights (tuned so hard rules dominate via feasibility of the
# search space; these only break ties among otherwise-valid partitions).
FLOOR_MIX_WEIGHT = 2.0
REPEAT_LAST_WEEK_WEIGHT = 1.5
DEVIATION_WEIGHT = 3.0
EMPTY_SLOT_WEIGHT = 5.0

EXHAUSTIVE_LIMIT = 150_000
LOCAL_SEARCH_RESTARTS = 30


class RosterInputError(Exception):
    """Raised for any problem with the data in the planner workbook."""


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass
class StaffMember:
    row: int
    name: str
    display_name: str
    role: str
    floor: str
    mon: str
    tue: str
    wed: str
    thu: str
    fri: str
    days_off: list[str]
    start_date: Optional[date]
    end_date: Optional[date]
    numbered: bool

    @property
    def label(self) -> str:
        return self.display_name or self.name

    def day_text(self, day: str) -> str:
        return {"Mon": self.mon, "Tue": self.tue, "Wed": self.wed, "Thu": self.thu, "Fri": self.fri}[day]


@dataclass
class Leave:
    name: str
    type: str
    from_date: date
    to_date: Optional[date]

    def covers(self, d: date) -> bool:
        if d < self.from_date:
            return False
        if self.to_date is not None and d > self.to_date:
            return False
        return True


@dataclass
class HistoryEntry:
    early: int = 0
    mid1: int = 0
    mid2: int = 0
    late: int = 0
    last_week_start: str = ""
    committed_through: Optional[date] = None

    def as_dict(self) -> dict:
        return {"early": self.early, "mid1": self.mid1, "mid2": self.mid2, "late": self.late}

    def average(self) -> float:
        return (self.early + self.mid1 + self.mid2 + self.late) / 4.0


DEFAULT_SETTINGS = {
    "early_start": "7:30",
    "late_start": "9:00",
    "mid1_start": "8:00",
    "mid2_start": "8:30",
    "people_early": 3,
    "people_late": 2,
    "shift_length": 9.0,
    "mix_floors": True,
    "break_text": "10 MINS",
}

SETTINGS_ROWS = [
    ("Early start time", "early_start", "7:30", ""),
    ("Late start time", "late_start", "9:00", ""),
    ("Middle start time 1", "mid1_start", "8:00", ""),
    ("Middle start time 2", "mid2_start", "8:30", ""),
    ("People at early start (incl. fixed)", "people_early", 3, ""),
    ("People at late start", "people_late", 2, ""),
    ("Shift length (hours)", "shift_length", 9, ""),
    ("Mix floors at each start time?", "mix_floors", "Yes", ""),
    ("Break text", "break_text", "10 MINS", ""),
]


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _clean(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_time_string(value) -> str:
    """Normalise a cell that may hold a datetime.time, datetime, or string into 'H:MM'."""
    if value is None or value == "":
        return ""
    if isinstance(value, time):
        return f"{value.hour}:{value.minute:02d}"
    if isinstance(value, datetime):
        return f"{value.hour}:{value.minute:02d}"
    s = str(value).strip()
    if not s:
        return ""
    s = s.replace(".", ":")
    try:
        parts = s.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        return f"{h}:{m:02d}"
    except (ValueError, IndexError):
        return s


def time_to_minutes(hm: str) -> int:
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def minutes_to_12h(total_minutes: int) -> str:
    total_minutes %= 24 * 60
    h = total_minutes // 60
    m = total_minutes % 60
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d}"


def shift_text(start_hm: str, shift_hours: float) -> str:
    start_min = time_to_minutes(start_hm)
    end_min = round(start_min + shift_hours * 60)
    return f"{minutes_to_12h(start_min)} – {minutes_to_12h(end_min)}"


def ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def format_week_range(monday: date) -> str:
    friday = monday + timedelta(days=4)
    if monday.month == friday.month:
        return (f"{ordinal(monday.day)} – {ordinal(friday.day)} "
                f"{monday.strftime('%B')} {monday.year}")
    return (f"{ordinal(monday.day)} {monday.strftime('%B')} – "
            f"{ordinal(friday.day)} {friday.strftime('%B')} {friday.year}")


def parse_date_cell(value, field_name: str, row: int) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise RosterInputError(f"Row {row}: could not parse {field_name} date '{value}'. Use YYYY-MM-DD.")


def parse_days_off(value, row: int) -> list[str]:
    if value is None or value == "":
        return []
    result = []
    for part in str(value).replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        matched = next((d for d in DAYS if d.lower() == part[:3].lower()), None)
        if matched is None:
            raise RosterInputError(
                f"Row {row}: invalid day off '{part}'. Use one of Mon, Tue, Wed, Thu, Fri."
            )
        result.append(matched)
    return result


# --------------------------------------------------------------------------
# Reading the workbook
# --------------------------------------------------------------------------

STAFF_HEADERS = [
    "Name", "Display name (optional)", "Role", "Floor",
    "Mon", "Tue", "Wed", "Thu", "Fri",
    "Days off (e.g. Thu)", "Start date", "End date", "Numbered row? (Yes/No)",
]
LEAVE_HEADERS = ["Name", "Type", "From", "To"]
HISTORY_HEADERS = ["Name", "Early", "Middle 1", "Middle 2", "Late", "Last week's start", "Committed through"]


def read_staff(ws: Worksheet) -> list[StaffMember]:
    staff: list[StaffMember] = []
    seen_names: set[str] = set()
    for row in range(2, ws.max_row + 1):
        name = _clean(ws.cell(row, 1).value)
        role = _clean(ws.cell(row, 3).value).lower()
        if not name and not role:
            continue
        if role not in VALID_ROLES:
            raise RosterInputError(
                f"Row {row}: unknown role '{role}'. Use rotating, fixed, static, vacant, or leave blank."
            )
        if role == ROLE_BLANK or (not name and role == ""):
            staff.append(StaffMember(
                row=row, name="", display_name="", role=ROLE_BLANK, floor="",
                mon="", tue="", wed="", thu="", fri="", days_off=[],
                start_date=None, end_date=None, numbered=False,
            ))
            continue
        if role != ROLE_VACANT:
            if not name:
                raise RosterInputError(f"Row {row}: missing a name for a '{role}' row.")
            if name in seen_names:
                raise RosterInputError(f"Row {row}: duplicate staff name '{name}'.")
            seen_names.add(name)
        floor = _clean(ws.cell(row, 4).value).lower()
        if floor not in FLOORS:
            raise RosterInputError(f"Row {row}: invalid floor '{floor}'. Use down or up.")
        mon = _clean(ws.cell(row, 5).value)
        tue = _clean(ws.cell(row, 6).value)
        wed = _clean(ws.cell(row, 7).value)
        thu = _clean(ws.cell(row, 8).value)
        fri = _clean(ws.cell(row, 9).value)
        if role in (ROLE_STATIC, ROLE_VACANT) and mon and not any([tue, wed, thu, fri]):
            tue = wed = thu = fri = mon
        days_off = parse_days_off(ws.cell(row, 10).value, row)
        start_date = parse_date_cell(ws.cell(row, 11).value, "Start date", row)
        end_date = parse_date_cell(ws.cell(row, 12).value, "End date", row)
        if start_date and end_date and end_date < start_date:
            raise RosterInputError(f"Row {row}: End date is before Start date.")
        numbered_raw = _clean(ws.cell(row, 13).value).lower()
        numbered = numbered_raw not in ("no", "n", "false", "0")
        display_name = _clean(ws.cell(row, 2).value)
        staff.append(StaffMember(
            row=row, name=name, display_name=display_name, role=role, floor=floor,
            mon=mon, tue=tue, wed=wed, thu=thu, fri=fri, days_off=days_off,
            start_date=start_date, end_date=end_date, numbered=numbered,
        ))
    return staff


def read_leave(ws: Worksheet, staff_names: set[str]) -> list[Leave]:
    leaves: list[Leave] = []
    for row in range(2, ws.max_row + 1):
        name = _clean(ws.cell(row, 1).value)
        leave_type = _clean(ws.cell(row, 2).value)
        if not name and not leave_type:
            continue
        if not name:
            raise RosterInputError(f"Leave row {row}: missing a name.")
        if name not in staff_names:
            raise RosterInputError(f"Leave row {row}: '{name}' is not in the Staff tab.")
        if not leave_type:
            leave_type = "Other"
        from_date = parse_date_cell(ws.cell(row, 3).value, "From", row)
        if from_date is None:
            raise RosterInputError(f"Leave row {row}: missing a From date.")
        to_date = parse_date_cell(ws.cell(row, 4).value, "To", row)
        if to_date and to_date < from_date:
            raise RosterInputError(f"Leave row {row}: To date is before From date.")
        leaves.append(Leave(name=name, type=leave_type, from_date=from_date, to_date=to_date))
    return leaves


def read_settings(ws: Worksheet) -> dict:
    label_to_key = {label: key for label, key, _, _ in SETTINGS_ROWS}
    settings = dict(DEFAULT_SETTINGS)
    for row in range(1, ws.max_row + 1):
        label = _clean(ws.cell(row, 1).value)
        key = label_to_key.get(label)
        if key is None:
            continue
        raw = ws.cell(row, 2).value
        if key in ("early_start", "late_start", "mid1_start", "mid2_start"):
            settings[key] = parse_time_string(raw) or settings[key]
        elif key in ("people_early", "people_late"):
            settings[key] = int(raw) if raw not in (None, "") else settings[key]
        elif key == "shift_length":
            settings[key] = float(raw) if raw not in (None, "") else settings[key]
        elif key == "mix_floors":
            settings[key] = _clean(raw).lower() not in ("no", "false", "0") if raw not in (None, "") else settings[key]
        elif key == "break_text":
            settings[key] = _clean(raw) or settings[key]
    return settings


def read_history(ws: Worksheet) -> dict[str, HistoryEntry]:
    history: dict[str, HistoryEntry] = {}
    for row in range(2, ws.max_row + 1):
        name = _clean(ws.cell(row, 1).value)
        if not name:
            continue
        entry = HistoryEntry(
            early=int(ws.cell(row, 2).value or 0),
            mid1=int(ws.cell(row, 3).value or 0),
            mid2=int(ws.cell(row, 4).value or 0),
            late=int(ws.cell(row, 5).value or 0),
            last_week_start=_clean(ws.cell(row, 6).value),
            committed_through=parse_date_cell(ws.cell(row, 7).value, "Committed through", row),
        )
        history[name] = entry
    return history


# --------------------------------------------------------------------------
# Template creation
# --------------------------------------------------------------------------

DEFAULT_STAFF_ROWS = [
    # name, display, role, floor, mon, tue, wed, thu, fri, days_off, start, end, numbered
    ("Sue", "", "static", "", "8:30 – 1:30", "", "", "", "", "Thu", "", "", "Yes"),
    ("Hanny", "", "rotating", "down", "", "", "", "", "", "", "", "", "Yes"),
    ("", "", "vacant", "", "8:30 – 5:30", "", "", "", "", "", "", "", "Yes"),
    ("Manuel", "", "rotating", "down", "", "", "", "", "", "", "", "", "Yes"),
    ("Irene", "", "rotating", "down", "", "", "", "", "", "", "", "", "Yes"),
    ("Deoshree", "", "rotating", "down", "", "", "", "", "", "", "", "", "Yes"),
    ("Sandrine", "", "rotating", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("Daniel", "", "rotating", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("Arantza", "", "rotating", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("David", "", "rotating", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("Usha", "", "rotating", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("", "", "blank", "", "", "", "", "", "", "", "", "", "No"),
    ("", "", "blank", "", "", "", "", "", "", "", "", "", "No"),
    ("", "", "blank", "", "", "", "", "", "", "", "", "", "No"),
    ("Eirini", "", "static", "", "8:30 – 5:30", "", "", "", "", "", "", "", "No"),
    ("Megan", "", "static", "", "8:30 – 5:30", "", "", "", "", "", "", "", "Yes"),
    ("Jason", "", "fixed", "up", "", "", "", "", "", "", "", "", "Yes"),
    ("Shehnaz", "Shehnaz 7:30", "static", "", "7:30 – 4:30", "", "", "", "", "", "", "", "Yes"),
    ("Priscilla", "", "static", "", "10:00 – 2:00", "10:00 – 6:00", "10:00 – 6:00",
     "10:00 – 6:00", "10:00 – 6:00", "", "", "", "Yes"),
    ("Laura", "", "static", "", "9:00 – 1:00", "", "", "", "", "", "", "", "Yes"),
]

DEFAULT_LEAVE_ROWS = [
    ("Eirini", "Maternity Leave", "2026-09-21", ""),
    ("Shehnaz", "Holiday", "2026-09-21", "2026-09-25"),
]

HOW_TO_USE_TEXT = [
    "Roster Planner — how to use this workbook",
    "",
    "1. Fill in the 'Staff' tab: one row per person, in the order you want them printed.",
    "   Role is one of: rotating, fixed, static, vacant, or leave blank for a spacer row.",
    "     - rotating: shares the four start times (early/mid1/mid2/late) via the rotation.",
    "     - fixed: always works the early start time when scheduled.",
    "     - static: works their own typed hours (fill the Mon column; add more days only",
    "       if the hours differ from Monday).",
    "     - vacant: an empty post that still shows shifts, with no name.",
    "   Floor is 'down' or 'up' (used to mix floors across each start time).",
    "   Days off is a permanent weekly day off, e.g. 'Thu'.",
    "   Start date / End date control joiners and leavers; leave blank if not relevant.",
    "   Numbered row? controls whether the row gets a number in the printed roster.",
    "",
    "2. Fill in the 'Leave' tab for holiday, maternity, sick, or other leave.",
    "   The 'To' column can be left blank for open-ended leave.",
    "",
    "3. Adjust 'Settings' if your start times, staffing numbers, or shift length differ.",
    "",
    "4. Do not edit 'History' by hand — it is updated automatically when you run the",
    "   generator with --commit.",
    "",
    "5. Run: python roster_generator.py --start YYYY-MM-DD --weeks N --commit",
    "   The Monday date is required for --start. Add --commit to save fairness history;",
    "   without it you can preview a roster without affecting future rotations.",
    "",
    "6. The generator rebuilds the 'Week N (dd Mon)' tabs and the 'Checks' tab every run",
    "   — don't edit those tabs by hand, your edits will be overwritten.",
]


def create_template(path: str) -> None:
    wb = Workbook()
    wb.remove(wb.active)

    ws = wb.create_sheet("How to use")
    for i, line in enumerate(HOW_TO_USE_TEXT, start=1):
        ws.cell(i, 1, line)
    ws.column_dimensions["A"].width = 100
    ws.cell(1, 1).font = Font(bold=True, size=14)

    ws = wb.create_sheet("Staff")
    for c, header in enumerate(STAFF_HEADERS, start=1):
        cell = ws.cell(1, c, header)
        cell.font = Font(bold=True)
    for r, row_data in enumerate(DEFAULT_STAFF_ROWS, start=2):
        for c, value in enumerate(row_data, start=1):
            ws.cell(r, c, value)
    widths = [14, 20, 10, 8, 16, 16, 16, 16, 16, 16, 12, 12, 14]
    for c, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = w
    last_row = 1 + len(DEFAULT_STAFF_ROWS) + 20
    _add_dropdown(ws, "C2:C{}".format(last_row), '"rotating,fixed,static,vacant"')
    _add_dropdown(ws, "D2:D{}".format(last_row), '"down,up"')
    _add_dropdown(ws, "M2:M{}".format(last_row), '"Yes,No"')

    ws = wb.create_sheet("Leave")
    for c, header in enumerate(LEAVE_HEADERS, start=1):
        ws.cell(1, c, header).font = Font(bold=True)
    for r, row_data in enumerate(DEFAULT_LEAVE_ROWS, start=2):
        for c, value in enumerate(row_data, start=1):
            ws.cell(r, c, value)
    for c, w in enumerate([14, 16, 14, 14], start=1):
        ws.column_dimensions[get_column_letter(c)].width = w
    staff_names = [row[0] for row in DEFAULT_STAFF_ROWS if row[0] and row[2] != "blank"]
    name_list_formula = "Staff!$A$2:$A${}".format(1 + len(DEFAULT_STAFF_ROWS))
    _add_dropdown(ws, "A2:A50", name_list_formula, formula1_is_range=True)
    _add_dropdown(ws, "B2:B50", '"{}"'.format(",".join(LEAVE_TYPES)))

    ws = wb.create_sheet("Settings")
    for r, (label, _key, value, note) in enumerate(SETTINGS_ROWS, start=1):
        ws.cell(r, 1, label)
        ws.cell(r, 2, value)
        ws.cell(r, 3, note)
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 30

    ws = wb.create_sheet("History")
    for c, header in enumerate(HISTORY_HEADERS, start=1):
        ws.cell(1, c, header).font = Font(bold=True)
    for c, w in enumerate([16, 8, 10, 10, 8, 16, 16], start=1):
        ws.column_dimensions[get_column_letter(c)].width = w

    wb.save(path)


def _add_dropdown(ws: Worksheet, cell_range: str, formula1: str, formula1_is_range: bool = False) -> None:
    dv = DataValidation(type="list", formula1=formula1, allow_blank=True, showErrorMessage=False)
    ws.add_data_validation(dv)
    dv.add(cell_range)


# --------------------------------------------------------------------------
# Roster algorithm
# --------------------------------------------------------------------------

def is_employed(person: StaffMember, d: date) -> bool:
    if person.start_date and d < person.start_date:
        return False
    if person.end_date and d > person.end_date:
        return False
    return True


def is_permanent_day_off(person: StaffMember, day: str) -> bool:
    return day in person.days_off


def on_leave(name: str, d: date, leaves: list[Leave]) -> Optional[Leave]:
    for lv in leaves:
        if lv.name == name and lv.covers(d):
            return lv
    return None


def scheduled_days(person: StaffMember, week_dates: dict[str, date]) -> list[str]:
    return [day for day, d in week_dates.items() if is_employed(person, d) and not is_permanent_day_off(person, day)]


def _default_history_entry() -> HistoryEntry:
    return HistoryEntry()


def _joiner_starting_history(history: dict[str, HistoryEntry]) -> HistoryEntry:
    if not history:
        return HistoryEntry()
    totals = {slot: 0 for slot in SLOTS}
    for entry in history.values():
        for slot in SLOTS:
            totals[slot] += getattr(entry, slot)
    n = len(history)
    return HistoryEntry(**{slot: round(totals[slot] / n) for slot in SLOTS})


def compute_target_sizes(n_present: int, fixed_present_count: int, people_early: int, people_late: int) -> dict[str, int]:
    early_needed = max(0, people_early - fixed_present_count)
    early_needed = min(early_needed, n_present)
    remaining = n_present - early_needed
    late_needed = min(people_late, remaining)
    remaining -= late_needed
    mid1 = -(-remaining // 2)  # ceil -> larger group to 08:00
    mid2 = remaining // 2
    return {"early": early_needed, "late": late_needed, "mid1": mid1, "mid2": mid2}


def _multinomial_estimate(n: int, sizes: dict[str, int]) -> int:
    remaining = n
    est = 1
    for slot in SLOTS:
        est *= math.comb(remaining, sizes[slot])
        remaining -= sizes[slot]
    return est


def _tie_break_score(assignment: dict[str, list[str]], salt: str) -> float:
    """A deterministic, slot-order-independent pseudo-random score used only to break
    exact cost ties. Without this, exhaustive search's fixed enumeration order (early,
    then late, then mid1, with mid2 always the leftover) would systematically favour
    earlier-enumerated slots whenever costs tie, which happens often and would bias
    fairness away from whichever slot is enumerated last."""
    parts = [salt]
    for slot in SLOTS:
        parts.append(slot + ":" + ",".join(sorted(assignment[slot])))
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16) / 16 ** 12


def partition_search(people: list[str], sizes: dict[str, int], cost_fn, salt: str = "") -> dict[str, list[str]]:
    people_sorted = sorted(people)
    n = len(people_sorted)
    if n == 0:
        return {slot: [] for slot in SLOTS}
    est = _multinomial_estimate(n, sizes)
    if est <= EXHAUSTIVE_LIMIT:
        return _exhaustive_partition(people_sorted, sizes, cost_fn, salt)
    return _local_search_partition(people_sorted, sizes, cost_fn, salt)


def _exhaustive_partition(people_sorted: list[str], sizes: dict[str, int], cost_fn, salt: str) -> dict[str, list[str]]:
    best_key = (math.inf, math.inf)
    best_assignment: Optional[dict[str, list[str]]] = None
    all_set = people_sorted
    for early_combo in itertools.combinations(all_set, sizes["early"]):
        early_set = set(early_combo)
        rest1 = [p for p in all_set if p not in early_set]
        for late_combo in itertools.combinations(rest1, sizes["late"]):
            late_set = set(late_combo)
            rest2 = [p for p in rest1 if p not in late_set]
            for mid1_combo in itertools.combinations(rest2, sizes["mid1"]):
                mid1_set = set(mid1_combo)
                mid2_combo = tuple(p for p in rest2 if p not in mid1_set)
                assignment = {
                    "early": list(early_combo),
                    "late": list(late_combo),
                    "mid1": list(mid1_combo),
                    "mid2": list(mid2_combo),
                }
                cost = cost_fn(assignment)
                key = (cost, _tie_break_score(assignment, salt))
                if key < best_key:
                    best_key = key
                    best_assignment = assignment
    return best_assignment if best_assignment is not None else {slot: [] for slot in SLOTS}


def _local_search_partition(people_sorted: list[str], sizes: dict[str, int], cost_fn, salt: str) -> dict[str, list[str]]:
    rng = random.Random(0)
    best_key = (math.inf, math.inf)
    best_assignment: Optional[dict[str, list[str]]] = None

    for _ in range(LOCAL_SEARCH_RESTARTS):
        shuffled = people_sorted.copy()
        rng.shuffle(shuffled)
        assignment: dict[str, list[str]] = {}
        idx = 0
        for slot in SLOTS:
            k = sizes[slot]
            assignment[slot] = shuffled[idx:idx + k]
            idx += k
        current_cost = cost_fn(assignment)

        improved = True
        iterations = 0
        while improved and iterations < 1000:
            improved = False
            iterations += 1
            best_swap = None
            best_swap_cost = current_cost
            slots_list = SLOTS
            for i, slot_a in enumerate(slots_list):
                for slot_b in slots_list[i + 1:]:
                    for a in assignment[slot_a]:
                        for b in assignment[slot_b]:
                            trial = {s: list(v) for s, v in assignment.items()}
                            trial[slot_a] = [b if x == a else x for x in trial[slot_a]]
                            trial[slot_b] = [a if x == b else x for x in trial[slot_b]]
                            trial_cost = cost_fn(trial)
                            if trial_cost < best_swap_cost - 1e-9:
                                best_swap_cost = trial_cost
                                best_swap = trial
            if best_swap is not None:
                assignment = best_swap
                current_cost = best_swap_cost
                improved = True

        key = (current_cost, _tie_break_score(assignment, salt))
        if key < best_key:
            best_key = key
            best_assignment = assignment

    return best_assignment if best_assignment is not None else {slot: [] for slot in SLOTS}


def make_cost_fn(history: dict[str, HistoryEntry], last_week_map: dict[str, str],
                  floors: dict[str, str], mix_floors: bool, fixed_floors_early: list[str],
                  base_map: Optional[dict[str, str]] = None,
                  use_repeat_penalty: bool = True) -> "callable":
    def cost_fn(assignment: dict[str, list[str]]) -> float:
        total = 0.0
        total_people = sum(len(v) for v in assignment.values())
        for slot in SLOTS:
            members = assignment[slot]
            for p in members:
                entry = history.get(p) or HistoryEntry()
                avg = entry.average()
                total += getattr(entry, slot) - avg
                if use_repeat_penalty and last_week_map.get(p) == slot:
                    total += REPEAT_LAST_WEEK_WEIGHT
                if base_map is not None and base_map.get(p) is not None and base_map.get(p) != slot:
                    total += DEVIATION_WEIGHT
            group_floors = [floors.get(p) for p in members if floors.get(p)]
            if slot == "early":
                group_floors += [f for f in fixed_floors_early if f]
            if mix_floors and len(group_floors) >= 2 and len(set(group_floors)) < 2:
                total += FLOOR_MIX_WEIGHT
            if slot in ("mid1", "mid2") and len(members) == 0 and total_people > 0:
                total += EMPTY_SLOT_WEIGHT
        return total
    return cost_fn


@dataclass
class WeekResult:
    monday: date
    week_dates: dict[str, date]
    day_assignments: dict[str, dict[str, list[str]]]  # day -> slot -> [rotating names]
    fixed_by_day: dict[str, list[str]]  # day -> [fixed names present]
    base_map: dict[str, str]
    warnings: list[str] = field(default_factory=list)


def build_week(staff: list[StaffMember], leaves: list[Leave], settings: dict,
                history: dict[str, HistoryEntry], monday: date) -> WeekResult:
    week_dates = {day: monday + timedelta(days=i) for i, day in enumerate(DAYS)}
    rotating = [s for s in staff if s.role == ROLE_ROTATING]
    fixed = [s for s in staff if s.role == ROLE_FIXED]
    floors = {s.name: s.floor for s in staff}
    warnings: list[str] = []

    pool_names = [s.name for s in rotating if len(scheduled_days(s, week_dates)) >= 1]
    for name in pool_names:
        if name not in history:
            history[name] = _joiner_starting_history(history)
    fixed_work_days = {s.name: scheduled_days(s, week_dates) for s in fixed}
    fixed_present_base_count = sum(1 for s in fixed if len(fixed_work_days[s.name]) >= 3)
    fixed_floors_base = [s.floor for s in fixed if len(fixed_work_days[s.name]) >= 3]
    for s in fixed:
        if s.name not in history:
            history[s.name] = _joiner_starting_history(history)

    people_early = settings["people_early"]
    people_late = settings["people_late"]
    mix_floors = settings["mix_floors"]

    last_week_map = {name: history[name].last_week_start for name in pool_names}

    base_sizes = compute_target_sizes(len(pool_names), fixed_present_base_count, people_early, people_late)
    needed_total = (people_early - fixed_present_base_count) + people_late
    if needed_total > len(pool_names):
        warnings.append(
            f"Week of {monday.isoformat()}: not enough rotating staff to fully cover early+late "
            f"(need {max(needed_total, 0)}, have {len(pool_names)})."
        )
    base_cost_fn = make_cost_fn(history, last_week_map, floors, mix_floors, fixed_floors_base,
                                 base_map=None, use_repeat_penalty=True)
    base_partition = partition_search(pool_names, base_sizes, base_cost_fn, salt=f"{monday.isoformat()}|base")
    base_map: dict[str, str] = {}
    for slot in SLOTS:
        for name in base_partition[slot]:
            base_map[name] = slot

    day_assignments: dict[str, dict[str, list[str]]] = {}
    fixed_by_day: dict[str, list[str]] = {}

    for day, d in week_dates.items():
        present_rotating = [
            name for name in pool_names
            if day in scheduled_days(next(s for s in rotating if s.name == name), week_dates)
            and on_leave(name, d, leaves) is None
        ]
        present_fixed = [
            s.name for s in fixed
            if day in scheduled_days(s, week_dates) and on_leave(s.name, d, leaves) is None
        ]
        fixed_by_day[day] = present_fixed

        day_sizes = compute_target_sizes(len(present_rotating), len(present_fixed), people_early, people_late)
        day_needed_total = (people_early - len(present_fixed)) + people_late
        if day_needed_total > len(present_rotating):
            warnings.append(
                f"{d.isoformat()} ({day}): understaffed — need {max(day_needed_total, 0)} rotating, "
                f"have {len(present_rotating)}."
            )

        if set(present_rotating) == set(pool_names) and day_sizes == base_sizes:
            day_assignment = {slot: [p for p in base_partition[slot]] for slot in SLOTS}
        else:
            present_fixed_floors = [s.floor for s in fixed if s.name in present_fixed]
            day_cost_fn = make_cost_fn(history, last_week_map, floors, mix_floors, present_fixed_floors,
                                        base_map=base_map, use_repeat_penalty=False)
            day_assignment = partition_search(present_rotating, day_sizes, day_cost_fn,
                                               salt=f"{monday.isoformat()}|{day}")

        day_assignments[day] = day_assignment

        for slot in SLOTS:
            for name in day_assignment[slot]:
                setattr(history[name], slot, getattr(history[name], slot) + 1)
        for name in present_fixed:
            history[name].early += 1

    for name in pool_names:
        history[name].last_week_start = base_map.get(name, history[name].last_week_start)
    for s in fixed:
        history[s.name].last_week_start = "early"

    return WeekResult(monday=monday, week_dates=week_dates, day_assignments=day_assignments,
                       fixed_by_day=fixed_by_day, base_map=base_map, warnings=warnings)


# --------------------------------------------------------------------------
# Cell content (shift text / colour) for a person on a given day
# --------------------------------------------------------------------------

def cell_for_person(person: StaffMember, day: str, d: date, leaves: list[Leave],
                     settings: dict, week_result: WeekResult) -> tuple[str, Optional[str]]:
    """Return (text, fill_colour_or_None) for a person's cell on a given day."""
    lv = on_leave(person.name, d, leaves) if person.name else None
    if lv is not None:
        colour = COLOR_MATERNITY if lv.type == "Maternity Leave" else (
            COLOR_HOLIDAY if lv.type == "Holiday" else COLOR_OTHER_LEAVE)
        return lv.type, colour

    if not is_employed(person, d):
        return "", None

    if is_permanent_day_off(person, day):
        return "OFF", COLOR_OFF

    if person.role in (ROLE_STATIC, ROLE_VACANT):
        return person.day_text(day), None

    if person.role == ROLE_FIXED:
        if person.name in week_result.fixed_by_day.get(day, []):
            return shift_text(settings["early_start"], settings["shift_length"]), None
        return "", None

    if person.role == ROLE_ROTATING:
        slot = None
        for s in SLOTS:
            if person.name in week_result.day_assignments[day][s]:
                slot = s
                break
        if slot is None:
            return "", None
        start_key = {"early": "early_start", "mid1": "mid1_start", "mid2": "mid2_start", "late": "late_start"}[slot]
        return shift_text(settings[start_key], settings["shift_length"]), None

    return "", None


# --------------------------------------------------------------------------
# Writing output tabs
# --------------------------------------------------------------------------

THIN = Side(style="thin", color="000000")
BORDER_ALL = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER_WRAP = Alignment(horizontal="center", vertical="center", wrap_text=True)


def write_week_sheet(wb: Workbook, sheet_name: str, staff: list[StaffMember], leaves: list[Leave],
                      settings: dict, week_result: WeekResult, week_number: int) -> None:
    ws = wb.create_sheet(sheet_name)
    ws.sheet_view.showGridLines = False

    ws["B1"] = "STAFF ROSTER"
    ws["B1"].font = Font(name="Times New Roman", size=22, bold=True, color=COLOR_TITLE)

    ws["B3"] = format_week_range(week_result.monday)
    ws["B3"].font = Font(name="Arial", size=14, bold=True)

    widths = [5, 17, 15, 15, 15, 15, 15, 11, 11]
    for c, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = w

    row = 5
    number = 1
    for person in staff:
        for c in range(1, 10):
            cell = ws.cell(row, c)
            cell.border = BORDER_ALL
            cell.alignment = CENTER_WRAP
            cell.font = Font(name="Arial", size=10)
        ws.row_dimensions[row].height = 30

        if person.role == ROLE_BLANK:
            row += 1
            continue

        if person.numbered:
            ws.cell(row, 1, number)
            number += 1

        if person.role != ROLE_VACANT:
            ws.cell(row, 2, person.label)

        for col_idx, day in enumerate(DAYS, start=3):
            d = week_result.week_dates[day]
            text, colour = cell_for_person(person, day, d, leaves, settings, week_result)
            cell = ws.cell(row, col_idx, text)
            if colour:
                cell.fill = PatternFill(start_color=colour, end_color=colour, fill_type="solid")

        if person.role != ROLE_BLANK:
            ws.cell(row, 8, settings["break_text"])

        row += 1

    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def write_checks_sheet(wb: Workbook, staff: list[StaffMember], settings: dict,
                        week_results: list[WeekResult], history: dict[str, HistoryEntry],
                        all_warnings: list[str]) -> None:
    ws = wb.create_sheet("Checks")
    headers = ["Week of", "Day", "Early", "Middle 1", "Middle 2", "Late", "Status"]
    for c, h in enumerate(headers, start=1):
        ws.cell(1, c, h).font = Font(bold=True)

    row = 2
    people_early = settings["people_early"]
    people_late = settings["people_late"]
    for wr in week_results:
        for day, d in wr.week_dates.items():
            counts = {slot: len(wr.day_assignments[day][slot]) for slot in SLOTS}
            counts["early"] += len(wr.fixed_by_day.get(day, []))
            issues = []
            if counts["early"] != people_early:
                issues.append(f"early {counts['early']}/{people_early}")
            if counts["late"] != people_late:
                issues.append(f"late {counts['late']}/{people_late}")
            if counts["mid1"] == 0:
                issues.append("mid1 empty")
            if counts["mid2"] == 0:
                issues.append("mid2 empty")
            status = "OK" if not issues else "; ".join(issues)
            ws.cell(row, 1, wr.monday.isoformat())
            ws.cell(row, 2, f"{day} {d.isoformat()}")
            ws.cell(row, 3, counts["early"])
            ws.cell(row, 4, counts["mid1"])
            ws.cell(row, 5, counts["mid2"])
            ws.cell(row, 6, counts["late"])
            status_cell = ws.cell(row, 7, status)
            colour = COLOR_OK if status == "OK" else COLOR_ISSUE
            status_cell.fill = PatternFill(start_color=colour, end_color=colour, fill_type="solid")
            row += 1

    row += 1
    ws.cell(row, 1, "Warnings").font = Font(bold=True)
    row += 1
    if not all_warnings:
        ws.cell(row, 1, "None")
        row += 1
    else:
        for w in all_warnings:
            ws.cell(row, 1, w)
            row += 1

    row += 1
    ws.cell(row, 1, "Fairness (cumulative days at each start time)").font = Font(bold=True)
    row += 1
    for c, h in enumerate(["Name", "Floor", "Early", "Middle 1", "Middle 2", "Late"], start=1):
        ws.cell(row, c, h).font = Font(bold=True)
    row += 1
    floors = {s.name: s.floor for s in staff}
    trackable = [s.name for s in staff if s.role in (ROLE_ROTATING, ROLE_FIXED)]
    for name in trackable:
        entry = history.get(name, HistoryEntry())
        ws.cell(row, 1, name)
        ws.cell(row, 2, floors.get(name, ""))
        ws.cell(row, 3, entry.early)
        ws.cell(row, 4, entry.mid1)
        ws.cell(row, 5, entry.mid2)
        ws.cell(row, 6, entry.late)
        row += 1

    for c, w in enumerate([16, 20, 10, 10, 10, 10, 30], start=1):
        ws.column_dimensions[get_column_letter(c)].width = w


def write_history_sheet(ws: Worksheet, history: dict[str, HistoryEntry], committed_through: date) -> None:
    for row in range(2, ws.max_row + 1):
        for c in range(1, 8):
            ws.cell(row, c).value = None
    row = 2
    for name in sorted(history.keys()):
        entry = history[name]
        ws.cell(row, 1, name)
        ws.cell(row, 2, entry.early)
        ws.cell(row, 3, entry.mid1)
        ws.cell(row, 4, entry.mid2)
        ws.cell(row, 5, entry.late)
        ws.cell(row, 6, entry.last_week_start)
        ws.cell(row, 7, committed_through.isoformat())
        row += 1


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------

def _remove_output_sheets(wb: Workbook) -> None:
    to_remove = [name for name in wb.sheetnames if name.startswith("Week ") or name == "Checks"]
    for name in to_remove:
        del wb[name]


def build_roster(planner_path: str, start: date, weeks: int, out: Optional[str] = None,
                  commit: bool = False) -> list[str]:
    """Build the roster. Returns a list of warning strings. May raise RosterInputError."""
    if start.weekday() != 0:
        raise RosterInputError(f"--start must be a Monday. {start.isoformat()} is a {start.strftime('%A')}.")
    if weeks < 1:
        raise RosterInputError("--weeks must be at least 1.")

    import os
    if not os.path.exists(planner_path):
        create_template(planner_path)
        print(f"Created a new planner workbook at '{planner_path}'. Please fill in the Staff and "
              "Leave tabs (and adjust Settings if needed), then run this script again.")
        return []

    try:
        wb = load_workbook(planner_path)
    except PermissionError:
        raise RosterInputError(
            f"Could not open '{planner_path}' — it looks like it is open in Excel. "
            "Please close the file and try again."
        )

    staff = read_staff(wb["Staff"])
    staff_names = {s.name for s in staff if s.name}
    leaves = read_leave(wb["Leave"], staff_names)
    settings = read_settings(wb["Settings"])
    history = read_history(wb["History"])

    _remove_output_sheets(wb)

    all_warnings: list[str] = []
    week_results: list[WeekResult] = []
    for i in range(weeks):
        monday = start + timedelta(weeks=i)
        wr = build_week(staff, leaves, settings, history, monday)
        week_results.append(wr)
        all_warnings.extend(wr.warnings)
        sheet_name = f"Week {i + 1} ({monday.strftime('%d %b')})"
        write_week_sheet(wb, sheet_name, staff, leaves, settings, wr, i + 1)

    write_checks_sheet(wb, staff, settings, week_results, history, all_warnings)

    if commit:
        committed_through = week_results[-1].monday + timedelta(days=4)
        write_history_sheet(wb["History"], history, committed_through)

    out_path = out or planner_path
    try:
        wb.save(out_path)
    except PermissionError:
        raise RosterInputError(
            f"Could not save '{out_path}' — it looks like it is open in Excel. "
            "Please close the file and try again."
        )

    for w in all_warnings:
        print(f"WARNING: {w}")

    return all_warnings


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a fair, rotating weekly staff roster.")
    parser.add_argument("--start", required=True, help="First Monday of the roster (YYYY-MM-DD).")
    parser.add_argument("--weeks", required=True, type=int, help="Number of weeks to generate.")
    parser.add_argument("--file", default="Roster_Planner.xlsx", help="Planner workbook path.")
    parser.add_argument("--out", default=None, help="Write output to a different workbook.")
    parser.add_argument("--commit", action="store_true", help="Save fairness history to the planner.")
    args = parser.parse_args(argv)

    try:
        start = datetime.strptime(args.start, "%Y-%m-%d").date()
    except ValueError:
        print(f"Error: --start must be in YYYY-MM-DD format, got '{args.start}'.", file=sys.stderr)
        return 1

    try:
        build_roster(args.file, start, args.weeks, out=args.out, commit=args.commit)
    except RosterInputError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
