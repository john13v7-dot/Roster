"""Creche staff roster generator.

One engine (engine.build_roster) produces a Roster object.
The Excel and PDF outputs are both rendered from the same layout of that
object (layout.week_grid), so they can never disagree.
"""

__version__ = "1.0.0"
