# Creche roster generator

Fair, rotating weekly staff roster. Staff, leave and overrides live in **one Excel
workbook** (`Roster_Planner.xlsx`). The program writes the roster back into that
workbook (one printable sheet per week) and also produces a PDF with the same layout.

## Setup (once)

```
pip install -r requirements.txt
python -m creche_roster init Roster_Planner.xlsx --start 28/09/2026
```

Open `Roster_Planner.xlsx`. The staff are from the printed roster of 21st–25th September 2026
and History is seeded from that week, so the rotation continues from it.
Set the real floor grouping and minimum opening/closing cover (Settings tab): those two are placeholders.

## Every time

1. Update **Leave** and **Overrides** in Excel. Close the file.
2. Run `python -m creche_roster build Roster_Planner.xlsx`
3. Open the workbook (Week 1..N, Checks, Totals) or `Roster_Planner.pdf`.

The old workbook is kept as `Roster_Planner.xlsx.bak` on each run.

## What the printed page looks like

Same as the old paper roster: red STAFF ROSTER title, the date range, then one table
(No | Name | Mon to Fri | 10 MINS | empty column). Times are shown 7:30 – 4:30 style.
Shifts have no colour. Holiday is orange-red, Maternity Leave green, OFF light green.
One portrait A4 page per week, in Excel and in the PDF.

## Tabs you edit (blue text)

| Tab | Columns |
|---|---|
| Staff | Name, Floor, Role, Fixed slot / hours, Mon..Fri (own hours), Print no. |
| Leave | Name, From, To (empty = until back), Type (shown as typed: Holiday, Maternity Leave, OFF ...) |
| Overrides | Name, From, To (empty = until back), Start time (static staff: their hours, or OFF) |
| Settings | title, first Monday, weeks, break text, day headers yes/no, floors, the four start/end times, minimum cover |
| History | days each person has already worked on each start time, and their last slot |

Roles: `rotating` (shares the four start times), `fixed` (always one slot), `paired`
(exactly two people), `static` (own hours: type them in "Fixed slot / hours", or per day
in Mon..Fri; type OFF for a day off), `vacant` (empty post, hours optional),
`blank` (spacer row). "Print no.": empty = automatic number, `-` = no number.

## The closing fallback

Set `fallback_closer` in Settings to a static-hours person's name (e.g. `Priscilla`)
whose own hours reach the late shift's end time on a given day. On any day neither
paired person is closing (both away, or the one who's in was overridden elsewhere),
that person's presence counts toward closing cover automatically — no cell changes,
it's just no longer flagged as short by one. A day where their own hours are shorter
(e.g. a half day) doesn't count, and the normal repair (moving a rotating person)
still runs if it's still short. Leave the setting blank for no fallback.

## The Shehnaz / Jason rule

The two `paired` staff are always complementary:
Shehnaz 07:30 means Jason 09:00, and Jason 07:30 means Shehnaz 09:00.
They alternate who starts early, using History so it stays fair.

When one of them is away, the pairing is suspended for those days and you set the
other person's start time on the **Overrides** tab. Example, right now:

| Name | From | To | Start time |
|---|---|---|---|
| Jason | 21/09/2026 | (empty) | 7:30 |

An override on a paired person only applies on days when their partner is away.
When the partner is back, the pairing takes over automatically, and whoever covered
07:30 the longest takes 09:00 first. You do not have to delete the row.

## Hard rules and the Checks tab

Always enforced, or reported in red on the Checks tab (never silently broken):
opening cover, closing cover, and the pairing rule. Soft rules (fair rotation,
not repeating last week's slot, an even spread of starts) are weighed, not guaranteed.

Copy the "Running totals" table from the Totals tab into History before your next
run so fairness carries over.

## Code map

| File | Job |
|---|---|
| `engine.py` | all scheduling logic, one pure function `build_roster()` |
| `layout.py` | what a printed week looks like, matching the old paper roster (used by both outputs) |
| `excel_io.py` | read the input tabs, write Week / Checks / Totals tabs |
| `pdf_out.py` | PDF from the same layout |
| `tests/test_roster.py` | 45 tests, including "Excel and PDF show the same roster" |

Run the tests: `python -m unittest discover -s tests -v`
