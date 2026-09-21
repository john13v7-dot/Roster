"""Compare two db-export snapshots (before/after a single request) and
report exactly who else's shift changed as a direct consequence - the
answer to "who else had to change shift to cover this?" without having
to eyeball the whole roster.

Usage:
    python -m mobile.diff_impact --before before.json --after after.json --start 2026-09-28 [--changed-name Deoshree]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from creche_roster.db_import import build_inputs_from_db
from creche_roster.engine import build_roster
from creche_roster.sample import sample_inputs


def people_by_week(db_export: dict, roster_start: date):
    base = sample_inputs(roster_start)
    inputs = build_inputs_from_db(
        base.settings, db_export["staff"], db_export["leave"], db_export["transfers"],
        base.history, base.last_slot,
    )
    roster = build_roster(inputs)
    out = []
    for week in roster.weeks:
        people = {}
        for key, st in roster.staff_keys:
            if st.role in ("blank",) or not st.name:
                continue
            people[st.name] = [week.cells[(key, d)].text for d in week.days]
        out.append(people)
    return out


def diff(before: dict, after: dict, roster_start: date, changed_name: str | None = None):
    """{week_index: {name: (before_days, after_days)}} for everyone whose
    week actually differs, excluding changed_name (the person the request
    was about - their own change is the request, not its impact)."""
    before_weeks = people_by_week(before, roster_start)
    after_weeks = people_by_week(after, roster_start)
    result = {}
    for wi, (bp, ap) in enumerate(zip(before_weeks, after_weeks)):
        changed = {}
        for name in ap:
            if name == changed_name:
                continue
            b, a = bp.get(name), ap[name]
            if b != a:
                changed[name] = (b, a)
        if changed:
            result[wi] = changed
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--start", default="2026-09-28")
    ap.add_argument("--changed-name", default=None)
    args = ap.parse_args()

    roster_start = date.fromisoformat(args.start)
    before = json.loads(Path(args.before).read_text())
    after = json.loads(Path(args.after).read_text())
    result = diff(before, after, roster_start, args.changed_name)

    if not result:
        print("Nobody else's shift changed in any week.")
        return
    for wi, changed in result.items():
        print(f"Week {wi + 1}:")
        for name, (b, a) in changed.items():
            print(f"  {name}: {b} -> {a}")


if __name__ == "__main__":
    main()
