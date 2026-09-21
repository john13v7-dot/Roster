// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { addDays, format, startOfWeek } from 'date-fns';

/** Monday..Friday ISO dates ("yyyy-MM-dd") for the week containing `date`. */
export function weekDates(date: Date): string[] {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return [0, 1, 2, 3, 4].map((n) => format(addDays(monday, n), 'yyyy-MM-dd'));
}

/** The ISO Monday date ("yyyy-MM-dd") for the week containing `date`. */
export function weekStartOf(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * "21st – 25th September 2026" style range for the printed title (SPEC.md §9).
 * `weekStartIso` is the Monday of the week, "yyyy-MM-dd".
 */
export function formatWeekRange(weekStartIso: string): string {
  const monday = new Date(`${weekStartIso}T00:00:00`);
  const friday = addDays(monday, 4);
  const mondayDay = ordinal(monday.getDate());
  const fridayDay = ordinal(friday.getDate());
  const sameMonth = monday.getMonth() === friday.getMonth() && monday.getFullYear() === friday.getFullYear();
  if (sameMonth) {
    return `${mondayDay} – ${fridayDay} ${format(friday, 'MMMM yyyy')}`;
  }
  const sameYear = monday.getFullYear() === friday.getFullYear();
  const mondayMonth = format(monday, sameYear ? 'MMMM' : 'MMMM yyyy');
  return `${mondayDay} ${mondayMonth} – ${fridayDay} ${format(friday, 'MMMM yyyy')}`;
}

/** "21 Sep 2026" style date, for leave entries and similar lists. */
export function formatDateLong(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'd MMM yyyy');
}

/** Standardised on-screen/print time format, e.g. "7:30 – 4:30" (SPEC.md §9). */
export function formatTimeRange(start: string, end: string): string {
  return `${formatClock(start)} – ${formatClock(end)}`;
}

function formatClock(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr;
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m}`;
}
