"""Build the JSON the app reads (roster + duties + fairness), from a real
Inputs/Roster - the same shapes mobile/build_preview.py produces, just
callable from the Cloud Function instead of a CLI. Kept as its own module
so main.py stays about wiring (Firestore in, Firestore/Storage out), not
the schema itself.
"""
from __future__ import annotations

from datetime import date, timedelta

from creche_roster.duties import duty_fairness, duty_pool
from creche_roster.models import NDAYS

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"]

# A shift someone was actually moved, or an automatic fallback (Priscilla
# closing), to hold the opening/closing ratio - the visible proof cover and
# fairness were respected when someone's away. Surfaced up front in the
# preview, not buried with the other, less actionable INFO checks.
ADJUSTMENT_RULES = {"Cover adjusted", "Closing fallback"}


def summary_json(inputs, roster) -> dict:
    weeks_out = []
    for wi, week in enumerate(roster.weeks):
        breaches = [c.message for c in roster.checks if c.week == wi and c.level == "BREACH"]
        warnings = [c.message for c in roster.checks if c.week == wi and c.level == "WARNING"]
        adjustments = [c.message for c in roster.checks if c.week == wi and c.rule in ADJUSTMENT_RULES]
        infos = [
            c.message for c in roster.checks
            if c.week == wi and c.level == "INFO" and c.rule not in ADJUSTMENT_RULES
        ]
        working, people = [], []
        for key, st in roster.staff_keys:
            if st.role == "blank":
                continue
            label = st.name or ("Vacant post" if st.role == "vacant" else "")
            if not label:
                continue
            days_out = [{"text": week.cells[(key, d)].text, "kind": week.cells[(key, d)].kind} for d in week.days]
            people.append({"name": label, "role": st.role, "days": days_out})
            if st.role != "vacant" and any(week.cells[(key, d)].kind in ("shift", "static") for d in week.days):
                working.append(st.name)
        weeks_out.append({
            "label": f"{week.days[0]:%d %b} – {week.days[-1]:%d %b %Y}",
            "monday": week.monday.isoformat(), "day_names": DAY_NAMES,
            "breaches": breaches, "warnings": warnings, "adjustments": adjustments, "notes": infos,
            "working": working, "people": people,
        })
    return {"title": inputs.settings.title, "weeks": weeks_out}


def duties_json(inputs, duty_weeks) -> list:
    weeks_out = []
    for dw in duty_weeks:
        days = [dw["monday"] + timedelta(days=i) for i in range(NDAYS)]
        weeks_out.append({
            "label": f"{days[0]:%d %b} – {days[-1]:%d %b %Y}",
            "monday": dw["monday"].isoformat(),
            "assignments": dw["assignments"],
            "unfilled": dw["unfilled"],
        })
    return weeks_out


def fairness_json(inputs, roster, duty_weeks) -> dict:
    rotating_names = [st.name for st in inputs.staff if st.role == "rotating" and st.name]
    shift_rows = [
        {
            "name": name,
            "early": roster.period_counts.get(name, {}).get("early", 0),
            "mid1": roster.period_counts.get(name, {}).get("mid1", 0),
            "mid2": roster.period_counts.get(name, {}).get("mid2", 0),
            "late": roster.period_counts.get(name, {}).get("late", 0),
        }
        for name in rotating_names
    ]
    totals = duty_fairness(inputs, duty_weeks)
    duty_rows = [{"name": name, "duties": totals[name]} for name in duty_pool(inputs)]
    return {"shifts": shift_rows, "duties": duty_rows}


def diff_people(old_summary: dict | None, new_summary: dict) -> list:
    """Everyone whose day-by-day schedule text differs between two
    summary_json() results, week by week - the automatic replacement for
    Claude's old "who else's shift changed" narration, now that a rebuild
    happens with nobody watching to write it up."""
    def index(summary):
        idx = {}
        for wi, week in enumerate((summary or {}).get("weeks", [])):
            for p in week["people"]:
                idx[(wi, p["name"])] = [d["text"] for d in p["days"]]
        return idx

    old_idx, new_idx = index(old_summary), index(new_summary)
    changed = set()
    for key, new_days in new_idx.items():
        if old_idx.get(key) != new_days:
            changed.add(key[1])
    return sorted(changed)


def monday_of_this_week(today: date) -> date:
    """The rolling 4-week window always starts on the Monday of the
    current week (or today, if today is already Monday) - so the app
    stays current on its own as real time passes, with no one needing to
    remember to bump a start date."""
    return today - timedelta(days=today.weekday())
