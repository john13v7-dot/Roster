"""The roster engine. Pure function: build_roster(inputs) -> Roster.

HARD RULES (always enforced or reported as a BREACH, never silently traded off)
  1. Opening cover: each floor has at least `min_open` staff on the early start.
  2. Closing cover: each floor has at least `min_close` staff on the late start.
  3. Pairing: the two "paired" staff are always complementary.
     One on early (07:30) => the other on late (09:00), and vice versa.
     If one of them is on leave, the pairing is suspended for those days and the
     other one's start time is set manually in the Overrides tab.
     (An override on a paired person is ignored on days when the partner works.)

SOFT RULES
  - Fair rotation: opening and closing (the two shifts meant to be shared
    equally) go least-done-first, so nobody's opening/closing count can
    drift more than one shift apart from anyone else's over a run. 8:00
    and 8:30 are filled the same way from whoever's left, kept fair but
    looser, since they don't need to match each other exactly.
  - Recency: avoid repeating last week's start time.

How it works
  Weekly base:  fixed staff get their slot; the pair is decided together;
                each floor's rotating staff get opening/closing seats
                least-done-first, then 8:00/8:30 the same way from
                whoever's left.
  Daily pass:   leave and overrides are applied, then any floor that fell
                below its opening/closing minimum is repaired by moving the
                least disruptive rotating person. Anything still short is
                reported as a BREACH on the Checks tab.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from .models import (
    NDAYS,
    t12,
    ROLES,
    SLOT_LABELS,
    SLOTS,
    Assignment,
    Check,
    InputError,
    Inputs,
    Roster,
    Staff,
    WeekRoster,
)
from .parsing import fmt_day, fmt_days, is_off

W_FAIR = 10.0
W_RECENT = 3.0


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------
def validate(inputs: Inputs) -> List[str]:
    p: List[str] = []
    s = inputs.settings

    if s.roster_start.weekday() != 0:
        p.append(
            f"Settings: roster_start {s.roster_start:%d/%m/%Y} is a "
            f"{s.roster_start:%A}. It must be a Monday."
        )
    if not 1 <= s.weeks <= 12:
        p.append("Settings: weeks must be between 1 and 12.")
    if not s.floors:
        p.append("Settings: floors is empty.")
    if not s.title:
        p.append("Settings: title is empty.")

    shifts_ok = all(sl in s.shifts for sl in SLOTS)
    if not shifts_ok:
        p.append("Settings: every slot (early, mid1, mid2, late) needs a start and end time.")
    else:
        for sl in SLOTS:
            if s.shifts[sl].start >= s.shifts[sl].end:
                p.append(f"Settings: {sl} start must be before its end.")
        starts = [s.shifts[sl].start for sl in SLOTS]
        if any(a >= b for a, b in zip(starts, starts[1:])):
            p.append("Settings: start times must increase: early < mid1 < mid2 < late.")

    for f in s.floors:
        for label, table in (("min_open", s.min_open), ("min_close", s.min_close)):
            v = table.get(f)
            if v is None or v < 0:
                p.append(f"Settings: {label}_{f.lower().replace(' ', '_')} must be a number, 0 or more.")

    names = set()
    paired = []
    for st in inputs.staff:
        if st.role not in ROLES:
            p.append(f"Staff: '{st.name}' has role '{st.role}'. Use one of: {', '.join(ROLES)}.")
            continue
        if st.floor not in s.floors:
            p.append(f"Staff: '{st.name or st.role}' is on floor '{st.floor}', which is not in Settings floors ({', '.join(s.floors)}).")
        if st.role in ("vacant", "blank"):
            continue
        if not st.name:
            p.append("Staff: a row has no name.")
            continue
        if st.name.lower() in names:
            p.append(f"Staff: '{st.name}' appears more than once.")
        names.add(st.name.lower())
        if st.role == "paired":
            paired.append(st.name)
        if st.role == "fixed" and st.fixed_slot not in SLOTS:
            p.append(f"Staff: '{st.name}' is fixed but has no valid slot (use early, mid1, mid2, late or a start time).")
        if st.start_date and st.end_date and st.end_date < st.start_date:
            p.append(f"Staff: '{st.name}' has an End date before their Start date.")
    if len(paired) not in (0, 2):
        p.append(f"Staff: exactly two people must have role 'paired' (or none). Found {len(paired)}.")

    if s.fallback_closer:
        if s.fallback_closer.lower() not in names:
            p.append(f"Settings: fallback_closer '{s.fallback_closer}' is not in the Staff tab.")
        elif s.fallback_closer in paired:
            p.append(f"Settings: fallback_closer '{s.fallback_closer}' can't be one of the two paired staff.")

    exact = {st.name: st for st in inputs.staff if st.role not in ("vacant", "blank") and st.name}
    for lv in inputs.leave:
        if lv.name not in exact:
            p.append(f"Leave: '{lv.name}' is not in the Staff tab.")
        if lv.end is not None and lv.end < lv.start:
            p.append(f"Leave: {lv.name} ends before it starts.")
    for ov in inputs.overrides:
        if ov.name not in exact:
            p.append(f"Overrides: '{ov.name}' is not in the Staff tab.")
        elif exact[ov.name].role == "static":
            if not ov.text:
                p.append(f"Overrides: {ov.name} has own hours, so type the hours (e.g. 10:00 - 2:00) or OFF.")
        elif ov.slot not in SLOTS:
            p.append(f"Overrides: {ov.name} has an unknown start time.")
        if ov.end is not None and ov.end < ov.start:
            p.append(f"Overrides: {ov.name} ends before it starts.")
    return p


# --------------------------------------------------------------------------
# Fairness cost and the per-floor exact solver
# --------------------------------------------------------------------------
def _cost(hist: Dict[str, Counter], last_slot: Dict[str, str], name: str, slot: str) -> float:
    h = hist[name]
    total = sum(h.values())
    c = W_FAIR * h[slot] / (total + 1)
    if last_slot.get(name) == slot:
        c += W_RECENT
    return c


def _assign_weekly_base(
    members: List[str],
    pre_counts: Counter,
    need_open: int,
    need_close: int,
    hist: Dict[str, Counter],
    last_slot: Dict[str, str],
    week_index: int,
    room_of: Optional[Dict[str, str]] = None,
    taken_by_room: Optional[Dict[str, set]] = None,
) -> Dict[str, str]:
    """Each rotating member's weekly base slot for one floor.

    Same-room staff can't share a slot (hard rule): `room_of` maps each
    candidate to their room, and `taken_by_room` starts with whichever
    slots that room already has claimed this week (fixed staff, the
    paired pair, manual overrides) and is extended in place as this
    function assigns people, so it also catches two members of the same
    room being assigned here. A candidate that would create a clash is
    only ever picked when every remaining candidate for that slot would -
    genuinely unavoidable that week - so it can be reported, not silently
    allowed.

    Opening and closing are the two shifts meant to be shared equally, so
    they're filled first, together, from a single least-done-first queue
    ranked by each person's combined opening+closing count so far -
    whoever is furthest behind on either gets the next open seat *or* the
    next close seat, whichever comes up, whichever they're most owed. With
    9 people and only 2 open + 2 close seats a week, nobody can get both
    every week, but treating them as one shared pool (rather than two
    separate ones) means a week someone misses opening puts them straight
    in line for closing, instead of two independent shortfalls being able
    to land on the same unlucky person, or on different people who then
    both end up behind rather than compensating each other.

    8:00/8:30 are filled from whoever's left the same way (least-done
    first, the two counted together since they don't need to match each
    other exactly) - fair, but looser than opening/closing on purpose.

    Genuine ties (everyone owed the same amount so far - the norm in the
    first week or two of a fresh team) are broken by list position, but
    rotated by the week index rather than fixed: a static tie-break would
    let the same person lose every tie, every week, for as long as the
    ties keep recurring - precisely how one person can end up with zero
    opens or closes over an otherwise well-balanced run.
    """
    remaining = list(members)
    result: Dict[str, str] = {}
    room_of = room_of or {}
    taken_by_room: Dict[str, set] = taken_by_room if taken_by_room is not None else {}

    def priority(n: str) -> int:
        return (members.index(n) - week_index) % len(members)

    def clashes(n: str, slot: str) -> bool:
        room = room_of.get(n)
        return bool(room) and slot in taken_by_room.get(room, ())

    def claim(n: str, slot: str) -> None:
        result[n] = slot
        room = room_of.get(n)
        if room:
            taken_by_room.setdefault(room, set()).add(slot)

    def take(slot: str, k: int) -> None:
        for _ in range(min(k, len(remaining))):
            # A room-mate already on this slot this week is only ever
            # accepted when there's no clash-free candidate left - a real
            # shortfall, not a preference to override.
            safe = [n for n in remaining if not clashes(n, slot)]
            pool = safe or remaining
            n = min(
                pool,
                key=lambda n: (
                    hist[n]["early"] + hist[n]["late"],
                    hist[n][slot],
                    sum(hist[n].values()),
                    1 if last_slot.get(n) == slot else 0,
                    priority(n),
                ),
            )
            remaining.remove(n)
            claim(n, slot)

    early_k = max(0, need_open - pre_counts.get("early", 0))
    late_k = max(0, need_close - pre_counts.get("late", 0))
    # Reserve enough of the pool for closing before greedily filling
    # opening, so an unreasonable opening requirement (or a genuinely
    # infeasible one) can't starve closing out entirely - it should still
    # report as its own shortfall, not cascade into a second one.
    early_k = min(early_k, max(0, len(remaining) - late_k))
    take("early", early_k)
    take("late", late_k)

    order = sorted(
        remaining,
        key=lambda n: (hist[n]["mid1"] + hist[n]["mid2"], sum(hist[n].values()), priority(n)),
    )
    mid_counts = {"mid1": 0, "mid2": 0}
    for n in order:
        # Each person's own 8:00 vs 8:30 balance decides first (so nobody
        # individually stacks up on one of the two), and this week's fill
        # level is only the tie-break - not the other way round, which let
        # an odd leftover (2-3 split, most weeks) stack the same slot for
        # whoever's left over across several weeks running. A room-mate
        # already on one of the two only rules it out when the other is
        # actually free to take instead.
        options = [sl for sl in ("mid1", "mid2") if not clashes(n, sl)] or ["mid1", "mid2"]
        target = min(
            options,
            key=lambda sl: (hist[n][sl], mid_counts[sl], 1 if last_slot.get(n) == sl else 0),
        )
        claim(n, target)
        mid_counts[target] += 1

    _resolve_room_clashes(result, room_of, hist)
    return result


def _room_clash_free(assignment: Dict[str, str], room_of: Dict[str, str]) -> bool:
    seen: Dict[Tuple[str, str], str] = {}
    for n, slot in assignment.items():
        room = room_of.get(n)
        if not room:
            continue
        key = (room, slot)
        if key in seen:
            return False
        seen[key] = n
    return True


def _resolve_room_clashes(result: Dict[str, str], room_of: Dict[str, str], hist: Dict[str, Counter]) -> None:
    """Swap-based cleanup for whatever the least-done-first pass above
    couldn't avoid on its own - mainly a 3-person room whose members all
    land in the two flexible 8:00/8:30 slots the same week (only 2 slots
    for 3 people, so a clash there is arithmetically forced, not a bad
    pick). Trade one of the clashing pair with someone from a different
    room, in whichever direction - and with whichever swap partner -
    actually clears it at the lowest fairness cost. A clash that can't be
    resolved this way (every candidate swap partner would just create a
    different clash) is left for the daily check to report, same as any
    other hard-rule shortfall that's genuinely unavoidable that week."""
    for _ in range(20):
        clash = None
        seen: Dict[Tuple[str, str], str] = {}
        for n, slot in result.items():
            room = room_of.get(n)
            if not room:
                continue
            key = (room, slot)
            if key in seen:
                clash = (n, seen[key])
                break
            seen[key] = n
        if not clash:
            return

        best: Optional[Tuple[float, str, str, str, str]] = None
        for mover in clash:
            cur = result[mover]
            for other, oslot in result.items():
                if other == mover or oslot == cur or room_of.get(other) == room_of.get(mover):
                    continue
                trial = dict(result)
                trial[mover], trial[other] = oslot, cur
                if not _room_clash_free(trial, room_of):
                    continue
                cost = hist[mover][oslot] + hist[other][cur]
                if best is None or cost < best[0]:
                    best = (cost, mover, other, oslot, cur)
        if best is None:
            return  # genuinely unavoidable this week
        _, mover, other, oslot, cur = best
        result[mover], result[other] = oslot, cur


def _choose_pair(
    a: str, b: str, present_a: bool, present_b: bool, hist, last_slot
) -> Dict[str, str]:
    """Decide the pair's base slots for the week. Always complementary."""

    def share(name: str, slot: str) -> float:
        return hist[name][slot] / (sum(hist[name].values()) + 1)

    if not present_a and not present_b:
        return {}
    if present_a and present_b:
        ea, eb = share(a, "early"), share(b, "early")
        if abs(ea - eb) > 1e-9:
            a_early = ea < eb
        else:
            la, lb = last_slot.get(a), last_slot.get(b)
            if la == "late" and lb != "late":
                a_early = True
            elif lb == "late" and la != "late":
                a_early = False
            elif la == "early" and lb != "early":
                a_early = False
            elif lb == "early" and la != "early":
                a_early = True
            else:
                a_early = True
        return {a: "early", b: "late"} if a_early else {a: "late", b: "early"}
    # Only one of them works this week: the pairing is suspended. Whoever's in
    # always opens (7:30) automatically - not a fairness pick, and not
    # something that needs a manual override to hold. A manual override still
    # wins if one is set for a specific day (effective_override handles that
    # in the daily pass, same as any other rotating person's override).
    who = a if present_a else b
    return {who: "early"}


def _most_common_slot(slots: List[str]) -> str:
    c = Counter(slots)
    return max(c, key=lambda sl: (c[sl], SLOTS.index(sl)))


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------
def build_roster(inputs: Inputs) -> Roster:
    problems = validate(inputs)
    if problems:
        raise InputError(problems)

    s = inputs.settings
    staff_keys: List[Tuple[str, Staff]] = []
    for i, st in enumerate(inputs.staff):
        key = st.name if st.role not in ("vacant", "blank") else f"{st.role}#{i}"
        staff_keys.append((key, st))
    working = [(k, st) for k, st in staff_keys if st.role in ("rotating", "fixed", "paired", "static")]
    by_name: Dict[str, Staff] = {st.name: st for _, st in working}
    pair = [st.name for _, st in working if st.role == "paired"]

    room_of: Dict[str, str] = {n: st.room for n, st in by_name.items() if st.room}

    hist: Dict[str, Counter] = {n: Counter(inputs.history.get(n, {})) for n in by_name}
    period: Dict[str, Counter] = {n: Counter() for n in by_name}
    last_slot: Dict[str, str] = {n: v for n, v in inputs.last_slot.items() if n in by_name}
    checks: List[Check] = []
    weeks: List[WeekRoster] = []

    def leave_kind(name: str, d: date) -> Optional[str]:
        st = by_name.get(name)
        if st is not None:
            if st.start_date and d < st.start_date:
                return "Not yet started"
            if st.end_date and d > st.end_date:
                return "Left"
        for lv in inputs.leave:
            if lv.name == name and lv.covers(d):
                return lv.kind
        return None

    def credited_kind(name: str, d: date) -> Optional[str]:
        """Like leave_kind, but a leave request with a known end date
        doesn't count - only employment boundaries and open-ended leave do.
        Used only to work out who else's slot moved *because of* someone's
        temporary leave, for the "changed to cover" highlight - never for
        what's actually scheduled. Open-ended leave (no return date) is the
        team's new normal for this build, not a one-off to compare against,
        so it stays a real absence here too, same as leave_kind."""
        st = by_name.get(name)
        if st is not None:
            if st.start_date and d < st.start_date:
                return "Not yet started"
            if st.end_date and d > st.end_date:
                return "Left"
        for lv in inputs.leave:
            if lv.name == name and lv.covers(d) and lv.end is None:
                return lv.kind
        return None

    def override_slot(name: str, d: date) -> Optional[str]:
        found = None
        for ov in inputs.overrides:  # the last matching row wins
            if ov.name == name and ov.covers(d) and ov.slot:
                found = ov.slot
        return found

    def override_text(name: str, d: date) -> Optional[str]:
        found = None
        for ov in inputs.overrides:
            if ov.name == name and ov.covers(d) and ov.text:
                found = ov.text
        return found

    def bounded_override(name: str, d: date) -> bool:
        """True if the override in effect for this person on this day has a
        known end date - a temporary, one-off adjustment, as opposed to an
        open-ended standing pin (e.g. the paired person's permanent early
        slot). Only the former counts as a "changed today" highlight; a
        standing pin is just how that person's week normally looks, so
        flagging it every day would be noise, not signal."""
        found = None
        for ov in inputs.overrides:
            if ov.name == name and ov.covers(d) and (ov.slot or ov.text):
                found = ov
        return found is not None and found.end is not None

    def effective_override(name: str, d: date) -> Tuple[Optional[str], bool]:
        """(slot, ignored). An override on a paired person only applies on days
        when their partner is away; otherwise the pairing rule wins."""
        ov = override_slot(name, d)
        if ov and by_name[name].role == "paired":
            partner = pair[1] if name == pair[0] else pair[0]
            if not leave_kind(partner, d):
                return None, True
        return ov, False

    def cost_fn(name: str, slot: str) -> float:
        return _cost(hist, last_slot, name, slot)

    for wi in range(s.weeks):
        monday = s.roster_start + timedelta(weeks=wi)
        days = [monday + timedelta(days=i) for i in range(NDAYS)]
        present = {n: [d for d in days if not leave_kind(n, d)] for n in by_name}

        # ---- weekly base -------------------------------------------------
        def compute_base(present_map: Dict[str, List[date]]) -> Dict[str, str]:
            # An override that covers every day someone's in this week
            # decides their base slot for the whole week, same as before -
            # that's what an open-ended override (e.g. a permanent pinned
            # shift) means. A shorter one - a single day, or any run that
            # doesn't reach every present day - only ever applies to the
            # specific day(s) it names, via effective_override() in the
            # daily pass below; it's deliberately NOT let anywhere near the
            # weekly base here, or it would silently drag every other day
            # that week along with it too, which is not what a one-day
            # manual adjustment means.
            manual: Dict[str, str] = {}
            for n, st in by_name.items():
                if st.role == "static" or not present_map[n]:
                    continue
                ovs = [o for o in (effective_override(n, d)[0] for d in present_map[n]) if o]
                if ovs and len(ovs) == len(present_map[n]):
                    c = Counter(ovs)
                    manual[n] = max(c, key=lambda sl: (c[sl], -SLOTS.index(sl)))

            base: Dict[str, str] = {}
            for n, st in by_name.items():
                if st.role == "fixed" and present_map[n]:
                    base[n] = manual.get(n, st.fixed_slot or "early")
            if pair:
                a, b = pair
                base.update(_choose_pair(a, b, bool(present_map[a]), bool(present_map[b]), hist, last_slot))
                for n, partner in ((a, b), (b, a)):
                    if n in manual and not present_map[partner]:
                        base[n] = manual[n]  # pairing is suspended all week: follow the override
            for floor in s.floors:
                floor_people = [st for st in by_name.values() if st.floor == floor]
                for st in floor_people:
                    if st.role == "rotating" and st.name in manual:
                        base[st.name] = manual[st.name]
                pre = Counter(base[st.name] for st in floor_people if st.name in base)
                members = [
                    st.name
                    for st in floor_people
                    if st.role == "rotating" and present_map[st.name] and st.name not in manual
                ]
                # If the pair isn't covering closing this week (both away, or
                # the one present is pinned elsewhere) and a fallback closer
                # is set for this floor, plan the base around them taking the
                # pair's spot - not stacking a full rotating close count on
                # top of them. Any day the fallback doesn't actually apply
                # (e.g. a shorter day) is still caught and topped back up by
                # the daily repair pass.
                min_close = s.min_close[floor]
                if (
                    s.fallback_closer
                    and pair
                    and by_name.get(s.fallback_closer)
                    and by_name[s.fallback_closer].floor == floor
                    and not any(base.get(p) == "late" for p in pair if by_name.get(p) and by_name[p].floor == floor)
                ):
                    min_close = max(0, min_close - 1)
                if members:
                    # Same-room staff can't share a slot: seed with whichever
                    # slots this room already has claimed by people decided
                    # before the rotating pool (fixed staff, the pair,
                    # manual overrides), so e.g. Jason's own slot rules it
                    # out for his ECEC 2 room-mates even though he isn't in
                    # `members`.
                    taken_by_room: Dict[str, set] = {}
                    for n, slot in base.items():
                        r = room_of.get(n)
                        if r:
                            taken_by_room.setdefault(r, set()).add(slot)
                    base.update(
                        _assign_weekly_base(
                            members, pre, s.min_open[floor], min_close, hist, last_slot, wi,
                            room_of, taken_by_room,
                        )
                    )
            return base

        base = compute_base(present)
        # A second, counterfactual pass - "as if" nobody's temporary leave
        # had happened this week - used only to work out whose weekly slot
        # moved *because of* it, for the "changed to cover" highlight below.
        # It never feeds the real schedule or fairness memory.
        present_credit = {n: [d for d in days if not credited_kind(n, d)] for n in by_name}
        base_if_nobody_away = compute_base(present_credit)
        covering_because_of_leave = {
            n for n in base
            if by_name[n].role == "rotating"
            and n in base_if_nobody_away
            and base[n] != base_if_nobody_away[n]
        }

        # ---- daily pass --------------------------------------------------
        cells: Dict[Tuple[str, date], Assignment] = {}
        ignored_override: Dict[str, List[date]] = {}
        for d in days:
            slot_of: Dict[str, str] = {}
            overridden: set = set()
            bounded_overridden: set = set()  # subset of overridden with a known end date
            adjusted: set = set()  # names moved today to cover someone else's absence
            for key, st in staff_keys:
                if st.role == "blank":
                    cells[(key, d)] = Assignment("blank")
                    continue
                if st.role == "vacant":
                    cells[(key, d)] = Assignment("vacant", text=st.hours[d.weekday()] or st.note)
                    continue
                lk = leave_kind(st.name, d)
                if lk:
                    cells[(key, d)] = Assignment("leave", text=lk)
                    continue
                if st.role == "static":
                    text = override_text(st.name, d) or st.hours[d.weekday()] or st.note
                    if is_off(text):
                        cells[(key, d)] = Assignment("leave", text="OFF")
                    else:
                        cells[(key, d)] = Assignment("static", text=text)
                    continue
                ov, ignored = effective_override(st.name, d)
                if ignored:
                    ignored_override.setdefault(st.name, []).append(d)
                if ov:
                    slot_of[st.name] = ov
                    overridden.add(st.name)
                    if bounded_override(st.name, d):
                        bounded_overridden.add(st.name)
                else:
                    slot_of[st.name] = base[st.name]

            fb = s.fallback_closer
            fb_assignment = cells.get((fb, d)) if fb else None
            # The fallback closer covers whenever they're actually working that
            # day (not on leave/OFF) - their own typed hours don't gate it, since
            # covering closing IS them working later than usual that day, not a
            # condition they either happen to meet or don't. Their displayed
            # hours are extended below to say so, rather than leave the roster
            # showing their normal (shorter) hours while they're relied on to
            # close.
            fb_available = (
                fb is not None
                and fb in by_name
                and fb_assignment is not None
                and fb_assignment.kind == "static"
            )

            for floor in s.floors:
                need = _needs(floor, s)
                fallback_covering = False
                if fb_available and pair and by_name[fb].floor == floor and need.get("late", 0) > 0:
                    covered = any(
                        slot_of.get(p) == "late" for p in pair if by_name.get(p) and by_name[p].floor == floor
                    )
                    if not covered:
                        need = dict(need)
                        need["late"] = max(0, need["late"] - 1)
                        fallback_covering = True
                        checks.append(
                            Check(
                                "INFO",
                                "Closing fallback",
                                f"{fb} covers closing on {fmt_day(d)} because neither {pair[0]} nor {pair[1]} is closing.",
                                d,
                                wi,
                            )
                        )
                        # Their displayed hours stay exactly as typed - covering
                        # closing doesn't rewrite the roster sheet on their
                        # behalf. If the manager wants their hours to actually
                        # show as later that day, that's a manual override she
                        # types in herself, same as any other change.
                _repair_floor(d, floor, slot_of, overridden, by_name, s, cost_fn, checks, wi, need=need, room_of=room_of, adjusted=adjusted)
                if fallback_covering:
                    _cap_late_for_fallback(d, floor, slot_of, overridden, by_name, s, need, cost_fn, checks, wi, fb, room_of=room_of, adjusted=adjusted)
                _check_floor(d, floor, slot_of, by_name, s, checks, wi, need=need)

            _check_rooms(d, slot_of, room_of, s.shifts, checks, wi)

            for name, slot in slot_of.items():
                cells[(name, d)] = Assignment(
                    "shift", slot, s.shifts[slot].label,
                    overridden=name in overridden,
                    # Highlighted whenever this cell isn't what the normal
                    # rotation would have given them: a same-day repair
                    # swap or weekly reshuffle to cover someone else's
                    # leave (adjusted / covering_because_of_leave), or a
                    # manager's own temporary manual pick for this day
                    # (bounded_overridden) - the person directly moved
                    # should read as changed just as much as whoever moved
                    # to cover them. An open-ended standing pin (no end
                    # date) doesn't count - that's just how that person's
                    # week normally looks, not a recent change.
                    adjusted=name in adjusted or name in covering_because_of_leave or name in bounded_overridden,
                )

        # ---- pairing report ---------------------------------------------
        if pair:
            _report_pairing(pair, days, cells, leave_kind, ignored_override, checks, wi)

        weeks.append(WeekRoster(monday, days, cells))

        # ---- update fairness memory ------------------------------------
        for n in by_name:
            slots = [cells[(n, d)].slot for d in days if cells[(n, d)].kind == "shift"]
            for sl in slots:
                period[n][sl] += 1
            if slots:
                last_slot[n] = _most_common_slot(slots)
            # hist (which decides *future* weeks' base-slot ordering) is
            # credited for the week's whole base slot, not just the days
            # actually worked - so a leave that doesn't empty the whole
            # week (the person still has a base slot that week) changes
            # only that person's own cells and whichever day(s) genuinely
            # need someone else to cover, via the daily repair pass above -
            # not everyone else's rotation in the weeks that follow, just
            # because the absent person's own count came out lower than a
            # full week would have given them. (A leave that empties the
            # whole week has no base slot to credit here, and needs the
            # rest of the team's real slots that week to genuinely change
            # to cover it - that part of the rebalancing is real and does
            # carry forward, same as it always has.) period (the Fairness
            # screen) stays truthful to days actually worked either way.
            if n in base:
                hist[n][base[n]] += NDAYS
                last_slot[n] = base[n]
            else:
                for sl in slots:
                    hist[n][sl] += 1

    return Roster(
        inputs=inputs,
        staff_keys=staff_keys,
        weeks=weeks,
        checks=checks,
        period_counts={n: dict(c) for n, c in period.items()},
        cumulative_counts={n: dict(c) for n, c in hist.items()},
        last_slot=dict(last_slot),
    )


# --------------------------------------------------------------------------
# Daily repair and checks
# --------------------------------------------------------------------------
def _needs(floor: str, s) -> Dict[str, int]:
    return {"early": s.min_open[floor], "late": s.min_close[floor]}


def _would_clash(n, target_slot, slot_of, room_of) -> bool:
    room = room_of.get(n) if room_of else None
    if not room:
        return False
    return any(
        other != n and room_of.get(other) == room and slot_of.get(other) == target_slot
        for other in slot_of
    )


def _repair_floor(d, floor, slot_of, overridden, by_name, s, cost_fn, checks, wi, need=None, room_of=None, adjusted=None) -> None:
    need = _needs(floor, s) if need is None else need
    floor_names = [n for n in slot_of if by_name[n].floor == floor]
    for target in ("early", "late"):
        while Counter(slot_of[n] for n in floor_names)[target] < need[target]:
            cnt = Counter(slot_of[n] for n in floor_names)
            donors = []
            for n in floor_names:
                if by_name[n].role != "rotating" or n in overridden:
                    continue
                cur = slot_of[n]
                if cur == target:
                    continue
                if cur in need and cnt[cur] <= need[cur]:
                    continue  # moving them would break the other minimum
                donors.append(n)
            if not donors:
                break
            # A donor who'd clash with a room-mate already on `target` is
            # only picked when every donor would - same "avoid unless
            # genuinely unavoidable" rule as the weekly base.
            safe_donors = [n for n in donors if not _would_clash(n, target, slot_of, room_of)]
            donors = safe_donors or donors
            donors.sort(
                key=lambda n: (
                    0 if slot_of[n] in ("mid1", "mid2") else 1,
                    cost_fn(n, target),
                    floor_names.index(n),
                )
            )
            n = donors[0]
            old = slot_of[n]
            slot_of[n] = target
            if adjusted is not None:
                adjusted.add(n)
            what = "opening" if target == "early" else "closing"
            checks.append(
                Check(
                    "INFO",
                    "Cover adjusted",
                    f"{n} moved from {t12(s.shifts[old].start)} to {t12(s.shifts[target].start)} "
                    f"on {fmt_day(d)} to keep {floor} {what} cover.",
                    d,
                    wi,
                )
            )


def _cap_late_for_fallback(d, floor, slot_of, overridden, by_name, s, need, cost_fn, checks, wi, fb, room_of=None, adjusted=None) -> None:
    """When the fallback closer is covering (need['late'] was already reduced
    by one for them), keep the actual late headcount at that reduced number
    instead of leaving extra rotating staff on it anyway - otherwise the
    roster shows more people at closing than the rule calls for."""
    target = need.get("late")
    if target is None:
        return
    floor_names = [n for n in slot_of if by_name[n].floor == floor]
    other_slots = [sl for sl in SLOTS if sl != "late"]
    while Counter(slot_of[n] for n in floor_names)["late"] > target:
        candidates = [
            n for n in floor_names
            if slot_of[n] == "late" and by_name[n].role == "rotating" and n not in overridden
        ]
        if not candidates:
            break
        slot_counts = Counter(slot_of[n] for n in floor_names)
        # Every (person, slot-to-move-to) pairing that doesn't clash with a
        # room-mate, ranked by keeping the other slots balanced first and
        # cost second - same "unless genuinely unavoidable" fallback as
        # everywhere else this rule applies.
        options = [
            (n, sl) for n in candidates for sl in other_slots
            if not _would_clash(n, sl, slot_of, room_of)
        ]
        options = options or [(n, sl) for n in candidates for sl in other_slots]
        n, move_to = min(options, key=lambda ns: (slot_counts.get(ns[1], 0), cost_fn(ns[0], ns[1])))
        old = slot_of[n]
        slot_of[n] = move_to
        if adjusted is not None:
            adjusted.add(n)
        checks.append(
            Check(
                "INFO",
                "Cover adjusted",
                f"{n} moved from {t12(s.shifts[old].start)} to {t12(s.shifts[move_to].start)} "
                f"on {fmt_day(d)} so closing stays at {target + 1} with {fb} covering, not more.",
                d,
                wi,
            )
        )


def _check_floor(d, floor, slot_of, by_name, s, checks, wi, need=None) -> None:
    need = _needs(floor, s) if need is None else need
    cnt = Counter(slot_of[n] for n in slot_of if by_name[n].floor == floor)
    for slot, rule, what in (("early", "Opening cover", "opening"), ("late", "Closing cover", "closing")):
        if need[slot] > 0 and cnt[slot] < need[slot]:
            checks.append(
                Check(
                    "BREACH",
                    rule,
                    f"{floor} {what}: {cnt[slot]} on the {t12(s.shifts[slot].start)} start, "
                    f"minimum is {need[slot]} ({fmt_day(d)}).",
                    d,
                    wi,
                )
            )


def _check_rooms(d, slot_of, room_of, shifts, checks, wi) -> None:
    """Hard rule: two people in the same room can't be on the same slot.
    The weekly base and daily repair both actively avoid this already;
    this is the final check that catches whatever they couldn't (an
    override, a leave-driven change) so it's reported, not silently let
    through."""
    by_room: Dict[str, Dict[str, List[str]]] = {}
    for name, slot in slot_of.items():
        room = room_of.get(name)
        if not room:
            continue
        by_room.setdefault(room, {}).setdefault(slot, []).append(name)
    for room, by_slot in by_room.items():
        for slot, names in by_slot.items():
            if len(names) > 1:
                checks.append(
                    Check(
                        "BREACH",
                        "Room clash",
                        f"{room}: {', '.join(sorted(names))} are all on the {t12(shifts[slot].start)} "
                        f"start on {fmt_day(d)} - same-room staff can't share a shift.",
                        d,
                        wi,
                    )
                )


def _report_pairing(pair, days, cells, leave_kind, ignored_override, checks, wi) -> None:
    a, b = pair
    suspended: Dict[str, List[date]] = {}
    both_away: List[date] = []
    for d in days:
        la, lb = leave_kind(a, d), leave_kind(b, d)
        if not la and not lb:
            sa, sb = cells[(a, d)].slot, cells[(b, d)].slot
            if {sa, sb} != {"early", "late"}:
                checks.append(
                    Check(
                        "BREACH",
                        "Pairing rule",
                        f"{a} and {b} are not complementary on {fmt_day(d)}.",
                        d,
                        wi,
                    )
                )
        elif la and not lb:
            suspended.setdefault(a, []).append(d)
        elif lb and not la:
            suspended.setdefault(b, []).append(d)
        else:
            both_away.append(d)

    if both_away:
        checks.append(
            Check(
                "WARNING",
                "Pairing policy",
                f"{a} and {b} are both away on {fmt_days(both_away)} — policy says they should "
                f"never be away at the same time. Double-check that leave.",
                None,
                wi,
            )
        )

    for absent, ds in suspended.items():
        partner = b if absent == a else a
        overridden_days = [d for d in ds if cells[(partner, d)].overridden]
        if not overridden_days:
            checks.append(
                Check(
                    "INFO",
                    "Pairing suspended",
                    f"{absent} is away: {fmt_days(ds)}. {partner} opens (7:30) automatically.",
                    None,
                    wi,
                )
            )
        elif len(overridden_days) < len(ds):
            checks.append(
                Check(
                    "INFO",
                    "Pairing suspended",
                    f"{absent} is away: {fmt_days(ds)}. {partner} opens (7:30) automatically, "
                    f"except {fmt_days(overridden_days)} where a manual start time is set in Overrides.",
                    None,
                    wi,
                )
            )
        else:
            checks.append(
                Check(
                    "INFO",
                    "Pairing suspended",
                    f"{absent} is away: {fmt_days(ds)}. {partner}'s start time is set manually in Overrides.",
                    None,
                    wi,
                )
            )
    for name, ds in ignored_override.items():
        partner = b if name == a else a
        checks.append(
            Check(
                "INFO",
                "Override ignored",
                f"Override for {name} ignored on {fmt_days(ds)} because {partner} is working: "
                f"the pairing rule applies. You can delete or end that Overrides row.",
                None,
                wi,
            )
        )
