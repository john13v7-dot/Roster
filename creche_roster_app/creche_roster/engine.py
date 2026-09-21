"""The roster engine. Pure function: build_roster(inputs) -> Roster.

HARD RULES (always enforced or reported as a BREACH, never silently traded off)
  1. Opening cover: each floor has at least `min_open` staff on the early start.
  2. Closing cover: each floor has at least `min_close` staff on the late start.
  3. Pairing: the two "paired" staff are always complementary.
     One on early (07:30) => the other on late (09:00), and vice versa.
     If one of them is on leave, the pairing is suspended for those days and the
     other one's start time is set manually in the Overrides tab.
     (An override on a paired person is ignored on days when the partner works.)

SOFT RULES (cost weighted)
  - Fair rotation: people get the start times they have had least so far.
  - Recency: avoid repeating last week's start time.
  - Floor mix: spread starts evenly across the four slots on each floor.

How it works
  Weekly base:  fixed staff get their slot; the pair is decided together;
                each floor's rotating staff are solved exactly by dynamic
                programming over slot-count vectors (tiny state space).
  Daily pass:   leave and overrides are applied, then any floor that fell
                below its opening/closing minimum is repaired by moving the
                least disruptive rotating person. Anything still short is
                reported as a BREACH on the Checks tab.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import date, time, timedelta
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
from .parsing import fmt_day, fmt_days, is_off, parse_time

BIG = 1000.0  # penalty per missing person on a hard rule (dwarfs everything else)
W_FAIR = 10.0
W_RECENT = 3.0
W_MIX = 1.0


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


def _solve_floor(
    members: List[str],
    pre_counts: Counter,
    need_open: int,
    need_close: int,
    cost_fn,
) -> Dict[str, str]:
    """Exact minimum-cost slot assignment for one floor's rotating staff.

    State = how many people are on each slot so far (a 4-tuple). Cost is
    additive per person, hard/mix penalties depend only on the final counts,
    so keeping the cheapest path per count vector is exact.
    """
    start = tuple(pre_counts.get(sl, 0) for sl in SLOTS)
    states: Dict[Tuple[int, ...], Tuple[float, Tuple[str, ...]]] = {start: (0.0, ())}
    for name in members:
        nxt: Dict[Tuple[int, ...], Tuple[float, Tuple[str, ...]]] = {}
        for cnt in sorted(states):
            c, path = states[cnt]
            for i, sl in enumerate(SLOTS):
                c2 = c + cost_fn(name, sl)
                cnt2 = cnt[:i] + (cnt[i] + 1,) + cnt[i + 1:]
                cur = nxt.get(cnt2)
                if cur is None or c2 < cur[0] - 1e-12:
                    nxt[cnt2] = (c2, path + (sl,))
        states = nxt

    best_total: Optional[float] = None
    best_path: Tuple[str, ...] = ()
    for cnt in sorted(states):
        c, path = states[cnt]
        n = sum(cnt)
        pen = BIG * (max(0, need_open - cnt[0]) + max(0, need_close - cnt[3]))
        pen += W_MIX * sum((x - n / 4.0) ** 2 for x in cnt)
        total = c + pen
        if best_total is None or total < best_total - 1e-12:
            best_total, best_path = total, path
    return dict(zip(members, best_path))


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
    # Only one of them works this week: the pairing is suspended. Give the one
    # who works the slot they have had least; the manager can override it.
    who = a if present_a else b
    slot = "early" if share(who, "early") <= share(who, "late") else "late"
    return {who: slot}


def _covers_closing(hours_text: str, late_end) -> bool:
    """Whether a static person's own hours (e.g. '10:00 - 6:00') reach the
    late shift's end time. Hours are typed 12-hour with no AM/PM, so an end
    time at or before the start is read as afternoon/evening (a childcare
    day never runs past midnight)."""
    parts = [p.strip() for p in re.split(r"[-–—]", hours_text) if p.strip()]
    if len(parts) < 2:
        return False
    try:
        start = parse_time(parts[0])
        end = parse_time(parts[-1])
    except ValueError:
        return False
    if end <= start:
        end = time((end.hour + 12) % 24, end.minute)
    return end >= late_end


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

    hist: Dict[str, Counter] = {n: Counter(inputs.history.get(n, {})) for n in by_name}
    period: Dict[str, Counter] = {n: Counter() for n in by_name}
    last_slot: Dict[str, str] = {n: v for n, v in inputs.last_slot.items() if n in by_name}
    checks: List[Check] = []
    weeks: List[WeekRoster] = []

    def leave_kind(name: str, d: date) -> Optional[str]:
        for lv in inputs.leave:
            if lv.name == name and lv.covers(d):
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
        # Manual overrides that apply this week decide the base slot, so the
        # solver plans around them instead of having to repair afterwards.
        manual: Dict[str, str] = {}
        for n, st in by_name.items():
            if st.role == "static" or not present[n]:
                continue
            ovs = [o for o in (effective_override(n, d)[0] for d in present[n]) if o]
            if ovs:
                c = Counter(ovs)
                manual[n] = max(c, key=lambda sl: (c[sl], -SLOTS.index(sl)))

        base: Dict[str, str] = {}
        for n, st in by_name.items():
            if st.role == "fixed" and present[n]:
                base[n] = manual.get(n, st.fixed_slot or "early")
        if pair:
            a, b = pair
            base.update(_choose_pair(a, b, bool(present[a]), bool(present[b]), hist, last_slot))
            for n, partner in ((a, b), (b, a)):
                if n in manual and not present[partner]:
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
                if st.role == "rotating" and present[st.name] and st.name not in manual
            ]
            if members:
                base.update(
                    _solve_floor(members, pre, s.min_open[floor], s.min_close[floor], cost_fn)
                )

        # ---- daily pass --------------------------------------------------
        cells: Dict[Tuple[str, date], Assignment] = {}
        ignored_override: Dict[str, List[date]] = {}
        for d in days:
            slot_of: Dict[str, str] = {}
            overridden: set = set()
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
                else:
                    slot_of[st.name] = base[st.name]

            fb = s.fallback_closer
            fb_assignment = cells.get((fb, d)) if fb else None
            fb_available = (
                fb is not None
                and fb in by_name
                and fb_assignment is not None
                and fb_assignment.kind == "static"
                and _covers_closing(fb_assignment.text, s.shifts["late"].end)
            )

            for floor in s.floors:
                need = _needs(floor, s)
                if fb_available and pair and by_name[fb].floor == floor and need.get("late", 0) > 0:
                    covered = any(
                        slot_of.get(p) == "late" for p in pair if by_name.get(p) and by_name[p].floor == floor
                    )
                    if not covered:
                        need = dict(need)
                        need["late"] = max(0, need["late"] - 1)
                        checks.append(
                            Check(
                                "INFO",
                                "Closing fallback",
                                f"{fb} covers closing on {fmt_day(d)} because neither {pair[0]} nor {pair[1]} is closing.",
                                d,
                                wi,
                            )
                        )
                _repair_floor(d, floor, slot_of, overridden, by_name, s, cost_fn, checks, wi, need=need)
                _check_floor(d, floor, slot_of, by_name, s, checks, wi, need=need)

            for name, slot in slot_of.items():
                cells[(name, d)] = Assignment(
                    "shift", slot, s.shifts[slot].label, overridden=name in overridden
                )

        # ---- pairing report ---------------------------------------------
        if pair:
            _report_pairing(pair, days, cells, leave_kind, ignored_override, checks, wi)

        weeks.append(WeekRoster(monday, days, cells))

        # ---- update fairness memory ------------------------------------
        for n in by_name:
            slots = [cells[(n, d)].slot for d in days if cells[(n, d)].kind == "shift"]
            for sl in slots:
                hist[n][sl] += 1
                period[n][sl] += 1
            if slots:
                last_slot[n] = _most_common_slot(slots)

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


def _repair_floor(d, floor, slot_of, overridden, by_name, s, cost_fn, checks, wi, need=None) -> None:
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
        missing = [d for d in ds if not cells[(partner, d)].overridden]
        if missing:
            checks.append(
                Check(
                    "WARNING",
                    "Pairing suspended",
                    f"{absent} is away: {fmt_days(ds)}. {partner} has no manual start time for "
                    f"{fmt_days(missing)}, so the rotation slot is used. "
                    f"Add a row in Overrides to set it yourself.",
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
