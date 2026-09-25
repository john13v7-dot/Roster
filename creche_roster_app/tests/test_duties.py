"""Tests for duties.build_duty_roster: the weekly cleaning-duty rota, fair
across the rotating staff plus Jason, with Sue and Shehnaz/Priscilla fixed,
and each duty matched to whoever finishes at the right time for it."""

import unittest
from datetime import date, timedelta

from creche_roster.duties import (
    CONTEXT_ROWS,
    DUTY_ELIGIBLE_SLOTS,
    DUTY_MIN_SLOT,
    DUTY_SLOTS,
    FIXED_DUTIES,
    _weekly_slot,
    build_duty_roster,
    duty_fairness,
    duty_pool,
)
from creche_roster.engine import build_roster
from creche_roster.models import SLOTS, DutyOverride, Leave, Override
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

    def test_fallback_never_assigns_someone_who_finishes_too_early(self):
        # The bug this guards against: a duty's fallback pass used to hand
        # it to whoever was left over, with no regard for whether they'd
        # actually still be there. Every real assignment - fallback or not
        # - must go to someone whose own finish time is at least as late as
        # the duty needs, never earlier.
        inp, roster, weeks = build()
        for wi, week in enumerate(weeks):
            for a in week["assignments"]:
                if a["duty"] not in DUTY_SLOTS or not a["people"]:
                    continue
                person = a["people"][0]
                slot = _weekly_slot(roster, wi, person)
                self.assertIsNotNone(slot, (a["duty"], person, wi))
                self.assertGreaterEqual(
                    SLOTS.index(slot), SLOTS.index(DUTY_MIN_SLOT[a["duty"]]),
                    f"{person} (finishes {slot}) assigned {a['duty']!r} in week {wi + 1}, "
                    f"but they'd already have left before it needs doing",
                )

    def test_shortfall_rotates_rather_than_pinning_one_person(self):
        # The reported bug: David kept landing on the same duty every
        # single week. That happened because the pool of people eligible
        # for the chronically-under-supplied mid1 bucket (more duties need
        # it than the rotation typically puts there) tied on duty-specific
        # and total history most weeks, and a *fixed* tie-break resolved
        # that tie the same way every time - so whichever duty came up
        # short always landed on the same person. Over an 8-week run with
        # the same recurring shortfall (Shehnaz away, Jason pinned early,
        # as in test_duties_match_who_finishes_when_headcount_lines_up),
        # nobody should be stuck with one single duty for the whole run.
        leave = [Leave("Shehnaz", START, START + timedelta(weeks=8) - timedelta(days=1), "Holiday")]
        over = [Override("Jason", START, START + timedelta(weeks=8) - timedelta(days=1), "early")]
        inp, roster, weeks = build(leave=leave, overrides=over, weeks=8)
        pool = duty_pool(inp)
        per_person = {n: [] for n in pool}
        for week in weeks:
            for a in week["assignments"]:
                if a["duty"] in DUTY_SLOTS:
                    for p in a["people"]:
                        per_person[p].append(a["duty"])
        for name, duties_done in per_person.items():
            if len(duties_done) < 2:
                continue
            self.assertGreater(
                len(set(duties_done)), 1,
                f"{name} was assigned {duties_done[0]!r} in every one of their "
                f"{len(duties_done)} weeks - never rotated to anything else",
            )

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

    def test_one_day_away_still_gets_a_duty_that_week(self):
        # The reported bug: someone away for just one day of the week used
        # to drop out of that whole week's duty pool entirely (duty pool
        # eligibility required being rostered every single day), which
        # could tip an already-tight slot into "nobody free" even though
        # the person was there for 4 of the 5 days.
        leave = [Leave("Irene", START + timedelta(days=4), START + timedelta(days=4), "Holiday")]  # Friday only
        inp, roster, weeks = build(leave=leave)
        week0_people = [p for a in weeks[0]["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]]
        self.assertIn("Irene", week0_people)
        self.assertEqual(weeks[0]["unfilled"], [])

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
        # Manuel's week-1 slot is "early", but Kitchen needs at least mid2
        # (DUTY_MIN_SLOT) - he'd have already left before it could even
        # start, so a stale or wrong pick like this should be ignored, not
        # forced through or left to break the build.
        over = [DutyOverride("Manuel", START, "Kitchen")]
        inp, roster, weeks = build(duty_overrides=over)
        by_duty = {a["duty"]: a["people"] for a in weeks[0]["assignments"]}
        self.assertNotIn("Manuel", by_duty["Kitchen"])
        self.assertEqual(weeks[0]["unfilled"], [])
        # Manuel still gets some other duty that week - dropping the
        # invalid pick falls back to the normal fair assignment, not to
        # leaving him without one.
        assigned_names = {p for a in weeks[0]["assignments"] if a["duty"] in DUTY_SLOTS for p in a["people"]}
        self.assertIn("Manuel", assigned_names)

    def test_manual_duty_pick_is_honoured_when_they_finish_later_than_the_ideal_match(self):
        # Hanny's week-1 slot is "mid1", which finishes later than Staff
        # Toilet upstairs (an early-finishers duty) actually needs - she's
        # there plenty long enough to cover it, so a manager's own pick
        # should be honoured on the same "finishes at least as late as
        # needed" standard the automatic fallback (Pass 2) already uses,
        # not held to the narrower ideal-match set Pass 1 reaches for
        # first.
        over = [DutyOverride("Hanny", START, "Staff Toilet upstairs")]
        inp, roster, weeks = build(duty_overrides=over)
        by_duty = {a["duty"]: a["people"] for a in weeks[0]["assignments"]}
        self.assertIn("Hanny", by_duty["Staff Toilet upstairs"])

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
