"""Fair weekly assignment of the printed cleaning-duty rota.

Cot Room / Changing Area are filled by whoever is already working that
room, so they carry no named assignment. Dusting and Laundry are fixed to
the same person(s) every week, per the paper roster, and are never part of
the rotation. Everyone else on the duty rota - the rotating shift staff,
plus Jason, who still takes a duty even though his shift itself is on the
separate pairing rota with Shehnaz - gets exactly one of the remaining
duties each week, matched to how long they're actually there for (the
duty that takes more time goes to whoever finishes latest that week), and
otherwise chosen to keep both duty-type variety and overall load fair over
time.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Dict, FrozenSet, List, Optional

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

# Which shift end time each duty belongs to (by slot: early=16:30,
# mid1=17:00, mid2=17:30, late=18:00). Kitchen/hallway downstairs/
# children's toilets take longer, so they go to whoever finishes latest
# (17:30 or 18:00); bins/staff toilets are quick, for whoever finishes
# earliest (16:30); everything else goes to the 17:00 finishers. When a
# week's actual headcount doesn't split this cleanly (someone on leave,
# an uneven shift mix), build_duty_roster() falls back to filling what's
# left from whoever's still free, rather than leaving a duty undone or a
# person without one.
DUTY_ELIGIBLE_SLOTS: Dict[str, FrozenSet[str]] = {
    "Kitchen": frozenset({"mid2", "late"}),
    "Hallway downstairs / windows / door handles": frozenset({"mid2", "late"}),
    "Children's Toilets": frozenset({"mid2", "late"}),
    "Back Garden & Bins": frozenset({"early"}),
    "Staff Toilet upstairs": frozenset({"early"}),
    "Staff Toilet": frozenset({"early"}),
    "Hallway upstairs / Hoover stairs upstairs": frozenset({"mid1"}),
    "Staff Room": frozenset({"mid1"}),
    "Front creche": frozenset({"mid1"}),
    "Paper & Soap dispensers": frozenset({"mid1"}),
}

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


def _present_all_week(inputs: Inputs, name: str, days: List[date]) -> bool:
    st = next((s for s in inputs.staff if s.name == name), None)
    if st is None:
        return False
    for d in days:
        if st.start_date and d < st.start_date:
            return False
        if st.end_date and d > st.end_date:
            return False
        if any(lv.name == name and lv.covers(d) for lv in inputs.leave):
            return False
    return True


def _weekly_slot(roster: Roster, week_index: int, name: str) -> Optional[str]:
    """The slot (early/mid1/mid2/late) `name` actually works on most days
    of week `week_index` - what decides their shift end time for duty
    purposes. None if they have no shift day that week (fully on leave,
    already excluded from that week's duty pool by _present_all_week)."""
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

    Each duty first goes to whoever's eligible for it (by finish time) and
    has done that duty type least so far; someone left without a duty
    because their own bucket ran out, or a duty left unfilled because its
    bucket came up short (leave, an uneven shift mix that week), is then
    matched up from whoever/whatever's left over, same least-done-first
    rule, rather than staying empty when a reasonable match exists.
    """
    pool = duty_pool(inputs)
    history: Dict[str, Counter] = {n: Counter() for n in pool}
    weeks_out: List[Dict] = []
    for wi in range(inputs.settings.weeks):
        monday = inputs.settings.roster_start + timedelta(weeks=wi)
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        remaining = [n for n in pool if _present_all_week(inputs, n, days)]
        slot_of = {n: _weekly_slot(roster, wi, n) for n in remaining}
        assigned_by_duty: Dict[str, str] = {}

        def best_pick(candidates: List[str], duty: str) -> str:
            return min(
                candidates,
                key=lambda n: (history[n][duty], sum(history[n].values()), pool.index(n)),
            )

        # Rotate which duty gets first pick within its own bucket each
        # week - a fixed processing order would always let the same duty
        # claim whoever's most under-served, forcing the others into
        # repeats sooner than the fair-load actually requires. Display
        # order stays fixed (DUTY_SLOTS); only the pick order rotates.
        offset = wi % len(DUTY_SLOTS)
        pick_order = DUTY_SLOTS[offset:] + DUTY_SLOTS[:offset]

        # Pass 0: the manager's manual picks for this week, honoured only
        # when the person's actually working that week and the duty still
        # matches the shift they're actually on now - a pick that's gone
        # stale (their shift changed since) is dropped silently and falls
        # back to the normal fair pick below, rather than forcing a
        # mismatch through or leaving the build broken.
        for ov in inputs.duty_overrides:
            if ov.week != monday or ov.duty not in DUTY_SLOTS:
                continue
            if ov.duty in assigned_by_duty or ov.name not in remaining:
                continue
            if slot_of.get(ov.name) not in DUTY_ELIGIBLE_SLOTS[ov.duty]:
                continue
            remaining.remove(ov.name)
            history[ov.name][ov.duty] += 1
            assigned_by_duty[ov.duty] = ov.name

        # Pass 1: strictly by finish time - the actual rule.
        for duty in pick_order:
            if duty in assigned_by_duty:
                continue
            eligible = [n for n in remaining if slot_of.get(n) in DUTY_ELIGIBLE_SLOTS[duty]]
            if not eligible:
                continue
            person = best_pick(eligible, duty)
            remaining.remove(person)
            history[person][duty] += 1
            assigned_by_duty[duty] = person

        # Pass 2: whatever's left over - a duty whose bucket came up short,
        # or a person whose bucket had no duty left for them - paired up
        # the same fair way, rather than left undone when the other still
        # has an obvious match.
        for duty in pick_order:
            if duty in assigned_by_duty or not remaining:
                continue
            person = best_pick(remaining, duty)
            remaining.remove(person)
            history[person][duty] += 1
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
            present = [n for n in names if _present_all_week(inputs, n, days)]
            assignments.append({"duty": duty, "people": present or names})
        weeks_out.append({"monday": monday, "assignments": assignments, "unfilled": unfilled})
    return weeks_out


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
