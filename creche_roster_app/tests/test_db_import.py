"""Tests for db_import.build_inputs_from_db: translating the mobile preview's
live database (as the Add Staff / Transfer / Add Holiday / Add Maternity Leave
buttons write it) into Inputs, the same shape sample_inputs() produces."""

import unittest
from datetime import date

from creche_roster.db_import import build_inputs_from_db
from creche_roster.engine import build_roster
from creche_roster.sample import sample_inputs

START = date(2026, 9, 28)


def seed_docs():
    """Mirrors what export_seed.py actually wrote to the artifact's database."""
    staff_docs = [
        {"name": "Sue", "floor": "All", "role": "static", "note": "8:30 – 1:30",
         "hours": ["", "", "", "OFF", ""], "number": "", "order": 0},
        {"name": "Hanny", "floor": "All", "role": "rotating", "note": "",
         "hours": ["", "", "", "", ""], "number": "", "order": 1},
        {"name": "", "floor": "All", "role": "vacant", "note": "8:30 – 5:30",
         "hours": ["", "", "", "", ""], "number": "", "order": 2},
        {"name": "Manuel", "floor": "All", "role": "rotating", "note": "",
         "hours": ["", "", "", "", ""], "number": "", "order": 3},
        {"name": "Jason", "floor": "All", "role": "paired", "note": "",
         "hours": ["", "", "", "", ""], "number": "", "order": 16},
        {"name": "Shehnaz", "floor": "All", "role": "paired", "note": "",
         "hours": ["", "", "", "", ""], "number": "", "order": 17},
        {"name": "Priscilla", "floor": "All", "role": "static", "note": "10:00 – 6:00",
         "hours": ["10:00 – 2:00", "", "", "", ""], "number": "", "order": 18},
    ]
    leave_docs = [
        {"name": "Shehnaz", "kind": "Holiday", "start": "2026-09-21", "end": None},
    ]
    transfer_docs = [
        {"name": "Jason", "slot": "early", "text": "", "start": "2026-09-21", "end": None},
    ]
    return staff_docs, leave_docs, transfer_docs


class DbImport(unittest.TestCase):
    def test_round_trips_staff_leave_and_slot_override(self):
        staff_docs, leave_docs, transfer_docs = seed_docs()
        settings = sample_inputs(START).settings
        inputs = build_inputs_from_db(settings, staff_docs, leave_docs, transfer_docs, {}, {})

        names = [s.name for s in inputs.staff if s.name]
        self.assertEqual(names, ["Sue", "Hanny", "Manuel", "Jason", "Shehnaz", "Priscilla"])
        self.assertEqual(inputs.leave[0].name, "Shehnaz")
        self.assertEqual(inputs.leave[0].kind, "Holiday")
        self.assertIsNone(inputs.leave[0].end)
        self.assertEqual(inputs.overrides[0].name, "Jason")
        self.assertEqual(inputs.overrides[0].slot, "early")

        # Builds a real roster without error (this trimmed 6-person staff list
        # isn't enough to meet the real 3-person cover rule - that's not what's
        # under test here, just that the translation produces valid Inputs).
        build_roster(inputs)

    def test_new_staff_doc_becomes_a_joiner(self):
        staff_docs, leave_docs, transfer_docs = seed_docs()
        staff_docs.append({
            "name": "Priya", "floor": "All", "role": "rotating", "note": "",
            "hours": ["", "", "", "", ""], "number": "", "order": 99,
            "startDate": "2026-10-05",
        })
        settings = sample_inputs(START).settings
        inputs = build_inputs_from_db(settings, staff_docs, leave_docs, transfer_docs, {}, {})
        priya = [s for s in inputs.staff if s.name == "Priya"][0]
        self.assertEqual(priya.start_date, date(2026, 10, 5))

        roster = build_roster(inputs)
        week1 = roster.weeks[0]
        self.assertEqual(set(week1.cells[("Priya", d)].text for d in week1.days), {"Not yet started"})

    def test_floor_only_transfer_is_not_a_scheduling_override(self):
        staff_docs, leave_docs, transfer_docs = seed_docs()
        transfer_docs.append({"name": "Manuel", "newFloor": "up", "start": "2026-10-05", "end": None})
        settings = sample_inputs(START).settings
        inputs = build_inputs_from_db(settings, staff_docs, leave_docs, transfer_docs, {}, {})
        # Only the real slot/text override (Jason's) becomes an Override; the
        # floor-only transfer request has no engine effect yet.
        self.assertEqual(len(inputs.overrides), 1)
        self.assertEqual(inputs.overrides[0].name, "Jason")


if __name__ == "__main__":
    unittest.main()
