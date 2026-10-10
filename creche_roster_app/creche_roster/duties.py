"""Fair weekly assignment of the printed cleaning-duty rota.

Cot Room / Changing Area are filled by whoever is already working that
room, so they carry no named assignment. Dusting and Laundry are fixed to
the same person(s) every week, per the paper roster, and are never part of
the rotation. Everyone else on the duty rota - the rotating shift staff,
plus Jason, who still takes a duty even though his shift itself is on the
separate pairing rota with Shehnaz - gets exactly one of the remaining
duties each week, matched to how long they're actually there for (the
duty that takes more time goes to whoever finishes latest that week,
falling back to anyone who finishes at least that late when the ideal
match isn't available - never to someone who'd have already left), and
otherwise chosen to keep both duty-type variety and overall load fair over
time: whoever's done that exact duty least goes first, a tie there goes to
whoever's gone longest since they last did it (never done it beats having
done it any number of weeks ago), and a further tie on total load rotates
week to week too - a fixed tie-break would let the same structural
shortfall (there are always more 17:00-finish duties than 17:00
finishers) land on the same one or two people every time instead of
spreading it around.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Dict, FrozenSet, List, Optional, Tuple

from .models import NDAYS, SLOTS, Inputs, Roster

# In the fixed order the paper roster lists them, minus Dusting/Laundry
# (fixed, below) and Cot Room/Changing Area (not a named assignment).
DUTY_SLOTS: List[str] = [
    "Hallway upstairs / Hoover stairs upstairs",
    "Children's Toilets",
    "Staff Toilet upstairs",
    "Kitchen",
    "Staff Room",
    "Hallway downstairs / windows / door handles",
    "Staff Toilet",
    "Back Garden & Bins",
    "Front creche",
    "Paper & Soap dispensers",
]

# Which shift end time each duty is best matched to (by slot: early=16:30,
# mid1=17:00, mid2=17:30, late=18:00). Kitchen/hallway downstairs/
# children's toilets take longer, so they're best matched to whoever
# finishes latest (17:30 or 18:00); bins/staff toilets are quick, best for
# whoever finishes earliest (16:30); everything else best fits the 17:00
# finishers - except Staff Room, Front creche and Paper & Soap dispensers,
# which the real printed roster (two weeks running) shows going to whoever
# finishes at 16:30 too, not just 17:00 - Jason (always 7:30-4:30) rotates
# through Front creche and Paper & Soap dispensers, and Staff Room went to
# an early finisher (Hanny, then Manuel) both weeks - so 16:30 counts as an
# ideal match for these three as well, not only a fallback. That's the
# first thing build_duty_roster() tries. Someone finishing later than a
# duty needs is still there long enough to cover it though, so when the
# ideal match for a duty isn't available that week (someone on leave, an
# uneven shift mix), it falls back to whoever's free and finishes at least
# that late - never to someone who'd already have left before the duty's
# actually done.
DUTY_ELIGIBLE_SLOTS: Dict[str, FrozenSet[str]] = {
    "Kitchen": frozenset({"mid2", "late"}),
    "Hallway downstairs / windows / door handles": frozenset({"mid1", "mid2", "late"}),
    "Children's Toilets": frozenset({"mid2", "late"}),
    "Back Garden & Bins": frozenset({"early"}),
    "Staff Toilet upstairs": frozenset({"early"}),
    "Staff Toilet": frozenset({"early"}),
    "Hallway upstairs / Hoover stairs upstairs": frozenset({"mid1"}),
    "Staff Room": frozenset({"early", "mid1"}),
    "Front creche": frozenset({"early", "mid1"}),
    "Paper & Soap dispensers": frozenset({"early", "mid1"}),
}

# The earliest finish time that still covers each duty - the fallback
# floor: whoever finishes at this slot or later can stand in when the
# duty's ideal match (DUTY_ELIGIBLE_SLOTS, above) isn't available.
DUTY_MIN_SLOT: Dict[str, str] = {duty: min(slots, key=SLOTS.index) for duty, slots in DUTY_ELIGIBLE_SLOTS.items()}

# Filled by whoever's already working that room - never a named, rotating
# assignment.
CONTEXT_ROWS: List[str] = ["Cot Room", "Changing Area"]

# Always the same person/pair every week, per the paper roster.
FIXED_DUTIES: List[tuple] = [
    ("Dusting", ["Sue"]),
    ("Laundry", ["Shehnaz", "Priscilla"]),
]

# Paired staff share the shift rota with Shehnaz, but on duties Jason still
# takes a rotating turn like everyone else; Shehnaz doesn't (she's fixed to
# Laundry, above).
EXTRA_POOL: List[str] = ["Jason"]


def duty_pool(inputs: Inputs) -> List[str]:
    """Everyone eligible for a rotating duty, in staff-list order."""
    fixed_names = {n for _, names in FIXED_DUTIES for n in names}
    pool = [
        st.name for st in inputs.staff
        if st.role == "rotating" and st.name and st.name not in fixed_names
    ]
    for n in EXTRA_POOL:
        if n not in pool and any(st.name == n for st in inputs.staff):
            pool.append(n)
    return pool


def _present_most_of_week(inputs: Inputs, name: str, days: List[date]) -> bool:
    """True if `name` is rostered for more than half of `days` - present
    enough of the week to meaningfully take a duty for it. A single day
    away (a one-off appointment, say) shouldn't drop someone out of the
    whole week's duty rotation - only being away most or all of the week
    should. A day doesn't count as present if it's before their start
    date, after their end date, or covered by leave."""
    st = next((s for s in inputs.staff if s.name == name), None)
    if st is None:
        return False
    present_days = 0
    for d in days:
        if st.start_date and d < st.start_date:
            continue
        if st.end_date and d > st.end_date:
            continue
        if any(lv.name == name and lv.covers(d) for lv in inputs.leave):
            continue
        present_days += 1
    return present_days * 2 > len(days)


def _weekly_slot(roster: Roster, week_index: int, name: str) -> Optional[str]:
    """The slot (early/mid1/mid2/late) `name` actually works on most days
    of week `week_index` - what decides their shift end time for duty
    purposes. None if they have no shift day that week (fully on leave,
    already excluded from that week's duty pool by _present_most_of_week)."""
    week = roster.weeks[week_index]
    cells = week.cells
    slots = [cells[(name, d)].slot for d in week.days if cells.get((name, d), None) and cells[(name, d)].kind == "shift"]
    if not slots:
        return None
    counts = Counter(slots)
    return max(counts, key=lambda sl: (counts[sl], -SLOTS.index(sl)))


def build_duty_roster(inputs: Inputs, roster: Roster) -> List[Dict]:
    """One entry per week: {"monday", "assignments": [{"duty", "people"}...],
    "unfilled": [duty names nobody was free for that week]}.

    `roster` is the already-built shift roster for the same `inputs`
    (engine.build_roster(inputs)) - duty eligibility depends on which
    shift each person is actually working that week (see
    DUTY_ELIGIBLE_SLOTS), so the shift rota has to exist first.

    Each duty first goes to whoever's ideally matched to it (by finish
    time) and has done that duty type least so far; if that bucket comes up
    short that week (leave, an uneven shift mix), it falls back to anyone
    still free who finishes at least as late - never to someone who'd
    already have left. Only stays unfilled if even that has nobody left.
    """
    pool = duty_pool(inputs)
    history: Dict[str, Counter] = {n: Counter() for n in pool}
    # The week index each person most recently did each duty - a very
    # negative sentinel (bigger than any real gap) for "never". Lets a
    # tie on duty-specific and total history favour whoever's gone
    # longest without this exact duty, so a chronically-tight slot (more
    # duties need the same bucket than the rotation puts there most
    # weeks) spreads its repeats out across weeks instead of letting two
    # people trade it back and forth every other week.
    last_done: Dict[str, Counter] = {n: Counter() for n in pool}
    NEVER = -(inputs.settings.weeks + 1)
    weeks_out: List[Dict] = []
    for wi in range(inputs.settings.weeks):
        monday = inputs.settings.roster_start + timedelta(weeks=wi)
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        remaining = [n for n in pool if _present_most_of_week(inputs, n, days)]
        slot_of = {n: _weekly_slot(roster, wi, n) for n in remaining}
        assigned_by_duty: Dict[str, str] = {}

        # Who wins a tie (same duty-specific and total history, and the
        # same gap since they last did this exact duty) rotates by week
        # too. Total load tends to march in lockstep across the whole
        # pool - most weeks hand out almost exactly one duty each - so a
        # *fixed* tie-break would keep resolving the same tie the same way
        # every week, pinning whichever structural shortfall recurs (there
        # are always more 17:00-finish duties than 17:00 finishers) onto
        # one person permanently instead of spreading it around.
        tie_offset = wi % len(pool)
        tie_order = pool[tie_offset:] + pool[:tie_offset]

        def best_pick(candidates: List[str], duty: str) -> str:
            return min(
                candidates,
                key=lambda n: (
                    history[n][duty],
                    -(wi - last_done[n].get(duty, NEVER)),
                    sum(history[n].values()),
                    tie_order.index(n),
                ),
            )

        # Rotate which duty gets first pick within its own bucket each
        # week - a fixed processing order would always let the same duty
        # claim whoever's most under-served, forcing the others into
        # repeats sooner than the fair-load actually requires. Display
        # order stays fixed (DUTY_SLOTS); only the pick order rotates.
        offset = wi % len(DUTY_SLOTS)
        pick_order = DUTY_SLOTS[offset:] + DUTY_SLOTS[:offset]

        # Pass 0: the manager's manual picks for this week, honoured only
        # when the person's actually working that week and they're there
        # long enough to actually do it - the same "finishes at least as
        # late as the duty needs" standard Pass 2's own fallback uses
        # below, not the narrower ideal-match set Pass 1 reaches for first.
        # A manual pick is a deliberate choice, not a fairness ranking, so
        # it only needs to be physically possible, same as the automatic
        # fallback already allows; a pick that's gone properly stale (they
        # now finish before the duty could even start) is dropped silently
        # and falls back to the normal fair pick below, rather than
        # forcing a mismatch through or leaving the build broken.
        for ov in inputs.duty_overrides:
            if ov.week != monday or ov.duty not in DUTY_SLOTS:
                continue
            if ov.duty in assigned_by_duty or ov.name not in remaining:
                continue
            ov_slot = slot_of.get(ov.name)
            if not ov_slot or SLOTS.index(ov_slot) < SLOTS.index(DUTY_MIN_SLOT[ov.duty]):
                continue
            remaining.remove(ov.name)
            history[ov.name][ov.duty] += 1
            last_done[ov.name][ov.duty] = wi
            assigned_by_duty[ov.duty] = ov.name

        # Pass 1: the ideal match - ties to the actual finish-time bucket
        # each duty is designed for.
        for duty in pick_order:
            if duty in assigned_by_duty:
                continue
            eligible = [n for n in remaining if slot_of.get(n) in DUTY_ELIGIBLE_SLOTS[duty]]
            if not eligible:
                continue
            person = best_pick(eligible, duty)
            remaining.remove(person)
            history[person][duty] += 1
            last_done[person][duty] = wi
            assigned_by_duty[duty] = person

        # Pass 2: the safe fallback, for whatever's still unfilled - anyone
        # who finishes at least as late as the duty needs (DUTY_MIN_SLOT)
        # can stand in, since they're there long enough to cover it; never
        # someone finishing earlier, who'd have already left.
        for duty in pick_order:
            if duty in assigned_by_duty or not remaining:
                continue
            min_index = SLOTS.index(DUTY_MIN_SLOT[duty])
            eligible = [n for n in remaining if slot_of.get(n) and SLOTS.index(slot_of[n]) >= min_index]
            if not eligible:
                continue
            person = best_pick(eligible, duty)
            remaining.remove(person)
            history[person][duty] += 1
            last_done[person][duty] = wi
            assigned_by_duty[duty] = person

        unfilled = [duty for duty in DUTY_SLOTS if duty not in assigned_by_duty]

        # Display order matches the paper roster: room-based rows first,
        # then the named rotating duties, then the two fixed ones at the
        # bottom - the pick order above only affects who gets picked, not
        # where a duty prints.
        assignments: List[Dict] = [{"duty": duty, "people": []} for duty in CONTEXT_ROWS]
        assignments += [
            {"duty": duty, "people": [assigned_by_duty[duty]] if duty in assigned_by_duty else []}
            for duty in DUTY_SLOTS
        ]
        for duty, names in FIXED_DUTIES:
            present = [n for n in names if _present_most_of_week(inputs, n, days)]
            assignments.append({"duty": duty, "people": present or names})
        weeks_out.append({"monday": monday, "assignments": assignments, "unfilled": unfilled})
    return weeks_out


# --------------------------------------------------------------------------
# Protected (locked) weeks - the duty-rota equivalent of
# engine.py's extract_locked_slots()/build_protected_roster(), so a
# later, unrelated change doesn't reshuffle who's on which duty in a week
# that's already been shared with staff.
# --------------------------------------------------------------------------
def extract_locked_duties(duty_weeks: List[Dict]) -> Dict[str, Dict[str, List[str]]]:
    """{monday_iso: {duty_name: [people]}} for every rotating duty slot
    (DUTY_SLOTS only - CONTEXT_ROWS/FIXED_DUTIES never vary, so there's
    nothing to protect there) - the shape settings/lockedDuties stores."""
    out: Dict[str, Dict[str, List[str]]] = {}
    for dw in duty_weeks:
        out[dw["monday"].isoformat()] = {
            a["duty"]: a["people"] for a in dw["assignments"] if a["duty"] in DUTY_SLOTS
        }
    return out


def build_protected_duty_roster(
    inputs: Inputs,
    roster: Roster,
    locked_duties: Dict[str, Dict[str, List[str]]],
    touched_ranges: List[Tuple[date, date]],
) -> List[Dict]:
    """Like build_duty_roster(), but any week none of whose days fall in
    touched_ranges is pinned to its locked_duties entry instead of
    freshly computed - so one new leave/override/duty pick only ever
    changes the duty rota for the week(s) its own dates cover, never
    reshuffles who's on which duty in a week already shared with staff.

    This needs no correction-and-reconverge loop the way
    build_protected_roster() (the shift-rota's own version) does: who's
    eligible for a duty depends only on who's present that week (leave)
    and their weekly shift slot, and both of those are themselves frozen
    for any week the shift roster's own protection left untouched - so a
    locked duty assignment for an untouched week is still valid, not
    just previously valid, and can simply be substituted in.

    Callers that want this build's results to become the NEW lock for
    the weeks that were open should call extract_locked_duties(result)
    for just those weeks' entries and merge that into their stored
    lockedDuties - never the whole thing, which would overwrite the lock
    with this build's output and silently stop protecting anything.
    """
    duty_weeks = build_duty_roster(inputs, roster)

    def week_is_touched(monday: date) -> bool:
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        return any(a <= d <= b for a, b in touched_ranges for d in days)

    for dw in duty_weeks:
        if week_is_touched(dw["monday"]):
            continue
        locked_week = locked_duties.get(dw["monday"].isoformat())
        if not locked_week:
            continue
        for a in dw["assignments"]:
            if a["duty"] in locked_week:
                a["people"] = locked_week[a["duty"]]
        dw["unfilled"] = [
            duty for duty in DUTY_SLOTS
            if not next((a["people"] for a in dw["assignments"] if a["duty"] == duty), None)
        ]
    return duty_weeks


def duty_fairness(inputs: Inputs, weeks: List[Dict]) -> Dict[str, int]:
    """Total duty count per pool member across the built weeks - the tally
    for the fairness log, separate from the assignment itself."""
    totals = {n: 0 for n in duty_pool(inputs)}
    for week in weeks:
        for a in week["assignments"]:
            for p in a["people"]:
                if p in totals:
                    totals[p] += 1
    return totals
