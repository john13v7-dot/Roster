"""Fair weekly assignment of the printed cleaning-duty rota.

Cot Room / Changing Area are filled by whoever is already working that
room, so they carry no named assignment. Dusting and Laundry are fixed to
the same person(s) every week, per the paper roster, and are never part of
the rotation. Everyone else on the duty rota - the rotating shift staff,
plus Jason, who still takes a duty even though his shift itself is on the
separate pairing rota with Shehnaz - gets one of the remaining duties each
week.

Each week is planned as a whole (a minimum-cost matching of people to
duties, see build_duty_roster): nobody gets a duty they'd have already
left for, nobody repeats a duty within 6 weeks (REPEAT_GAP_WEEKS, counting
archived and already-shared weeks), as many duties as possible are filled
(Paper & Soap dispensers, then Front creche, are left blank first when a
week is short), each duty goes to its ideal finish time where possible,
and otherwise whoever's done that duty least / longest ago goes first.
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
    "Bins",
    "Back Garden",
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
    "Bins": frozenset({"early"}),
    "Back Garden": frozenset({"mid1", "mid2"}),
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

# Duties that go ONLY to the shifts listed for them above - nobody finishing
# earlier or later is ever picked: Bins to the 7:30 starters (early), Back
# Garden to the 17:00 / 17:30 finishers (mid1, mid2). If nobody fits that
# week the duty is left blank and flagged, rather than given to the wrong
# shift.
STRICT_DUTIES: FrozenSet[str] = frozenset({"Bins", "Back Garden"})

# Weeks saved before Bins and Back Garden were split carry this one old
# duty; such a week is re-planned (keeping the other duties where it can)
# instead of being pinned.
LEGACY_DUTY = "Back Garden & Bins"

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


# Nobody does the same duty twice within any 6 consecutive weeks - a
# hard rule, not a preference: once someone's done a duty, they're not
# picked for it again for the next 5 weeks, counting archived weeks
# (rosterHistory) and already-shared (locked) weeks too, not just the
# ones this build computes. Only a manager's manual pick can break it
# (shown as a warning, never blocked).
REPEAT_GAP_WEEKS = 6

# When there are more people than duties (an eleventh person joins the
# rota), one late-finish duty a week is shared by two people so everyone has
# a duty. Which one rotates through these, by calendar week, so it doesn't
# shift when the roster window moves.
SHARED_CANDIDATES: List[str] = [
    "Kitchen",
    "Children's Toilets",
    "Hallway downstairs / windows / door handles",
]
_SHARE_BLANK = 5 * 10 ** 8  # leaving the shared slot empty costs less than a real duty blank, more than any pick

# When a week has fewer people than duties (or the no-repeat rule plus
# finish times leave a duty with nobody), these are left blank first -
# the least important duties, in the order the manager ranked them.
BLANK_FIRST: List[str] = ["Paper & Soap dispensers", "Front creche"]

# Cost weights for the per-week assignment (all integers, so the Python
# engine and its JS port pick identically). Each tier dwarfs the sum of
# every tier below it:
#   - a duty left blank costs far more than any real pick, so as many
#     duties as possible get filled;
#   - blanking anything other than BLANK_FIRST costs more again on top;
#   - in a week that was already shared (keep_weeks), moving anyone off
#     the duty they were already given comes next - so a sick day or a
#     manual pick only moves the duties it actually has to;
#   - giving a duty to someone outside its ideal finish-time bucket
#     (DUTY_ELIGIBLE_SLOTS) is the next thing avoided;
#   - then whoever's done this duty least, then whoever's gone longest
#     without it, then a week-rotating tie-break.
_FORBID = 10 ** 12
_BLANK = 10 ** 9
_BLANK_IMPORTANT = 10 ** 7
_MOVED = 10 ** 6
_NOT_IDEAL = 10 ** 5
_PER_TIME_DONE = 10 ** 3
_PER_WEEK_RECENT = 10
_RECENCY_CAP = len(DUTY_SLOTS)


def _min_cost_assignment(cost: List[List[int]]) -> List[int]:
    """Hungarian algorithm (rows <= cols): the column chosen for each row
    so the total cost is as small as possible. Plain integer arithmetic
    and a fixed scan order, so mobile/engine.js's port picks the exact
    same answer."""
    n = len(cost)
    if not n:
        return []
    m = len(cost[0])
    u = [0] * (n + 1)
    v = [0] * (m + 1)
    p = [0] * (m + 1)
    way = [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [None] * (m + 1)
        used = [False] * (m + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = None
            j1 = 0
            for j in range(1, m + 1):
                if used[j]:
                    continue
                cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                if minv[j] is None or cur < minv[j]:
                    minv[j] = cur
                    way[j] = j0
                if delta is None or minv[j] < delta:
                    delta = minv[j]
                    j1 = j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    result = [-1] * n
    for j in range(1, m + 1):
        if p[j]:
            result[p[j] - 1] = j - 1
    return result


def _week_index(inputs: Inputs, monday: date) -> int:
    return (monday - inputs.settings.roster_start).days // 7


def build_duty_roster(
    inputs: Inputs,
    roster: Roster,
    prior_weeks: Optional[Dict[str, Dict[str, List[str]]]] = None,
    pinned_weeks: Optional[Dict[str, Dict[str, List[str]]]] = None,
    keep_weeks: Optional[Dict[str, Dict[str, List[str]]]] = None,
) -> List[Dict]:
    """One entry per week: {"monday", "assignments": [{"duty", "people"}...],
    "unfilled": [duty names left blank that week], "repeat_picks":
    [{"duty", "name", "weeks_ago"}...] (manual picks that break the
    no-repeat rule - shown as a warning, never blocked)}.

    `roster` is the already-built shift roster for the same `inputs`
    (engine.build_roster(inputs)) - who can take which duty depends on
    which shift each person is actually working that week, so the shift
    rota has to exist first.

    `prior_weeks` ({monday_iso: {duty: [people]}}) are weeks before this
    build's window (the archived rosterHistory) - they're never changed,
    only remembered, so the no-repeat rule carries across "Start next
    week". `pinned_weeks` (same shape) are weeks inside the window that
    are already shared with staff (lockedDuties): taken exactly as given,
    and remembered the same way. `keep_weeks` (same shape) are shared
    weeks that something new touches (a sick day, a manual pick): they're
    re-planned, but keeping everyone on the duty they already had wherever
    that still works - including a repeat that was already shared, which
    the no-repeat rule otherwise forbids.

    Every other week is planned as a whole, all its duties at once (a
    minimum-cost matching rather than one duty at a time, which could
    paint itself into a corner and leave a duty blank that a different
    arrangement could have filled):
      - never someone who'd have left before the duty's done (finishes
        before DUTY_MIN_SLOT);
      - never someone who did that duty in the last REPEAT_GAP_WEEKS - 1
        weeks;
      - fill as many duties as possible, leaving BLANK_FIRST blank first;
      - prefer the ideal finish time (DUTY_ELIGIBLE_SLOTS);
      - then whoever's done that duty least / longest ago.
    """
    pool = duty_pool(inputs)
    prior_weeks = prior_weeks or {}
    pinned_weeks = pinned_weeks or {}
    keep_weeks = keep_weeks or {}
    times_done: Dict[str, Counter] = {}
    last_done: Dict[str, Dict[str, int]] = {}

    def remember(name: str, duty: str, wi: int) -> None:
        times_done.setdefault(name, Counter())[duty] += 1
        prev = last_done.setdefault(name, {}).get(duty)
        if prev is None or wi > prev:
            last_done[name][duty] = wi

    for monday_iso in sorted(prior_weeks):
        wi = _week_index(inputs, date.fromisoformat(monday_iso))
        if wi >= 0:
            continue
        for duty, people in prior_weeks[monday_iso].items():
            if duty in DUTY_SLOTS:
                for n in people:
                    remember(n, duty, wi)

    def weeks_since(name: str, duty: str, wi: int) -> Optional[int]:
        prev = last_done.get(name, {}).get(duty)
        return None if prev is None else wi - prev

    weeks_out: List[Dict] = []
    for wi in range(inputs.settings.weeks):
        monday = inputs.settings.roster_start + timedelta(weeks=wi)
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        assigned_by_duty: Dict[str, List[str]] = {}
        repeat_picks: List[Dict] = []

        pinned = pinned_weeks.get(monday.isoformat())
        if pinned:
            for duty in DUTY_SLOTS:
                if pinned.get(duty):
                    assigned_by_duty[duty] = list(pinned[duty])
            # A hand-picked repeat that's since been saved still carries
            # its warning.
            for ov in inputs.duty_overrides:
                if ov.week != monday or assigned_by_duty.get(ov.duty) != [ov.name]:
                    continue
                gap = weeks_since(ov.name, ov.duty, wi)
                if gap is not None and gap < REPEAT_GAP_WEEKS:
                    repeat_picks.append({"duty": ov.duty, "name": ov.name, "weeks_ago": gap})
        else:
            remaining = [n for n in pool if _present_most_of_week(inputs, n, days)]
            slot_of = {n: _weekly_slot(roster, wi, n) for n in remaining}

            # The manager's manual picks for this week come first, honoured
            # whenever the person's working that week and there long
            # enough to do it - even if it breaks the no-repeat rule (that
            # comes back as a repeat_picks warning, not a refusal). A pick
            # that's gone properly stale (they now finish before the duty
            # could be done) is dropped silently and the week's planned as
            # normal instead.
            for ov in inputs.duty_overrides:
                if ov.week != monday or ov.duty not in DUTY_SLOTS:
                    continue
                if ov.duty in assigned_by_duty or ov.name not in remaining:
                    continue
                ov_slot = slot_of.get(ov.name)
                if not ov_slot or SLOTS.index(ov_slot) < SLOTS.index(DUTY_MIN_SLOT[ov.duty]):
                    continue
                if ov.duty in STRICT_DUTIES and ov_slot not in DUTY_ELIGIBLE_SLOTS[ov.duty]:
                    continue
                gap = weeks_since(ov.name, ov.duty, wi)
                if gap is not None and gap < REPEAT_GAP_WEEKS:
                    repeat_picks.append({"duty": ov.duty, "name": ov.name, "weeks_ago": gap})
                remaining.remove(ov.name)
                assigned_by_duty[ov.duty] = [ov.name]

            # Everyone else: plan the whole week at once. Columns are the
            # people still free (in a week-rotating order, which with the
            # tie-break cost below spreads genuine ties around instead of
            # always resolving them the same way) plus one "leave blank"
            # column per duty, so there's always a valid answer.
            open_duties = [d for d in DUTY_SLOTS if d not in assigned_by_duty]
            offset = wi % len(pool) if pool else 0
            tie_order = pool[offset:] + pool[:offset]
            people = [n for n in tie_order if n in remaining and slot_of.get(n)]
            keep = keep_weeks.get(monday.isoformat()) or {}
            # More people than duties: this week's shared late duty gets a
            # second person (an extra row for the same duty).
            rows = [(d, False) for d in open_duties]
            shared_duty = SHARED_CANDIDATES[(monday.toordinal() // 7) % len(SHARED_CANDIDATES)]
            if len(people) > len(open_duties):
                rows.append((shared_duty, True))
            cost: List[List[int]] = []
            for r, (duty, is_extra) in enumerate(rows):
                row = []
                min_index = SLOTS.index(DUTY_MIN_SLOT[duty])
                kept_list = keep.get(duty) or []
                for k, n in enumerate(people):
                    gap = weeks_since(n, duty, wi)
                    kept = (len(kept_list) > 1 and kept_list[1] == n) if is_extra else (bool(kept_list) and kept_list[0] == n)
                    if (SLOTS.index(slot_of[n]) < min_index
                            or (duty in STRICT_DUTIES and slot_of[n] not in DUTY_ELIGIBLE_SLOTS[duty])
                            or (gap is not None and gap < REPEAT_GAP_WEEKS and not kept)):
                        row.append(_FORBID)
                        continue
                    c = 0 if slot_of[n] in DUTY_ELIGIBLE_SLOTS[duty] else _NOT_IDEAL
                    if keep and not kept:
                        c += _MOVED
                    c += times_done.get(n, Counter())[duty] * _PER_TIME_DONE
                    c += (_RECENCY_CAP - min(gap if gap is not None else _RECENCY_CAP, _RECENCY_CAP)) * _PER_WEEK_RECENT
                    c += k
                    row.append(c)
                for b in range(len(rows)):
                    if b != r:
                        row.append(_FORBID)
                        continue
                    if is_extra:
                        row.append(_SHARE_BLANK)
                        continue
                    c = _BLANK + (BLANK_FIRST.index(duty) if duty in BLANK_FIRST else _BLANK_IMPORTANT)
                    if keep.get(duty):
                        c += _MOVED
                    row.append(c)
                cost.append(row)
            for r, col in enumerate(_min_cost_assignment(cost)):
                if 0 <= col < len(people) and cost[r][col] < _FORBID:
                    duty_r, extra_r = rows[r]
                    if extra_r:
                        assigned_by_duty[duty_r] = assigned_by_duty.get(duty_r, []) + [people[col]]
                    else:
                        assigned_by_duty[duty_r] = [people[col]]

        for duty, names in assigned_by_duty.items():
            for n in names:
                remember(n, duty, wi)

        unfilled = [duty for duty in DUTY_SLOTS if duty not in assigned_by_duty]

        # Display order matches the paper roster: room-based rows first,
        # then the named rotating duties, then the two fixed ones at the
        # bottom.
        assignments: List[Dict] = [{"duty": duty, "people": []} for duty in CONTEXT_ROWS]
        assignments += [{"duty": duty, "people": assigned_by_duty.get(duty, [])} for duty in DUTY_SLOTS]
        for duty, names in FIXED_DUTIES:
            present = [n for n in names if _present_most_of_week(inputs, n, days)]
            assignments.append({"duty": duty, "people": present or names})
        weeks_out.append({
            "monday": monday, "assignments": assignments, "unfilled": unfilled,
            "repeat_picks": repeat_picks,
        })
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
    prior_weeks: Optional[Dict[str, Dict[str, List[str]]]] = None,
) -> List[Dict]:
    """Like build_duty_roster(), but any week none of whose days fall in
    touched_ranges is pinned to its locked_duties entry instead of
    freshly computed - so one new leave/override/duty pick only ever
    changes the duty rota for the week(s) its own dates cover, never
    reshuffles who's on which duty in a week already shared with staff.

    Pinned weeks are handed to build_duty_roster() as pinned_weeks rather
    than substituted in afterwards, so the weeks that ARE recomputed know
    exactly who did what in the shared ones (and in prior_weeks, the
    archive) and keep clear of repeating it. A touched week that has a
    lock is re-planned with that lock as keep_weeks, so only the duties
    the change actually affects move.

    Callers that want this build's results to become the NEW lock for
    the weeks that were open should call extract_locked_duties(result)
    for just those weeks' entries and merge that into their stored
    lockedDuties - never the whole thing, which would overwrite the lock
    with this build's output and silently stop protecting anything.
    """
    def week_is_touched(monday: date) -> bool:
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        return any(a <= d <= b for a, b in touched_ranges for d in days)

    pinned: Dict[str, Dict[str, List[str]]] = {}
    keep: Dict[str, Dict[str, List[str]]] = {}
    for wi in range(inputs.settings.weeks):
        monday = inputs.settings.roster_start + timedelta(weeks=wi)
        locked_week = locked_duties.get(monday.isoformat())
        if locked_week:
            legacy = LEGACY_DUTY in locked_week
            (keep if (legacy or week_is_touched(monday)) else pinned)[monday.isoformat()] = locked_week
    return build_duty_roster(inputs, roster, prior_weeks, pinned, keep)


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
