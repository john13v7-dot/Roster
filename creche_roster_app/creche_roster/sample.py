"""Starter data: the real staff list from the printed roster of 21st-25th September 2026.

Everything the paper roster does not say is a placeholder and is marked as one
in the workbook: the floor split and the minimum opening / closing cover.
"""

from __future__ import annotations

from datetime import date, time

from .models import Inputs, Leave, Override, Settings, Shift, Staff


def _static(name, hours="", number="", room="", **days):
    """A person with own hours. days: mon="...", thu="OFF" ..."""
    per_day = [days.get(d, "") for d in ("mon", "tue", "wed", "thu", "fri")]
    return Staff(name, "All", "static", hours, None, per_day, number, room=room)


def sample_inputs(start: date) -> Inputs:
    settings = Settings(
        title="STAFF ROSTER",
        roster_start=start,
        weeks=4,
        floors=["All"],
        shifts={
            "early": Shift(time(7, 30), time(16, 30)),
            "mid1": Shift(time(8, 0), time(17, 0)),
            "mid2": Shift(time(8, 30), time(17, 30)),
            "late": Shift(time(9, 0), time(18, 0)),
        },
        min_open={"All": 3},  # Jason or Shehnaz (from the pairing rule) + 2 staff
        min_close={"All": 3},  # Jason or Shehnaz (from the pairing rule) + 2 staff
        break_text="10 MINS",
        day_headers=False,
        fallback_closer="Priscilla",  # closes when neither Jason nor Shehnaz does
    )
    rot = lambda n, room: Staff(n, "All", "rotating", room=room)  # noqa: E731
    staff = [
        _static("Sue", "8:30 – 1:30", thu="OFF", room="Toddlers Room"),
        rot("Hanny", "Toddlers Room"),
        Staff("", "All", "vacant", "8:30 – 5:30", room="Toddlers Room"),  # the empty post on the printed roster
        rot("Manuel", "Preschoolers Room"),
        rot("Irene", "Preschoolers Room"),
        rot("Deoshree", "Preschoolers Room"),
        rot("Sandrine", "ECEC 1"),
        rot("Daniel", "ECEC 1"),
        rot("Arantza", "ECEC 1"),
        rot("David", "ECEC 2"),
        rot("Usha", "ECEC 2"),
        Staff("", "All", "vacant"),
        Staff("", "All", "vacant"),
        Staff("", "All", "blank"),
        _static("Eirini", number="-"),  # room not known - excluded from the room rule for now
        _static("Megan"),
        Staff("Jason", "All", "paired", room="ECEC 2"),
        Staff("Shehnaz", "All", "paired"),
        _static("Priscilla", "10:00 – 6:00", mon="10:00 – 2:00"),
        _static("Laura", "9:00 – 1:00"),
    ]
    # Right now: Shehnaz is on holiday until she is back (open ended), Eirini is
    # on maternity leave, and Jason is set to 7:30 until Shehnaz returns.
    first_week = date(2026, 9, 21)
    leave = [
        Leave("Shehnaz", first_week, None, "Holiday"),
        Leave("Eirini", first_week, None, "Maternity Leave"),
    ]
    overrides = [Override("Jason", first_week, None, "early")]

    # The printed week of 21st-25th September: 5 days on each person's start time.
    printed = {
        "Hanny": "early", "Manuel": "mid1", "Irene": "late", "Deoshree": "early",
        "Sandrine": "mid2", "Daniel": "mid1", "Arantza": "late", "David": "mid2",
        "Usha": "late", "Jason": "early",
    }
    history = {n: {sl: 5} for n, sl in printed.items()}
    return Inputs(
        settings=settings,
        staff=staff,
        leave=leave,
        overrides=overrides,
        history=history,
        last_slot=dict(printed),
    )
