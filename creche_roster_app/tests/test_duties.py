"""Tests for duties.build_duty_roster: the weekly cleaning-duty rota, fair
across the rotating staff plus Jason, with Sue and Shehnaz/Priscilla fixed."""

import unittest
from datetime import date, timedelta

from creche_roster.duties import (
    CONTEXT_ROWS,
    DUTY_SLOTS,
    FIXED_DUTIES,
    build_duty_roster,
    duty_fairness,
    duty_pool,
)
from creche_roster.models import Leave
from creche_roster.sample import sample_inputs

START = date(2026, 9, 28)
ROTATING = ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha"]


def inputs(**kw):
    inp = sample_inputs(START)
    inp.leave = kw.get("leave", [])
    inp.settings.weeks = kw.get("weeks", 4)
    return inp


class DutyPool(unittest.TestCase):
    def test_pool_is_rotating_staff_plus_jason_only(self):
        pool = duty_pool(inputs())
        self.assertEqual(set(pool), set(ROTATING) | {"Jason"})
        self.assertNotIn("Sue", pool)
        self.assertNotIn("Shehnaz", pool)
        self.assertNotIn("Priscilla", pool)
        self.assertNotIn("Laura", pool)
        self.assertNotIn("Megan", pool)


class DutyRoster(unittest.TestCase):
    def test_every_duty_slot_filled_and_fixed_duties_stay_fixed(self):
        weeks = build_duty_roster(inputs())
        self.assertEqual(len(weeks), 4)
        for week in weeks:
            self.assertEqual(week["unfilled"], [])
            by_duty = {a["duty"]: a["people"] for a in week["assignments"]}
            self.assertEqual(set(by_duty), set(DUTY_SLOTS) | {n for n, _ in FIXED_DUTIES} | set(CONTEXT_ROWS))
            self.assertEqual(by_duty["Dusting"], ["Sue"])
            self.assertEqual(by_duty["Laundry"], ["Shehnaz", "Priscilla"])
            self.assertEqual(by_duty["Cot Room"], [])
            self.assertEqual(by_duty["Changing Area"], [])

    def test_one_rotating_duty_per_pool_member_per_week(self):
        weeks = build_duty_roster(inputs())
        pool = set(duty_pool(inputs()))
        for week in weeks:
            assigned = [
                p
                for a in week["assignments"]
                if a["duty"] in DUTY_SLOTS
                for p in a["people"]
            ]
            self.assertEqual(len(assigned), len(set(assigned)))  # nobody double-booked
            self.assertEqual(set(assigned), pool)  # everyone present gets exactly one

    def test_nobody_repeats_a_duty_type_while_someone_else_hasnt_had_a_turn(self):
        weeks = build_duty_roster(inputs())
        seen: dict = {}
        for week in weeks:
            for a in week["assignments"]:
                if a["duty"] not in DUTY_SLOTS:
                    continue
                person = a["people"][0]
                if a["duty"] in seen.setdefault(person, set()):
                    self.fail(f"{person} repeated {a['duty']} before everyone else had a turn")
                seen[person].add(a["duty"])

    def test_load_is_equal_over_four_full_weeks(self):
        weeks = build_duty_roster(inputs())
        totals = duty_fairness(inputs(), weeks)
        self.assertEqual(set(totals.values()), {4})  # everyone gets exactly one duty/week

    def test_someone_on_holiday_all_week_is_skipped_that_week_not_double_booked_later(self):
        leave = [Leave("Hanny", START, START + timedelta(days=4), "Holiday")]
        weeks = build_duty_roster(inputs(leave=leave))
        week0_people = [p for a in weeks[0]["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]]
        self.assertNotIn("Hanny", week0_people)
        self.assertEqual(len(weeks[0]["unfilled"]), 1)  # 9 left in the pool, 10 duty slots
        totals = duty_fairness(inputs(leave=leave), weeks)
        self.assertEqual(totals["Hanny"], 3)  # only 3 of the 4 weeks

    def test_someone_on_holiday_all_four_weeks_leaves_a_duty_unfilled(self):
        leave = [
            Leave(n, START, START + timedelta(days=27), "Holiday")
            for n in ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David"]
        ]
        weeks = build_duty_roster(inputs(leave=leave))
        for week in weeks:
            self.assertEqual(len(week["unfilled"]), 8)  # only Usha + Jason left for 10 slots


if __name__ == "__main__":
    unittest.main()
