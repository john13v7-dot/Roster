"""Fair weekly assignment of the printed cleaning-duty rota.

Cot Room / Changing Area are filled by whoever is already working that
room, so they carry no named assignment. Dusting and Laundry are fixed to
the same person(s) every week, per the paper roster, and are never part of
the rotation. Everyone else on the duty rota - the rotating shift staff,
plus Jason, who still takes a duty even though his shift itself is on the
separate pairing rota with Shehnaz - gets exactly one of the remaining
duties each week, chosen to keep both duty-type variety and overall load
fair over time.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Dict, List

from .models import NDAYS, Inputs

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


def build_duty_roster(inputs: Inputs) -> List[Dict]:
    """One entry per week: {"monday", "assignments": [{"duty", "people"}...],
    "unfilled": [duty names nobody was free for that week]}.

    Each week, every duty goes to whoever in the pool has done that duty
    type least so far, tie-broken by fewest duties overall then pool order -
    the same least-done-first idea the shift rota's fairness uses, just
    counting duty types instead of shift slots.
    """
    pool = duty_pool(inputs)
    history: Dict[str, Counter] = {n: Counter() for n in pool}
    weeks_out: List[Dict] = []
    for wi in range(inputs.settings.weeks):
        monday = inputs.settings.roster_start + timedelta(weeks=wi)
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        remaining = [n for n in pool if _present_all_week(inputs, n, days)]
        assigned_by_duty: Dict[str, str] = {}
        unfilled: List[str] = []
        # Rotate which duty gets first pick of the least-done candidate each
        # week - a fixed processing order would always let the same early
        # duties claim whoever's most under-served, forcing the later ones
        # into repeats sooner than the fair-load actually requires. Display
        # order stays fixed (DUTY_SLOTS); only the pick order rotates.
        offset = wi % len(DUTY_SLOTS)
        pick_order = DUTY_SLOTS[offset:] + DUTY_SLOTS[:offset]
        for duty in pick_order:
            if not remaining:
                unfilled.append(duty)
                continue
            person = min(
                remaining,
                key=lambda n: (history[n][duty], sum(history[n].values()), pool.index(n)),
            )
            remaining.remove(person)
            history[person][duty] += 1
            assigned_by_duty[duty] = person
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
