"""Forgiving parsers for values typed into Excel cells."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any

_TIME_RE = re.compile(r"^\s*(\d{1,2})\s*[:.hH ]?\s*(\d{2})\s*$")

_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d/%m/%y",
    "%d %b %Y",
    "%d %B %Y",
)


def is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def parse_time(v: Any) -> time:
    """Accepts 07:30, 7:30, 07.30, '07 30', 0730, Excel times and Excel fractions."""
    if isinstance(v, datetime):
        return time(v.hour, v.minute)
    if isinstance(v, time):
        return time(v.hour, v.minute)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 0 <= v < 1:  # Excel stores times as a fraction of a day
            minutes = int(round(v * 24 * 60))
            return time(minutes // 60 % 24, minutes % 60)
        raise ValueError(f"'{v}' is not a time")
    if isinstance(v, str):
        m = _TIME_RE.match(v)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            if 0 <= h <= 23 and 0 <= mi <= 59:
                return time(h, mi)
    raise ValueError(f"'{v}' is not a time (use e.g. 07:30)")


def parse_date(v: Any) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        # Excel serial date
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()
    if isinstance(v, str):
        s = v.strip()
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    raise ValueError(f"'{v}' is not a date (use e.g. 21/09/2026)")


def fmt_day(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def fmt_days(days) -> str:
    """'Mon 21 Sep, Tue 22 Sep' for a list of dates (compact for long lists)."""
    days = sorted(days)
    if not days:
        return ""
    if len(days) <= 3:
        return ", ".join(fmt_day(d) for d in days)
    return f"{fmt_day(days[0])} to {fmt_day(days[-1])}, {len(days)} days"


_DASH_RE = re.compile(r"(\d)\s*[-–—]\s*(\d)")


def norm_hours(text) -> str:
    """Show typed hours the way the printed roster does: '10:00 - 2:00' -> '10:00 – 2:00'."""
    if text is None:
        return ""
    s = str(text).strip()
    return _DASH_RE.sub("\\1 – \\2", s)


def is_off(text: str) -> bool:
    return text.strip().upper() == "OFF"
