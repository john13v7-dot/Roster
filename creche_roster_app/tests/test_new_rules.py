"""The newer scheduling rules, which apply from Settings.new_rules_start
(9 Nov 2026): strict cover (8:00 covers a missing opener, 8:30 a missing
closer), the 8:00 / 8:30 age-group mix, and a rolling 9-week fairness
window. Weeks before that date must come out exactly as they always have."""

import dataclasses
import unittest
from collections import Counter
from datetime import date, timedelta

from creche_roster.duties import _weekly_slot
from creche_roster.engine import build_roster
from creche_roster.models import Leave
from creche_roster.sample import sample_inputs

NEW = date(2026, 11, 9)
ROT = ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha"]
YOUNGER = {"Hanny", "Manuel", "Irene", "Deoshree"}
OLDER = {"Sandrine", "Daniel", "Arantza", "David", "Usha"}


def inputs(start=NEW, weeks=12, leave=(), new_start=NEW):
    inp = sample_inputs(start)
    inp.settings = dataclasses.replace(inp.settings, weeks=weeks, new_rules_start=new_start)
    # Shehnaz's open-ended holiday and Eirini's leave are part of the sample;
    # keep only what a test names so the week is a normal one.
    inp.leave = [lv for lv in inp.leave if lv.name == "Eirini"] + list(leave)
    inp.overrides = []
    return inp


def week_slot(roster, wi, name):
    return _weekly_slot_from_cells(roster.weeks[wi], name)


def _weekly_slot_from_cells(week, name):
    slots = [week.cells[(name, d)].slot for d in week.days if week.cells[(name, d)].kind == "shift"]
    return Counter(slots).most_common(1)[0][0] if slots else None


class OlderWeeksUnchanged(unittest.TestCase):
    def test_weeks_before_the_start_date_are_built_exactly_as_before(self):
        start = date(2026, 10, 12)
        old = build_roster(inputs(start, 5, new_start=None))
        mixed = build_roster(inputs(start, 5, new_start=NEW))
        for wi in range(4):  # 12 Oct .. 2 Nov
            for n in ROT + ["Jason", "Shehnaz"]:
                self.assertEqual(
                    [old.weeks[wi].cells[(n, d)].text for d in old.weeks[wi].days],
                    [mixed.weeks[wi].cells[(n, d)].text for d in mixed.weeks[wi].days],
                    (wi, n),
                )


class NewRulesFairnessAndMix(unittest.TestCase):
    def setUp(self):
        self.inp = inputs()
        self.roster = build_roster(self.inp)

    def test_cover_and_room_rules_hold_for_every_week(self):
        self.assertEqual([c for c in self.roster.checks if c.level == "BREACH"], [])

    def test_each_mid_group_has_a_younger_and_an_older_person(self):
        self.assertEqual([c for c in self.roster.checks if c.rule == "Age-group mix"], [])
        for wi, week in enumerate(self.roster.weeks):
            for mid in ("mid1", "mid2"):
                group = [n for n in ROT if week_slot(self.roster, wi, n) == mid]
                if len(group) >= 2:
                    self.assertTrue(YOUNGER & set(group), (wi, mid, group))
                    self.assertTrue(OLDER & set(group), (wi, mid, group))

    def test_openings_and_closings_are_shared_evenly_over_nine_weeks(self):
        for start in range(0, 4):
            window = range(start, start + 9)
            opens = Counter(week_slot(self.roster, wi, n) == "early" and n for wi in window for n in ROT)
            closes = Counter(week_slot(self.roster, wi, n) == "late" and n for wi in window for n in ROT)
            for n in ROT:
                # David and Usha share a room with Jason, so some of their seats
                # are blocked by design; everyone else stays within one of each other.
                if n not in ("David", "Usha"):
                    self.assertTrue(1 <= opens[n] <= 3, (start, n, opens[n]))
                    self.assertTrue(1 <= closes[n] <= 3, (start, n, closes[n]))

    def test_two_openers_and_two_closers_every_week(self):
        for wi in range(12):
            self.assertEqual(sum(week_slot(self.roster, wi, n) == "early" for n in ROT), 2)
            self.assertEqual(sum(week_slot(self.roster, wi, n) == "late" for n in ROT), 2)

    def test_prior_weeks_count_towards_fairness(self):
        # Everyone but Hanny opened in each of the last 8 weeks: she is owed.
        inp = inputs(weeks=1)
        inp.prior_slots = {n: ["early"] * 8 for n in ROT if n != "Hanny"}
        inp.prior_slots["Hanny"] = ["mid1"] * 8
        r = build_roster(inp)
        self.assertEqual(week_slot(r, 0, "Hanny"), "early")


class StrictCover(unittest.TestCase):
    def test_the_8_00_person_covers_a_missing_opener(self):
        base = build_roster(inputs(weeks=1))
        opener = next(n for n in ROT if week_slot(base, 0, n) == "early")
        away = NEW + timedelta(days=1)
        r = build_roster(inputs(weeks=1, leave=[Leave(opener, away, away, "Sick")]))
        moved = [n for n in ROT if r.weeks[0].cells[(n, away)].slot == "early" and week_slot(base, 0, n) != "early"]
        self.assertEqual(len(moved), 1)
        self.assertEqual(week_slot(base, 0, moved[0]), "mid1")
        self.assertEqual([c for c in r.checks if c.rule == "Cover (last resort)"], [])

    def test_a_whole_week_gap_rotates_the_cover_between_people(self):
        base = build_roster(inputs(weeks=1))
        opener = next(n for n in ROT if week_slot(base, 0, n) == "early")
        r = build_roster(inputs(weeks=1, leave=[Leave(opener, NEW, NEW + timedelta(days=4), "Sick")]))
        covers = {
            n
            for d in r.weeks[0].days
            for n in ROT
            if r.weeks[0].cells[(n, d)].slot == "early" and week_slot(base, 0, n) == "mid1"
        }
        self.assertGreaterEqual(len(covers), 2, covers)


if __name__ == "__main__":
    unittest.main()


class BankHoliday(unittest.TestCase):
    def test_a_closure_day_shows_its_label_for_everyone_and_raises_no_breach(self):
        inp = inputs(date(2026, 10, 26), 1, new_start=None)
        inp.settings = dataclasses.replace(inp.settings, closure_days={date(2026, 10, 26): "Bank Holiday"})
        inp.leave = []
        r = build_roster(inp)
        monday = date(2026, 10, 26)
        for key, st in r.staff_keys:
            if st.role in ("blank", "vacant"):
                continue
            self.assertEqual(r.weeks[0].cells[(key, monday)].text, "Bank Holiday", st.name)
        self.assertEqual([c for c in r.checks if c.level == "BREACH"], [])
        self.assertEqual([c for c in r.checks if c.rule == "Pairing policy"], [])
        # The rest of the week is still fully rostered.
        tuesday = date(2026, 10, 27)
        self.assertEqual(sum(r.weeks[0].cells[(n, tuesday)].slot == "early" for n in ROT + ["Jason", "Shehnaz"]), 3)
