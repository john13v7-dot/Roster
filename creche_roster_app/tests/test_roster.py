"""Run with:  python -m unittest discover -s tests -v   (or: pytest)"""

import shutil
import tempfile
import unittest
from datetime import date, time, timedelta
from pathlib import Path

from openpyxl import load_workbook
from pypdf import PdfReader

from creche_roster.engine import build_roster
from creche_roster.excel_io import make_template, read_inputs, write_workbook
from creche_roster.layout import NCOLS, date_range_text, week_grid
from creche_roster.models import InputError, Leave, Override, Shift, t12
from creche_roster.parsing import norm_hours, parse_date, parse_time
from creche_roster.pdf_out import write_pdf
from creche_roster.sample import sample_inputs

START = date(2026, 9, 28)  # a Monday
ROTATING = ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha"]


def inputs(**kw):
    """Starter data with no leave, overrides or history unless given."""
    inp = sample_inputs(START)
    inp.leave = kw.get("leave", [])
    inp.overrides = kw.get("overrides", [])
    inp.settings.weeks = kw.get("weeks", 4)
    inp.history = kw.get("history", {})
    inp.last_slot = kw.get("last_slot", {})
    for k, v in kw.get("settings", {}).items():
        setattr(inp.settings, k, v)
    return inp


def slots(roster, wi, name):
    w = roster.weeks[wi]
    return [w.cells[(name, d)].slot for d in w.days]


def kinds(roster, wi, name):
    w = roster.weeks[wi]
    return [w.cells[(name, d)].kind for d in w.days]


def texts(roster, wi, name):
    w = roster.weeks[wi]
    return [w.cells[(name, d)].text for d in w.days]


class Parsing(unittest.TestCase):
    def test_time_formats(self):
        for raw in ("07:30", "7:30", "07.30", "07 30", "0730", "7h30", time(7, 30), 7.5 / 24):
            self.assertEqual(parse_time(raw), time(7, 30), raw)

    def test_bad_time(self):
        with self.assertRaises(ValueError):
            parse_time("25:00")

    def test_date_formats(self):
        self.assertEqual(parse_date("28/09/2026"), START)
        self.assertEqual(parse_date("2026-09-28"), START)

    def test_twelve_hour_display(self):
        self.assertEqual(t12(time(7, 30)), "7:30")
        self.assertEqual(t12(time(13, 30)), "1:30")
        self.assertEqual(t12(time(18, 0)), "6:00")
        self.assertEqual(Shift(time(7, 30), time(16, 30)).label, "7:30 – 4:30")

    def test_hours_are_normalised(self):
        self.assertEqual(norm_hours("10:00 - 2:00"), "10:00 – 2:00")
        self.assertEqual(norm_hours("9.00-6.00"), "9.00 – 6.00")
        self.assertEqual(norm_hours("OFF"), "OFF")

    def test_date_range_heading(self):
        self.assertEqual(date_range_text(date(2026, 9, 21), date(2026, 9, 25)), "21st – 25th September 2026")
        self.assertEqual(date_range_text(date(2026, 9, 28), date(2026, 10, 2)), "28th September – 2nd October 2026")
        self.assertEqual(date_range_text(date(2026, 10, 12), date(2026, 10, 16)), "12th – 16th October 2026")
        self.assertEqual(date_range_text(date(2026, 10, 19), date(2026, 10, 23)), "19th – 23rd October 2026")


class PairingRule(unittest.TestCase):
    def test_complementary_every_day_without_leave(self):
        r = build_roster(inputs(weeks=12))
        for wi in range(12):
            for a, b in zip(slots(r, wi, "Shehnaz"), slots(r, wi, "Jason")):
                self.assertEqual({a, b}, {"early", "late"}, f"week {wi + 1}")
        self.assertEqual(r.breaches, [])

    def test_pair_alternates_fairly(self):
        r = build_roster(inputs(weeks=12))
        shehnaz_early = sum(slots(r, wi, "Shehnaz")[0] == "early" for wi in range(12))
        self.assertEqual(shehnaz_early, 6)

    def test_history_decides_who_starts_early(self):
        hist = {"Jason": {"early": 100}, "Shehnaz": {"late": 100}}
        r = build_roster(inputs(weeks=1, history=hist))
        self.assertEqual(set(slots(r, 0, "Shehnaz")), {"early"})
        self.assertEqual(set(slots(r, 0, "Jason")), {"late"})

    def test_shehnaz_on_holiday_jason_stays_0730(self):
        r = build_roster(sample_inputs(START))  # Shehnaz away (open ended), Jason overridden
        for wi in range(4):
            self.assertEqual(set(slots(r, wi, "Jason")), {"early"})
            self.assertEqual(set(kinds(r, wi, "Shehnaz")), {"leave"})
            self.assertEqual(set(texts(r, wi, "Shehnaz")), {"Holiday"})
        self.assertEqual(r.breaches, [])
        self.assertEqual(r.weeks[0].cells[("Jason", START)].text, "7:30 – 4:30")

    def test_jason_on_holiday_shehnaz_override(self):
        r = build_roster(
            inputs(
                leave=[Leave("Jason", START, None, "Holiday")],
                overrides=[Override("Shehnaz", START, None, "early")],
            )
        )
        for wi in range(4):
            self.assertEqual(set(slots(r, wi, "Shehnaz")), {"early"})
            self.assertEqual(set(kinds(r, wi, "Jason")), {"leave"})
        self.assertEqual(r.breaches, [])

    def test_no_override_gives_warning_not_crash(self):
        r = build_roster(inputs(leave=[Leave("Shehnaz", START, None, "Holiday")]))
        self.assertTrue(any(c.level == "WARNING" and c.rule == "Pairing suspended" for c in r.checks))
        for wi in range(4):
            self.assertTrue(all(s in ("early", "late") for s in slots(r, wi, "Jason")))

    def test_pairing_resumes_when_partner_returns(self):
        leave = [Leave("Shehnaz", START, START + timedelta(days=13), "Holiday")]  # weeks 1 and 2
        over = [Override("Jason", START, None, "early")]  # forgotten open-ended override
        r = build_roster(inputs(leave=leave, overrides=over))
        self.assertEqual(set(slots(r, 0, "Jason")), {"early"})
        self.assertEqual(set(slots(r, 1, "Jason")), {"early"})
        for wi in (2, 3):
            for a, b in zip(slots(r, wi, "Shehnaz"), slots(r, wi, "Jason")):
                self.assertEqual({a, b}, {"early", "late"})
        # Jason covered 7:30 while she was away, so she takes it first.
        self.assertEqual(set(slots(r, 2, "Shehnaz")), {"early"})
        self.assertTrue(any(c.rule == "Override ignored" for c in r.checks))
        self.assertEqual(r.breaches, [])

    def test_partial_week_leave(self):
        leave = [Leave("Shehnaz", START + timedelta(days=2), START + timedelta(days=4), "Holiday")]  # Wed-Fri
        over = [Override("Jason", START + timedelta(days=2), START + timedelta(days=4), "early")]
        r = build_roster(inputs(leave=leave, overrides=over, weeks=1))
        s, j = slots(r, 0, "Shehnaz"), slots(r, 0, "Jason")
        for i in (0, 1):
            self.assertEqual({s[i], j[i]}, {"early", "late"})
        self.assertEqual(j[2:], ["early"] * 3)
        self.assertEqual(s[2:], [None] * 3)
        self.assertEqual(r.breaches, [])


class Overrides(unittest.TestCase):
    def test_solver_plans_around_overrides_without_repairs(self):
        leave = [Leave("Shehnaz", START, START + timedelta(days=13), "Holiday")]
        over = [Override("Jason", START, START + timedelta(days=13), "early")]
        r = build_roster(inputs(leave=leave, overrides=over))
        self.assertFalse([c for c in r.checks if c.rule == "Cover adjusted"])
        self.assertEqual(r.breaches, [])

    def test_override_on_a_rotating_person(self):
        over = [Override("Manuel", START, START + timedelta(days=4), "late")]
        r = build_roster(inputs(overrides=over, weeks=1))
        self.assertEqual(set(slots(r, 0, "Manuel")), {"late"})
        self.assertTrue(all(r.weeks[0].cells[("Manuel", d)].overridden for d in r.weeks[0].days))
        self.assertEqual(r.breaches, [])

    def test_last_matching_override_row_wins(self):
        over = [
            Override("Manuel", START, None, "late"),
            Override("Manuel", START + timedelta(days=2), None, "mid1"),
        ]
        r = build_roster(inputs(overrides=over, weeks=1))
        self.assertEqual(slots(r, 0, "Manuel"), ["late", "late", "mid1", "mid1", "mid1"])

    def test_static_override_is_free_text(self):
        over = [
            Override("Priscilla", START, START, None, "OFF"),
            Override("Laura", START + timedelta(days=1), START + timedelta(days=1), None, "10:00 – 2:00"),
        ]
        r = build_roster(inputs(overrides=over, weeks=1))
        self.assertEqual(texts(r, 0, "Priscilla")[0], "OFF")
        self.assertEqual(kinds(r, 0, "Priscilla")[0], "leave")
        self.assertEqual(texts(r, 0, "Laura")[1], "10:00 – 2:00")
        self.assertEqual(texts(r, 0, "Laura")[0], "9:00 – 1:00")


class StaticVacantAndLeave(unittest.TestCase):
    def test_own_hours_and_day_off(self):
        r = build_roster(inputs(weeks=1))
        self.assertEqual(texts(r, 0, "Sue"), ["8:30 – 1:30"] * 3 + ["OFF", "8:30 – 1:30"])
        self.assertEqual(texts(r, 0, "Priscilla"), ["10:00 – 2:00"] + ["10:00 – 6:00"] * 4)
        self.assertEqual(texts(r, 0, "Laura"), ["9:00 – 1:00"] * 5)
        self.assertEqual(texts(r, 0, "Megan"), [""] * 5)

    def test_maternity_leave_text_is_kept_as_typed(self):
        r = build_roster(inputs(leave=[Leave("Eirini", START, None, "Maternity Leave")], weeks=1))
        self.assertEqual(set(texts(r, 0, "Eirini")), {"Maternity Leave"})

    def test_vacant_post_shows_its_hours_but_is_not_scheduled(self):
        r = build_roster(inputs(weeks=1))
        vacant = [k for k, st in r.staff_keys if st.role == "vacant"]
        self.assertEqual(len(vacant), 3)
        self.assertEqual(r.weeks[0].cells[(vacant[0], START)].text, "8:30 – 5:30")
        self.assertEqual(r.weeks[0].cells[(vacant[1], START)].text, "")


class HardRules(unittest.TestCase):
    def test_ratios_met_for_twelve_weeks(self):
        self.assertEqual(build_roster(inputs(weeks=12)).breaches, [])

    def test_fixed_person_always_on_their_slot(self):
        inp = inputs(weeks=6)
        for st in inp.staff:
            if st.name == "Hanny":
                st.role, st.fixed_slot = "fixed", "early"
        r = build_roster(inp)
        for wi in range(6):
            self.assertEqual(set(slots(r, wi, "Hanny")), {"early"})

    def test_leave_day_is_marked_and_cover_is_repaired(self):
        day = START + timedelta(days=1)
        r = build_roster(inputs(leave=[Leave("Manuel", day, day, "Sick")], weeks=1))
        self.assertEqual(kinds(r, 0, "Manuel")[1], "leave")
        self.assertEqual(texts(r, 0, "Manuel")[1], "Sick")
        self.assertEqual(r.breaches, [])

    def test_infeasible_cover_is_reported_not_hidden(self):
        r = build_roster(inputs(settings={"min_open": {"All": 99}}, weeks=1))
        self.assertTrue(r.breaches)
        self.assertTrue(all(b.rule == "Opening cover" for b in r.breaches))

    def test_rotation_spreads_start_times(self):
        r = build_roster(inputs(weeks=12))
        for name in ROTATING:
            seen = {sl for wi in range(12) for sl in slots(r, wi, name)}
            self.assertGreaterEqual(len(seen), 3, name)

    def test_history_makes_rotation_continue_from_last_week(self):
        inp = inputs(weeks=1, last_slot={"Hanny": "early", "Usha": "late"})
        r = build_roster(inp)
        self.assertNotEqual(slots(r, 0, "Hanny")[0], "early")
        self.assertNotEqual(slots(r, 0, "Usha")[0], "late")

    def test_deterministic(self):
        a = build_roster(inputs(weeks=6))
        b = build_roster(inputs(weeks=6))
        for wi in range(6):
            self.assertEqual(a.weeks[wi].cells, b.weeks[wi].cells)


class Validation(unittest.TestCase):
    def test_unknown_name_and_bad_start(self):
        inp = inputs(leave=[Leave("Nobody", START, None)])
        inp.settings.roster_start = START + timedelta(days=1)
        with self.assertRaises(InputError) as cm:
            build_roster(inp)
        text = str(cm.exception)
        self.assertIn("Nobody", text)
        self.assertIn("must be a Monday", text)

    def test_exactly_two_paired(self):
        inp = inputs()
        for st in inp.staff:
            if st.name == "Shehnaz":
                st.role = "rotating"
        with self.assertRaises(InputError) as cm:
            build_roster(inp)
        self.assertIn("exactly two", str(cm.exception))

    def test_start_times_must_increase(self):
        inp = inputs()
        inp.settings.shifts["mid1"], inp.settings.shifts["mid2"] = (
            inp.settings.shifts["mid2"],
            inp.settings.shifts["mid1"],
        )
        with self.assertRaises(InputError):
            build_roster(inp)


class OldLayout(unittest.TestCase):
    """The printed page must look like the old paper roster."""

    def setUp(self):
        self.r = build_roster(sample_inputs(START))
        self.grid = week_grid(self.r, 0)

    def test_title_and_date_then_table_without_header_row(self):
        self.assertEqual(self.grid[0].cells[0].text, "STAFF ROSTER")
        self.assertEqual(self.grid[1].cells[0].text, "28th September – 2nd October 2026")
        first_table_row = self.grid[3]
        self.assertEqual(len(first_table_row.cells), NCOLS)
        self.assertEqual([c.text for c in first_table_row.cells[:2]], ["1", "Sue"])

    def test_columns_are_no_name_five_days_break_and_empty(self):
        sue = self.grid[3].cells
        self.assertEqual(len(sue), 9)
        self.assertEqual(sue[7].text, "10 MINS")
        self.assertEqual(sue[8].text, "")

    def test_leave_colours(self):
        by_name = {row.cells[1].text: row for row in self.grid[3:] if not row.merged}
        self.assertEqual(by_name["Sue"].cells[5].style, "off")
        self.assertEqual(by_name["Sue"].cells[5].text, "OFF")
        self.assertEqual(by_name["Shehnaz"].cells[2].style, "holiday")
        self.assertEqual(by_name["Eirini"].cells[2].style, "maternity")
        self.assertEqual(by_name["Jason"].cells[2].style, "plain")  # shifts are not coloured

    def test_numbering_and_spacer(self):
        rows = [row for row in self.grid[3:] if not row.merged]
        numbers = [row.cells[0].text for row in rows]
        self.assertEqual(numbers[:13], [str(i) for i in range(1, 14)])
        self.assertEqual(numbers[13], "")  # spacer row
        eirini = next(row for row in rows if row.cells[1].text == "Eirini")
        self.assertEqual(eirini.cells[0].text, "")
        self.assertEqual(next(row for row in rows if row.cells[1].text == "Megan").cells[0].text, "14")

    def test_break_column_only_where_there_is_something(self):
        rows = [row for row in self.grid[3:] if not row.merged]
        self.assertEqual(rows[11].cells[7].text, "")  # empty numbered row 12
        self.assertEqual(rows[2].cells[7].text, "10 MINS")  # vacant post that has hours
        self.assertEqual(next(r for r in rows if r.cells[1].text == "Megan").cells[7].text, "10 MINS")

    def test_day_headers_are_optional(self):
        inp = sample_inputs(START)
        inp.settings.day_headers = True
        grid = week_grid(build_roster(inp), 0)
        self.assertEqual(grid[3].cells[2].text, "Mon 28 Sep")


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.xlsx = self.dir / "Roster_Planner.xlsx"
        make_template(self.xlsx, START)

    def build(self):
        roster = build_roster(read_inputs(self.xlsx))
        write_workbook(self.xlsx, roster)
        pdf = self.dir / "out.pdf"
        write_pdf(roster, pdf)
        return roster, pdf

    def test_starter_file_reads_back_the_same_staff(self):
        inp = read_inputs(self.xlsx)
        expected = sample_inputs(START)
        self.assertEqual([(s.name, s.role, s.hours, s.number) for s in inp.staff],
                         [(s.name, s.role, s.hours, s.number) for s in expected.staff])
        for name, counts in expected.history.items():
            self.assertEqual({sl: inp.history[name].get(sl, 0) for sl in counts}, counts)
            self.assertEqual(sum(inp.history[name].values()), sum(counts.values()))
        self.assertEqual(inp.last_slot, expected.last_slot)
        self.assertEqual([(o.name, o.slot) for o in inp.overrides], [("Jason", "early")])

    def test_template_builds_without_breaches(self):
        roster, _ = self.build()
        self.assertEqual(roster.breaches, [])
        wb = load_workbook(self.xlsx)
        for n in ("Staff", "Leave", "Overrides", "Settings", "History", "Week 1", "Week 4", "Checks", "Totals"):
            self.assertIn(n, wb.sheetnames)

    def test_running_twice_does_not_duplicate_sheets(self):
        self.build()
        self.build()
        names = load_workbook(self.xlsx).sheetnames
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(sum(n.startswith("Week ") for n in names), 4)

    def test_input_tabs_untouched(self):
        def snap():
            wb = load_workbook(self.xlsx)
            return {n: [[c.value for c in row] for row in wb[n].iter_rows()] for n in ("Staff", "Leave", "Overrides", "Settings", "History")}

        before = snap()
        self.build()
        self.assertEqual(before, snap())

    def test_excel_and_pdf_show_the_same_roster(self):
        roster, pdf = self.build()
        wb = load_workbook(self.xlsx)
        reader = PdfReader(str(pdf))
        self.assertEqual(len(reader.pages), len(roster.weeks))
        for wi in range(len(roster.weeks)):
            grid = week_grid(roster, wi)
            ws = wb[f"Week {wi + 1}"]
            page_text = "".join(reader.pages[wi].extract_text().split())
            for r, row in enumerate(grid, start=1):
                for c, cell in enumerate(row.cells, start=1):
                    self.assertEqual((ws.cell(r, c).value or ""), cell.text, f"week {wi + 1} r{r} c{c}")
                    if cell.text:
                        self.assertIn("".join(cell.text.split()), page_text, f"pdf week {wi + 1}: {cell.text}")

    def test_print_setup_is_one_portrait_page_per_week(self):
        self.build()
        ws = load_workbook(self.xlsx)["Week 1"]
        self.assertEqual(ws.page_setup.orientation, "portrait")
        self.assertEqual((ws.page_setup.fitToWidth, ws.page_setup.fitToHeight), (1, 1))
        self.assertTrue(ws.sheet_properties.pageSetUpPr.fitToPage)
        self.assertIsNotNone(ws.print_area)

    def test_static_override_typed_in_excel(self):
        wb = load_workbook(self.xlsx)
        wb["Overrides"].append(["Priscilla", "28/09/2026", "28/09/2026", "9:00 - 3:00"])
        wb.save(self.xlsx)
        roster, _ = self.build()
        self.assertEqual(roster.weeks[0].cells[("Priscilla", START)].text, "9:00 – 3:00")

    def test_bad_workbook_lists_every_problem(self):
        wb = load_workbook(self.xlsx)
        wb["Leave"].append(["Nobody", "28/09/2026", None, "Holiday"])
        wb["Overrides"].append(["Jason", "not a date", None, "07:30"])
        wb.save(self.xlsx)
        with self.assertRaises(InputError) as cm:
            read_inputs(self.xlsx)
        self.assertEqual(len(cm.exception.problems), 2)


if __name__ == "__main__":
    unittest.main()
