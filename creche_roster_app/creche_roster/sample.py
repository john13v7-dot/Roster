"""Starter data: the real staff list from the printed roster of 21st-25th September 2026.

Everything the paper roster does not say is a placeholder and is marked as one
in the workbook: the floor split and the minimum opening / closing cover.
"""

from __future__ import annotations

from datetime import date, time

from .models import Inputs, Leave, Override, Settings, Shift, Staff


def _static(name, hours="", number="", **days):
    """A person with own hours. days: mon="...", thu="OFF" ..."""
    per_day = [days.get(d, "") for d in ("mon", "tue", "wed", "thu", "fri")]
    return Staff(name, "All", "static", hours, None, per_day, number)


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
    rot = lambda n: Staff(n, "All", "rotating")  # noqa: E731
    staff = [
        _static("Sue", "8:30 – 1:30", thu="OFF"),
        rot("Hanny"),
        Staff("", "All", "vacant", "8:30 – 5:30"),  # the empty post on the printed roster
        rot("Manuel"),
        rot("Irene"),
        rot("Deoshree"),
        rot("Sandrine"),
        rot("Daniel"),
        rot("Arantza"),
        rot("David"),
        rot("Usha"),
        Staff("", "All", "vacant"),
        Staff("", "All", "vacant"),
        Staff("", "All", "blank"),
        _static("Eirini", number="-"),
        _static("Megan"),
        Staff("Jason", "All", "paired"),
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
