"""Tests for mobile.diff_impact: precisely answering "who else had to
change shift because of this request?" by comparing two db exports."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mobile.diff_impact import diff

START = date(2026, 9, 28)


def staff_docs():
    names = ["Hanny", "Manuel", "Irene", "Deoshree", "Sandrine", "Daniel", "Arantza", "David", "Usha"]
    return [
        {"name": n, "floor": "All", "role": "rotating", "note": "", "hours": ["", "", "", "", ""],
         "number": "", "order": i}
        for i, n in enumerate(names)
    ] + [
        {"name": "Jason", "floor": "All", "role": "paired", "note": "", "hours": ["", "", "", "", ""],
         "number": "", "order": 90},
        {"name": "Shehnaz", "floor": "All", "role": "paired", "note": "", "hours": ["", "", "", "", ""],
         "number": "", "order": 91},
        {"name": "Priscilla", "floor": "All", "role": "static", "note": "10:00 – 6:00",
         "hours": ["10:00 – 2:00", "", "", "", ""], "number": "", "order": 92},
    ]


def export_with(extra_leave):
    return {
        "staff": staff_docs(),
        "leave": [{"name": "Shehnaz", "kind": "Holiday", "start": "2026-09-21", "end": None}] + extra_leave,
        "transfers": [{"name": "Jason", "slot": "early", "text": "", "start": "2026-09-21", "end": None}],
    }


class DiffImpact(unittest.TestCase):
    def test_no_change_reports_empty(self):
        before = export_with([])
        after = export_with([])
        self.assertEqual(diff(before, after, START), {})

    def test_new_leave_that_forces_a_repair_is_detected(self):
        # A small team (9 rotating + the pair): taking two people out at once
        # is tight enough that the daily repair has to move someone.
        before = export_with([{"name": "Irene", "kind": "Holiday", "start": "2026-09-28", "end": "2026-10-02"}])
        after = export_with([
            {"name": "Irene", "kind": "Holiday", "start": "2026-09-28", "end": "2026-10-02"},
            {"name": "Deoshree", "kind": "Holiday", "start": "2026-09-28", "end": "2026-10-02"},
        ])
        result = diff(before, after, START, changed_name="Deoshree")
        self.assertTrue(result)  # someone else's cells actually differ, somewhere in the 4 weeks
        for changed in result.values():
            self.assertNotIn("Deoshree", changed)  # the changed person's own leave is the request, not its impact

    def test_changed_name_is_excluded_from_its_own_impact(self):
        before = export_with([])
        after = export_with([{"name": "Manuel", "kind": "Holiday", "start": "2026-09-28", "end": "2026-10-02"}])
        result = diff(before, after, START, changed_name="Manuel")
        for changed in result.values():
            self.assertNotIn("Manuel", changed)


if __name__ == "__main__":
    unittest.main()
