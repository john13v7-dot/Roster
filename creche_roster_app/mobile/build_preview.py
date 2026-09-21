"""Build the mobile preview (roster_preview.html filled in with real data)
plus the matching Excel/PDF, from a JSON export of the live database that
the preview's own Add Staff / Transfer / Add Holiday / Add Maternity Leave
buttons write to (staff / leave / transfers collections).

The db export itself isn't fetched by this script - it has no network
access of its own - so pass it in as a file (see --db-export). Settings,
fairness history and last-slot aren't editable through the app yet, so
they still come from sample_inputs().

Usage:
    python -m mobile.build_preview --db-export db_export.json --out-dir out/
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import load_workbook  # noqa: F401  (excel_io needs it importable)

from creche_roster.db_import import build_inputs_from_db
from creche_roster.engine import build_roster
from creche_roster.excel_io import make_template, write_workbook
from creche_roster.pdf_out import write_pdf
from creche_roster.sample import sample_inputs

HERE = Path(__file__).parent
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"]

# A shift someone was actually moved, or an automatic fallback (Priscilla
# closing), to hold the opening/closing ratio - the visible proof cover and
# fairness were respected when someone's away. Surfaced up front in the
# preview, not buried with the other, less actionable INFO checks.
ADJUSTMENT_RULES = {"Cover adjusted", "Closing fallback"}


def build(db_export: dict, roster_start: date) -> tuple:
    base = sample_inputs(roster_start)
    inputs = build_inputs_from_db(
        base.settings, db_export["staff"], db_export["leave"], db_export["transfers"],
        base.history, base.last_slot,
    )
    return inputs, build_roster(inputs)


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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db-export", required=True, help="JSON file: {staff: [...], leave: [...], transfers: [...]}")
    ap.add_argument("--start", default="2026-09-28", help="Roster start Monday, YYYY-MM-DD")
    ap.add_argument("--out-dir", default="out", help="Where to write the html/xlsx/pdf")
    args = ap.parse_args()

    roster_start = date.fromisoformat(args.start)
    db_export = json.loads(Path(args.db_export).read_text())
    inputs, roster = build(db_export, roster_start)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    xlsx, pdf, html = out_dir / "Roster_Planner.xlsx", out_dir / "Roster_Planner.pdf", out_dir / "roster_preview.html"

    make_template(xlsx, roster_start)  # input tabs (Staff/Leave/...) to layer Week/Checks/Totals onto
    write_workbook(xlsx, roster, xlsx, backup=False)
    write_pdf(roster, pdf)

    summary = summary_json(inputs, roster)
    summary["files"] = {
        "xlsx": {"filename": xlsx.name, "b64": base64.b64encode(xlsx.read_bytes()).decode("ascii")},
        "pdf": {"filename": pdf.name, "b64": base64.b64encode(pdf.read_bytes()).decode("ascii")},
    }
    template = (HERE / "roster_preview.html").read_text(encoding="utf-8")
    html.write_text(template.replace("__ROSTER_JSON__", json.dumps(summary)), encoding="utf-8")

    print(f"wrote {html}, {xlsx}, {pdf}")
    for w in summary["weeks"]:
        print(f"  {w['label']}: {len(w['breaches'])} breaches, {len(w['warnings'])} warnings, "
              f"{len(w['adjustments'])} cover adjustments")


if __name__ == "__main__":
    main()
