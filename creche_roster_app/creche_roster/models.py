"""Plain data classes shared by every module. No logic beyond tiny helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from typing import Dict, List, Optional, Tuple

# The four start-time slots that rotating staff share, earliest to latest.
SLOTS: Tuple[str, ...] = ("early", "mid1", "mid2", "late")
SLOT_LABELS = {"early": "Early", "mid1": "Mid 1", "mid2": "Mid 2", "late": "Late"}

ROLES: Tuple[str, ...] = ("rotating", "fixed", "paired", "static", "vacant", "blank")

NDAYS = 5  # Monday to Friday
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri")


class InputError(ValueError):
    """Raised when the input workbook is wrong. Carries every problem found."""

    def __init__(self, problems: List[str]):
        self.problems = list(problems)
        super().__init__("\n".join(f"- {p}" for p in self.problems))


def t12(t: time) -> str:
    """7:30, 1:30, 12:00 ... the way the printed roster shows times."""
    h = t.hour % 12 or 12
    return f"{h}:{t.minute:02d}"


@dataclass(frozen=True)
class Shift:
    start: time
    end: time

    @property
    def label(self) -> str:
        return f"{t12(self.start)} – {t12(self.end)}"


@dataclass
class Settings:
    title: str
    roster_start: date  # must be a Monday
    weeks: int
    floors: List[str]
    shifts: Dict[str, Shift]  # keyed by SLOTS
    min_open: Dict[str, int]  # per floor: minimum staff on the early slot
    min_close: Dict[str, int]  # per floor: minimum staff on the late slot
    break_text: str = "10 MINS"
    day_headers: bool = False  # the old printed roster has no Mon..Fri header row
    fallback_closer: Optional[str] = None  # a static-hours person who closes when neither paired person does


@dataclass
class Staff:
    name: str
    floor: str
    role: str  # one of ROLES
    note: str = ""  # fixed: slot name or start time; static/vacant: hours text
    fixed_slot: Optional[str] = None  # resolved from note for role "fixed"
    hours: List[str] = field(default_factory=lambda: [""] * NDAYS)  # own hours Mon..Fri (static/vacant)
    number: str = ""  # printed row number: empty = automatic, "-" = none, "12" = set it


@dataclass
class Leave:
    name: str
    start: date
    end: Optional[date]  # None = open ended (until the person is back)
    kind: str = "Leave"

    def covers(self, d: date) -> bool:
        return self.start <= d and (self.end is None or d <= self.end)


@dataclass
class Override:
    name: str
    start: date
    end: Optional[date]  # None = open ended
    slot: Optional[str] = None  # one of SLOTS (everyone except static staff)
    text: str = ""  # free text hours (static staff only), e.g. "10:00 - 2:00" or "OFF"

    def covers(self, d: date) -> bool:
        return self.start <= d and (self.end is None or d <= self.end)


@dataclass
class Inputs:
    settings: Settings
    staff: List[Staff]
    leave: List[Leave] = field(default_factory=list)
    overrides: List[Override] = field(default_factory=list)
    # Days already worked on each start time before this roster (fairness memory).
    history: Dict[str, Dict[str, int]] = field(default_factory=dict)
    last_slot: Dict[str, str] = field(default_factory=dict)


@dataclass
class Assignment:
    kind: str  # shift | leave | static | vacant | blank
    slot: Optional[str] = None
    text: str = ""
    overridden: bool = False


@dataclass
class Check:
    level: str  # INFO | WARNING | BREACH
    rule: str
    message: str
    day: Optional[date] = None
    week: Optional[int] = None  # 0-based week index


@dataclass
class WeekRoster:
    monday: date
    days: List[date]
    cells: Dict[Tuple[str, date], Assignment]  # keyed by (staff key, day)


@dataclass
class Roster:
    inputs: Inputs
    staff_keys: List[Tuple[str, Staff]]  # (unique key, staff) in display order
    weeks: List[WeekRoster]
    checks: List[Check]
    period_counts: Dict[str, Dict[str, int]]  # days per slot in THIS roster
    cumulative_counts: Dict[str, Dict[str, int]]  # history + this roster
    last_slot: Dict[str, str] = field(default_factory=dict)  # most recent slot per person

    @property
    def breaches(self) -> List[Check]:
        return [c for c in self.checks if c.level == "BREACH"]
