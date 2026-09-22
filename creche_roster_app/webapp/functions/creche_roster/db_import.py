"""Build Inputs from a JSON export of the mobile preview's live database
(the staff / leave / transfers collections the Add Staff, Transfer, Add
Holiday and Add Maternity Leave buttons write to), so a change made
through the app is picked up automatically the next time the roster is
rebuilt - no hand-patching a script required.

Settings, fairness history and last-slot aren't editable through the app
yet, so they still come from wherever the caller's baseline Inputs came
from (sample_inputs today); only staff/leave/transfers are replaced.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .models import SLOTS, Inputs, Leave, Override, Settings, Staff
from .parsing import parse_date


def _staff_from_doc(doc: Dict[str, Any]) -> Staff:
    role = doc.get("role") or "blank"
    fixed_slot = None
    if role == "fixed":
        note = doc.get("note") or ""
        fixed_slot = note if note in SLOTS else "early"
    hours = doc.get("hours") or ["", "", "", "", ""]
    return Staff(
        name=doc.get("name") or "",
        floor=doc.get("floor") or "All",
        role=role,
        note=doc.get("note") or "",
        fixed_slot=fixed_slot,
        hours=list(hours),
        number=doc.get("number") or "",
        start_date=parse_date(doc["startDate"]) if doc.get("startDate") else None,
        end_date=parse_date(doc["endDate"]) if doc.get("endDate") else None,
        room=doc.get("room") or "",
    )


def _leave_from_doc(doc: Dict[str, Any]) -> Leave:
    return Leave(
        name=doc["name"],
        start=parse_date(doc["start"]),
        end=parse_date(doc["end"]) if doc.get("end") else None,
        kind=doc.get("kind") or "Leave",
    )


def _override_from_transfer_doc(doc: Dict[str, Any]) -> Override:
    return Override(
        name=doc["name"],
        start=parse_date(doc["start"]),
        end=parse_date(doc["end"]) if doc.get("end") else None,
        slot=doc.get("slot") or None,
        text=doc.get("text") or "",
    )


def _seed_new_joiner_history(
    staff: List[Staff], history: Dict[str, Dict[str, int]]
) -> Dict[str, Dict[str, int]]:
    """A brand-new staff member (added since history was last recorded) has
    no entry and would otherwise start at zero on every slot - looking, to
    the fairness solver, like they're owed every slot at once, and getting
    pulled disproportionately toward whichever one the team has done least.
    Seed them at the team's rounded average per slot instead, same as
    anyone already in the rotation."""
    scheduled = {"rotating", "fixed", "paired"}
    counted_names = [
        s.name for s in staff if s.role in scheduled and s.name and s.name in history
    ]
    if counted_names:
        avg = {
            slot: round(sum(history[n].get(slot, 0) for n in counted_names) / len(counted_names))
            for slot in SLOTS
        }
    else:
        avg = {slot: 0 for slot in SLOTS}
    seeded = dict(history)
    for st in staff:
        if st.role in scheduled and st.name and st.name not in seeded:
            seeded[st.name] = dict(avg)
    return seeded


def build_inputs_from_db(
    settings: Settings,
    staff_docs: List[Dict[str, Any]],
    leave_docs: List[Dict[str, Any]],
    transfer_docs: List[Dict[str, Any]],
    history: Dict[str, Dict[str, int]],
    last_slot: Dict[str, str],
) -> Inputs:
    ordered = sorted(staff_docs, key=lambda d: d.get("order", 0))
    staff = [_staff_from_doc(d) for d in ordered]
    leave = [_leave_from_doc(d) for d in leave_docs]
    history = _seed_new_joiner_history(staff, history)

    # "transfers" carries two different request shapes from the app: a
    # slot/text override (e.g. Jason covering 7:30, seeded from the paper
    # roster) and a floor-change request (from the Transfer button, keyed
    # by "newFloor"). Only the former maps to a scheduling Override today;
    # a floor change has no engine effect until floors are split, so it's
    # left out of Inputs here (the mobile page still lists it as a pending
    # transfer either way).
    overrides = [
        _override_from_transfer_doc(d) for d in transfer_docs if d.get("slot") or d.get("text")
    ]

    return Inputs(
        settings=settings,
        staff=staff,
        leave=leave,
        overrides=overrides,
        history=history,
        last_slot=last_slot,
    )
