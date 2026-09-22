"""Single source of truth for what a printed week looks like.

This reproduces the old paper roster: a red "STAFF ROSTER" title, the date
range, then one table with the columns

    No | Name | Mon | Tue | Wed | Thu | Fri | break | (empty)

Leave is coloured: Holiday orange-red, Maternity Leave green, OFF light
green. A shift is coloured amber when that day it was moved to cover for a
colleague's leave (the "Cover adjusted" / "Closing fallback" checks) -
otherwise shifts carry no colour. Times are shown 12-hour style (7:30 - 4:30).

Both the Excel writer and the PDF writer render `week_grid(...)`, so the two
files always show exactly the same names, times, colours and notes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Tuple

from .models import DAY_NAMES, NDAYS, Roster

NCOLS = 2 + NDAYS + 2  # No, Name, Mon..Fri, break, empty
COL_WIDTHS_CHARS = [5, 18] + [16] * NDAYS + [10, 10]  # Excel column widths

# fill/color are hex without '#'. `serif` is used for the title only.
_BASE = dict(fill=None, color="000000", bold=False, italic=False, size=10, align="center", border=True, serif=False)


def _style(**kw) -> dict:
    d = dict(_BASE)
    d.update(kw)
    return d


STYLES: Dict[str, dict] = {
    "title": _style(color="E04A32", bold=True, size=22, align="left", border=False, serif=True),
    "subtitle": _style(bold=True, size=14, align="left", border=False),
    "header": _style(fill="D9D9D9", bold=True),
    "plain": _style(),
    "holiday": _style(fill="C65B35", color="F4CCB8"),
    "maternity": _style(fill="2E9E57", color="BFE6CB"),
    "off": _style(fill="A9D18E"),
    "leave": _style(fill="D9D9D9"),
    "adjusted": _style(fill="FCE4A0", color="7F5F00", bold=True),
    "blank": _style(border=False),
    "note": _style(color="404040", italic=True, size=9, align="left", border=False),
    "note_warn": _style(fill="FFEB9C", color="7F6000", size=9, align="left", border=False),
    "note_bad": _style(fill="FFC7CE", color="9C0006", bold=True, size=9, align="left", border=False),
}

MAX_NOTES = 6


@dataclass
class LCell:
    text: str
    style: str


@dataclass
class Row:
    cells: List[LCell]
    merged: bool = False  # True: a single cell spanning every column
    height: float = 1.0  # relative height (1.0 = normal row)


def leave_style(text: str) -> str:
    t = text.strip().lower()
    if t == "off":
        return "off"
    if "holiday" in t:
        return "holiday"
    if "maternity" in t:
        return "maternity"
    return "leave"


def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def date_range_text(first, last) -> str:
    """'21st – 25th September 2026' (or across months / years)."""
    dash = "–"
    if (first.year, first.month) == (last.year, last.month):
        return f"{ordinal(first.day)} {dash} {ordinal(last.day)} {last:%B %Y}"
    if first.year == last.year:
        return f"{ordinal(first.day)} {first:%B} {dash} {ordinal(last.day)} {last:%B %Y}"
    return f"{ordinal(first.day)} {first:%B %Y} {dash} {ordinal(last.day)} {last:%B %Y}"


_ORD_RE = re.compile(r"(\d+)(st|nd|rd|th)\b")


def ordinal_runs(text: str) -> List[Tuple[str, bool]]:
    """Split '21st - 25th September' into runs; True marks the raised suffix (st, nd, rd, th)."""
    runs: List[Tuple[str, bool]] = []
    pos = 0
    for m in _ORD_RE.finditer(text):
        runs.append((text[pos:m.end(1)], False))
        runs.append((m.group(2), True))
        pos = m.end()
    runs.append((text[pos:], False))
    return [r for r in runs if r[0]]


def _merged(text: str, style: str, height: float = 1.0) -> Row:
    return Row([LCell(text, style)], merged=True, height=height)


def _note_height(text: str) -> float:
    lines = max(1, -(-len(text) // 90))  # ceiling division
    return 0.75 * lines + 0.25


def week_grid(roster: Roster, wi: int) -> List[Row]:
    s = roster.inputs.settings
    week = roster.weeks[wi]
    rows: List[Row] = []

    rows.append(_merged(s.title, "title", 2.0))
    rows.append(_merged(date_range_text(week.days[0], week.days[-1]), "subtitle", 1.6))
    rows.append(_merged("", "blank", 0.7))

    if s.day_headers:
        rows.append(
            Row(
                [LCell("", "header"), LCell("Name", "header")]
                + [LCell(f"{DAY_NAMES[i]} {d.day} {d:%b}", "header") for i, d in enumerate(week.days)]
                + [LCell("Break", "header"), LCell("", "header")],
                height=1.25,
            )
        )

    number = 0
    for key, st in roster.staff_keys:
        if st.role == "blank":  # spacer row: bordered, empty, unnumbered
            rows.append(Row([LCell("", "plain") for _ in range(NCOLS)], height=1.25))
            continue
        if st.number.strip() == "-":
            label = ""
        else:
            number = int(st.number) if st.number.strip().isdigit() else number + 1
            label = str(number)
        day_cells: List[LCell] = []
        for d in week.days:
            a = week.cells[(key, d)]
            if a.kind == "leave":
                style = leave_style(a.text)
            elif a.kind == "shift" and a.adjusted:
                style = "adjusted"
            else:
                style = "plain"
            day_cells.append(LCell(a.text, style))
        has_content = bool(st.name) or any(c.text for c in day_cells)
        cells = (
            [LCell(label, "plain"), LCell(st.name, "plain")]
            + day_cells
            + [LCell(s.break_text if has_content else "", "plain"), LCell("", "plain")]
        )
        rows.append(Row(cells, height=1.25))

    # Anything that breaks a hard rule is printed under the table so nobody
    # hands out a broken roster without knowing.
    bad = [c for c in roster.checks if c.week == wi and c.level == "BREACH"]
    for c in bad[:MAX_NOTES]:
        text = "BREACH: " + c.message
        rows.append(_merged(text, "note_bad", _note_height(text)))
    if len(bad) > MAX_NOTES:
        rows.append(_merged(f"+ {len(bad) - MAX_NOTES} more (see the Checks tab)", "note_bad"))
    return rows
