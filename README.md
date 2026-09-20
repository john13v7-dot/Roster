# Roster Planner

A small Python tool that generates a fair, rotating weekly staff roster for a
creche, reading and writing a single Excel workbook: `Roster_Planner.xlsx`.

Requires Python 3.10+ and `openpyxl` (no other dependencies).

```
pip install openpyxl
```

## Usage

```
python roster_generator.py --start 2026-09-28 --weeks 4 [--file Roster_Planner.xlsx] [--out other.xlsx] [--commit]
```

- `--start` must be a Monday (`YYYY-MM-DD`).
- `--weeks` is how many weeks to generate.
- `--file` lets you point at a different planner workbook (defaults to `Roster_Planner.xlsx`).
- `--out` writes the result to a different workbook, leaving the input file untouched.
- `--commit` saves the fairness rotation history to the `History` tab. Without
  it you can preview a roster (e.g. to check a hypothetical week) without
  affecting the rotation used by future runs.

If `Roster_Planner.xlsx` doesn't exist yet, the script creates it — pre-filled
with a sample staff list and settings — and asks you to review it before
running again.

You can also call the generator from other Python code (e.g. a GUI):

```python
from roster_generator import build_roster
from datetime import date

warnings = build_roster("Roster_Planner.xlsx", date(2026, 9, 28), weeks=4, commit=True)
```

## Workbook layout

### Tabs you edit

- **How to use** — a quick reference.
- **Staff** — one row per person, in the order you want them printed:

  | Name | Display name (optional) | Role | Floor | Mon | Tue | Wed | Thu | Fri | Days off (e.g. Thu) | Start date | End date | Numbered row? (Yes/No) |

  - **Role**: `rotating` (shares the four start times), `fixed` (always the
    early start when scheduled), `static` (own typed hours, e.g. part-timers),
    `vacant` (an empty post that still shows shifts but no name), `management`
    (see below), or leave blank for a spacer row.
  - **Floor**: `down` or `up` — used to mix floors at each start time. For a
    `management` row, Floor also decides whether they're attached to a room
    (see below).
  - For a `static`/`vacant` row, fill in the **Mon** column; if the other days
    are left blank, Monday's hours are applied to all five days. Fill in
    individual days only where the hours differ (e.g. a different Monday).
  - **`management`** rows only ever work the early or late start time — never
    a middle one. The generator picks whichever is fairer for them
    automatically, but you can force a specific day by typing that start time
    (e.g. `7:30` or `9:00`) straight into the Mon-Fri cell for that day (or
    picking it from the dropdown); leave the cell blank for automatic.
    - With a **Floor** set, they're attached to a room and always count
      toward that day's opening/closing ratio (e.g. a room leader).
    - With **Floor** left blank, they're purely management and stay off the
      room count (shown as "Management") *unless* the rotating/fixed/
      room-management staff can't meet the ratio that day on their own, in
      which case they're automatically pulled in to cover the gap — or you
      can force it yourself the same way, via the Mon-Fri dropdown.
  - **Days off** is a permanent weekly day off (shows as `OFF`).
  - **Start date** / **End date** control joiners and leavers. If someone
    isn't employed at all in a given week, their row is left out of that
    week's tab.
  - **Numbered row?** controls whether the row gets a sequence number in the
    printed roster.

- **Leave** — `Name | Type | From | To`. `Type` is one of Holiday, Maternity
  Leave, Sick, Other. Leave `To` blank for open-ended leave.
- **Settings** — start times, staffing numbers, shift length, floor-mixing,
  and the break text shown on the roster.
- **History** — the fairness rotation record (how many days each person has
  worked each start time, their start time last week, and the date the
  rotation has been committed through). Don't edit this by hand; it's
  maintained automatically by `--commit`.

### Tabs the script rebuilds every run

- **Week N (dd Mon)** — one printed roster per week.
- **Checks** — daily staffing counts and status, warnings, and a cumulative
  fairness table.

Don't hand-edit the Week/Checks tabs — they're deleted and regenerated on
every run.

## How the roster is built

1. **Weekly base.** For everyone who works at least one day that week, solve
   an ideal assignment to one of four start times (early / mid1 / mid2 /
   late). The cost combines each person's own fairness balance (how far a
   slot's history is above/below their personal average), floor-mixing,
   avoiding an empty middle slot, and avoiding a repeat of last week's start
   time. Fixed staff are treated as "present" for this base calculation only
   if they work at least 3 days that week.
2. **Daily.** Each day is re-solved for the people actually present (leave,
   permanent days off, joiners, and leavers are respected), with a penalty
   for deviating from the weekly base — so nothing changes on a day when
   nobody is absent, and only the minimum changes otherwise.
3. **Solving.** Small problems (up to ~150,000 possible partitions) are
   solved exactly with `itertools.combinations`. Larger ones use a
   swap-based local search with 30 random restarts, seeded for determinism.
4. History counts are updated after each day. A new joiner starts at the
   rounded team average for each start time, so they don't unfairly "owe" or
   "gain" days. Each week's base assignment is carried forward as "last
   week's start" for the next week's fairness/repeat calculation.
5. Shift times are shown as `start – end` (en dash), with the end time
   computed from the shift length in Settings.

### Hard rules (always met, staffing allowing)

- Early start: the fixed staff present, plus rotating staff, totalling
  "People at early start". If fixed staff are absent, rotating staff cover
  the full amount.
- Late start: exactly "People at late start".
- Everyone else is split between the two middle start times, sizes differing
  by at most one (ties go to the earlier, 08:00, slot).
- If there aren't enough staff to meet these, the script fills as best it
  can and raises a warning (printed to the console and listed on the Checks
  tab) rather than failing.

## Tests

```
pip install pytest
python -m pytest test_roster_generator.py
```
