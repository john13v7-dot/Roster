"""Cloud Functions backend for the standalone roster app.

Whenever staff, leave or transfers changes in Firestore, this reruns the
real scheduling engine (the same creche_roster package the Claude-hosted
version uses - vendored into this directory, not reimplemented) over the
*whole* roster and writes the result to roster/current, so the app updates
itself with no Claude, and no person, in the loop.

Deploy with `firebase deploy --only functions` (see ../DEPLOY.md).
"""
from __future__ import annotations

import os
import sys
import tempfile
import traceback
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))  # so the vendored creche_roster/ package resolves

from firebase_admin import firestore, initialize_app, storage
from firebase_functions import firestore_fn, https_fn, options, scheduler_fn

from creche_roster.db_import import build_inputs_from_db
from creche_roster.duties import build_duty_roster
from creche_roster.engine import build_roster
from creche_roster.excel_io import write_roster_only
from creche_roster.models import InputError
from creche_roster.pdf_out import write_pdf
from creche_roster.sample import sample_inputs
from roster_json import diff_people, duties_json, fairness_json, monday_of_this_week, summary_json

initialize_app()
options.set_global_options(region="us-central1", memory=512, timeout_sec=120)

STORAGE_XLSX = "roster/Roster_Planner.xlsx"
STORAGE_PDF = "roster/Roster_Planner.pdf"


def _rebuild() -> None:
    db = firestore.client()
    staff = [d.to_dict() for d in db.collection("staff").stream()]
    leave = [d.to_dict() for d in db.collection("leave").stream()]
    transfers = [d.to_dict() for d in db.collection("transfers").stream()]
    duty_overrides = [d.to_dict() for d in db.collection("dutyOverrides").stream()]

    old_doc = db.collection("roster").document("current").get()
    old_summary = old_doc.to_dict() if old_doc.exists else None

    roster_start = monday_of_this_week(date.today())
    base = sample_inputs(roster_start)
    # No carried-over history: each 4-week window is balanced among
    # itself, not against whatever was worked before it - matches the
    # Claude-hosted build (mobile/build_preview.py's build()).
    inputs = build_inputs_from_db(base.settings, staff, leave, transfers, {}, {}, duty_overrides)

    try:
        roster = build_roster(inputs)
    except InputError as e:
        db.collection("roster").document("current").set({
            "error": "Could not build the roster: " + "; ".join(e.problems),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return

    duty_weeks = build_duty_roster(inputs, roster)
    summary = summary_json(inputs, roster)
    summary["duties"] = duties_json(inputs, duty_weeks)
    summary["fairness"] = fairness_json(inputs, roster, duty_weeks)
    summary["error"] = None
    summary["updatedAt"] = firestore.SERVER_TIMESTAMP

    with tempfile.TemporaryDirectory() as tmp:
        xlsx_path = os.path.join(tmp, "Roster_Planner.xlsx")
        pdf_path = os.path.join(tmp, "Roster_Planner.pdf")
        write_roster_only(roster, xlsx_path)
        write_pdf(roster, pdf_path)

        bucket = storage.bucket()
        bucket.blob(STORAGE_XLSX).upload_from_filename(
            xlsx_path, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        bucket.blob(STORAGE_PDF).upload_from_filename(pdf_path, content_type="application/pdf")

    summary["files"] = {"xlsx": STORAGE_XLSX, "pdf": STORAGE_PDF}
    db.collection("roster").document("current").set(summary)

    changed = diff_people(old_summary, summary) if old_summary is not None else []
    breaches = sum(len(w["breaches"]) for w in summary["weeks"])
    db.collection("changelog").document().set({
        "createdAt": firestore.SERVER_TIMESTAMP,
        "breaches": breaches,
        "impact": (
            ", ".join(changed) + "'s " + ("shifts changed." if len(changed) > 1 else "shift changed.") if changed
            else "No one's shift changed."
        ) if old_summary is not None else "First build.",
    })


def _rebuild_safely() -> None:
    """A rebuild failure (a bug, a bad doc) should never leave the
    Function silently crashed with nothing for the app to show - report
    it to roster/current the same way an InputError is, so the app can
    at least say something went wrong instead of hanging on stale data."""
    try:
        _rebuild()
    except Exception as e:  # noqa: BLE001 - deliberately broad: this is the last line of defense
        firestore.client().collection("roster").document("current").set({
            "error": f"Rebuild failed unexpectedly: {e}",
            "errorDetail": traceback.format_exc()[-4000:],
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)


@firestore_fn.on_document_written(document="staff/{docId}")
def on_staff_written(event: firestore_fn.Event) -> None:
    _rebuild_safely()


@firestore_fn.on_document_written(document="leave/{docId}")
def on_leave_written(event: firestore_fn.Event) -> None:
    _rebuild_safely()


@firestore_fn.on_document_written(document="transfers/{docId}")
def on_transfers_written(event: firestore_fn.Event) -> None:
    _rebuild_safely()


@https_fn.on_call()
def rebuild_now(req: https_fn.CallableRequest) -> dict:
    """Manual trigger (a Refresh/Rebuild button in the app) for the rare
    case someone wants the roster re-run without changing staff/leave/
    transfers - e.g. right after deploy, before any data exists yet."""
    _rebuild_safely()
    return {"ok": True}


@scheduler_fn.on_schedule(schedule="0 3 * * *", timezone=scheduler_fn.Timezone("Etc/UTC"))
def daily_rebuild(event: scheduler_fn.ScheduledEvent) -> None:
    """The roster window is always "the Monday of this week onward" - with
    nobody editing anything for a few days, nothing would otherwise ever
    tell it that a new week has started. Re-run once a day so it stays
    current on its own, not just when someone happens to make a change."""
    _rebuild_safely()
