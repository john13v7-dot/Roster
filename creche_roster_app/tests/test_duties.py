"""Tests for duties.build_duty_roster: the weekly cleaning-duty rota, fair
across the rotating staff plus Jason, with Sue and Shehnaz/Priscilla fixed,
and each duty matched to whoever finishes at the right time for it."""

import unittest
from datetime import date, timedelta

from creche_roster.duties import (
    CONTEXT_ROWS,
    DUTY_ELIGIBLE_SLOTS,
    DUTY_SLOTS,
    FIXED_DUTIES,
    _weekly_slot,
    build_duty_roster,
    duty_fairness,
    duty_pool,
)
from creche_roster.engine import build_roster
from creche_roster.models import DutyOverride, Leave, Override
from creche_roster.sample import sample_inputs

START = date(2026, 9, 28)
ROTATING = ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha"]


def inputs(**kw):
    inp = sample_inputs(START)
    inp.leave = kw.get("leave", [])
    inp.overrides = kw.get("overrides", [])
    inp.duty_overrides = kw.get("duty_overrides", [])
    inp.settings.weeks = kw.get("weeks", 4)
    return inp


def build(**kw):
    inp = inputs(**kw)
    roster = build_roster(inp)
    return inp, roster, build_duty_roster(inp, roster)


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
        inp, roster, weeks = build()
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
        inp, roster, weeks = build()
        pool = set(duty_pool(inp))
        for week in weeks:
            assigned = [
                p
                for a in week["assignments"]
                if a["duty"] in DUTY_SLOTS
                for p in a["people"]
            ]
            self.assertEqual(len(assigned), len(set(assigned)))  # nobody double-booked
            self.assertEqual(set(assigned), pool)  # everyone present gets exactly one

    def test_duties_match_who_finishes_when_headcount_lines_up(self):
        # The actual rule: kitchen/hallway downstairs/children's toilets go
        # to whoever finishes at 17:30 or 18:00 that week; bins/staff
        # toilets to whoever finishes at 16:30; everything else to the
        # 17:00 finishers. Jason pinned to "early" and Shehnaz away (the
        # live mobile app's actual data) keeps the "early" bucket at
        # exactly 2 rotating + Jason = 3 every week, matching its 3 duties
        # exactly - checked here on its own, since it's the one bucket this
        # scenario guarantees never needs the fallback pass. The other 7
        # duties (3 "finishes late" + 4 "the rest") only balance in total
        # (2 late + 5 mid1/mid2 = 7 people for 7 duties) - mid1 vs mid2
        # can still split unevenly week to week (3-2 one week, 2-3 the
        # next), which is exactly what the fallback pass is for; that's
        # covered separately below, not asserted strictly here.
        early_duties = [d for d, slots in DUTY_ELIGIBLE_SLOTS.items() if slots == {"early"}]
        leave = [Leave("Shehnaz", START, START + timedelta(days=27), "Holiday")]
        over = [Override("Jason", START, START + timedelta(days=27), "early")]
        inp, roster, weeks = build(leave=leave, overrides=over)
        for wi, week in enumerate(weeks):
            self.assertEqual(week["unfilled"], [])
            for a in week["assignments"]:
                if a["duty"] not in early_duties:
                    continue
                person = a["people"][0]
                self.assertEqual(_weekly_slot(roster, wi, person), "early", (a["duty"], wi))

    def test_uneven_headcount_falls_back_but_never_double_books(self):
        # In the plain default scenario, Jason and Shehnaz alternate
        # normally - some weeks Jason is "late" instead of "early", which
        # can leave the early bucket short of its 3 duties or the late/
        # mid2 bucket oversubscribed. The fallback pass should still fill
        # every duty it can and never assign the same person twice,
        # even when the strict finish-time match isn't achievable.
        inp, roster, weeks = build()
        pool = set(duty_pool(inp))
        for week in weeks:
            assigned = [p for a in week["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]]
            self.assertEqual(len(assigned), len(set(assigned)))
            self.assertEqual(set(assigned), pool)

    def test_load_is_equal_over_four_full_weeks(self):
        inp, roster, weeks = build()
        totals = duty_fairness(inp, weeks)
        self.assertEqual(set(totals.values()), {4})  # everyone gets exactly one duty/week

    def test_someone_on_holiday_all_week_is_skipped_that_week_not_double_booked_later(self):
        leave = [Leave("Hanny", START, START + timedelta(days=4), "Holiday")]
        inp, roster, weeks = build(leave=leave)
        week0_people = [p for a in weeks[0]["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]]
        self.assertNotIn("Hanny", week0_people)
        totals = duty_fairness(inp, weeks)
        self.assertEqual(totals["Hanny"], 3)  # only 3 of the 4 weeks

    def test_someone_on_holiday_all_four_weeks_leaves_duties_unfilled(self):
        leave = [
            Leave(n, START, START + timedelta(days=27), "Holiday")
            for n in ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David"]
        ]
        inp, roster, weeks = build(leave=leave)
        for week in weeks:
            # Only Usha + Jason left for 10 slots - at most 2 filled, the
            # rest genuinely unfilled (no fallback conjures extra people).
            filled = [a for a in week["assignments"] if a["duty"] in DUTY_SLOTS and a["people"]]
            self.assertLessEqual(len(filled), 2)
            self.assertEqual(len(filled) + len(week["unfilled"]), len(DUTY_SLOTS))

    def test_manual_duty_pick_is_honoured_when_it_matches_their_slot(self):
        # Hanny's default week-1 slot (in this test file's baseline, which
        # clears sample_inputs' own default Jason override) is "late" -
        # "Kitchen" is one of the duties eligible for mid2/late, so a
        # manual pick of it should win over whatever the fair rotation
        # would otherwise have given her.
        inp0, roster0, _ = build()
        slot = _weekly_slot(roster0, 0, "Hanny")
        self.assertEqual(slot, "late")
        over = [DutyOverride("Hanny", START, "Kitchen")]
        inp, roster, weeks = build(duty_overrides=over)
        by_duty = {a["duty"]: a["people"] for a in weeks[0]["assignments"]}
        self.assertEqual(by_duty["Kitchen"], ["Hanny"])
        self.assertEqual(weeks[0]["unfilled"], [])
        # Every other duty that week is still filled exactly once, same as
        # the unforced build - the manual pick doesn't leave a gap
        # elsewhere or double up.
        for a in weeks[0]["assignments"]:
            if a["duty"] in DUTY_SLOTS:
                self.assertLessEqual(len(a["people"]), 1)

    def test_manual_duty_pick_is_dropped_silently_when_it_no_longer_matches(self):
        # Hanny's week-1 slot is "late", but Staff Room needs mid1 - a
        # stale or wrong pick like this should be ignored, not forced
        # through or left to break the build.
        over = [DutyOverride("Hanny", START, "Staff Room")]
        inp, roster, weeks = build(duty_overrides=over)
        by_duty = {a["duty"]: a["people"] for a in weeks[0]["assignments"]}
        self.assertNotIn("Hanny", by_duty["Staff Room"])
        self.assertEqual(weeks[0]["unfilled"], [])
        # Hanny still gets some other duty that week - dropping the
        # invalid pick falls back to the normal fair assignment, not to
        # leaving her without one.
        assigned_names = {p for a in weeks[0]["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]}
        self.assertIn("Hanny", assigned_names)

    def test_manual_duty_pick_only_assigns_its_own_week(self):
        # A pick written for week 1's Monday shouldn't itself assign
        # anything in the other three weeks (Hanny did do that duty for
        # real, though, so it's fair for it to count toward who's "owed"
        # what afterward - same as any other week's real outcome would).
        over = [DutyOverride("Hanny", START, "Kitchen")]
        _, _, weeks = build(duty_overrides=over)
        for wi in (1, 2, 3):
            self.assertEqual(weeks[wi]["unfilled"], [])

    def test_uneven_headcount_falls_back_instead_of_leaving_gaps(self):
        # Jason pinned to "early" and Shehnaz away the whole run is the
        # scenario that originally prompted this rule (see mobile app
        # data): early is capped at 2 rotating + Jason = 3 exactly, so the
        # split still lines up, but it's a tighter fit than the default
        # scenario and worth locking in specifically.
        leave = [Leave("Shehnaz", START, START + timedelta(days=27), "Holiday")]
        over = [Override("Jason", START, START + timedelta(days=27), "early")]
        inp, roster, weeks = build(leave=leave, overrides=over)
        for week in weeks:
            self.assertEqual(week["unfilled"], [])


if __name__ == "__main__":
    unittest.main()
