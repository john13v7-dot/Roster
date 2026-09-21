// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Pure leave-range logic (SPEC.md §12). Leave is the source of truth for
// Holiday/Maternity Leave cells — the roster is filled by checking, for
// each Mon-Fri date shown, whether it falls inside a leave entry, rather
// than writing a row per day up front. That also makes an open-ended
// maternity leave ("until further notice") work for free, and keeps
// edits/deletes correct everywhere without having to clean up scattered
// rows (§12 "Entries are editable and deletable, and the roster updates").

import type { LeaveEntry, LeaveType, RosterEntry, RosterEntryType } from './types';

export function isDateInLeave(leave: LeaveEntry, date: string): boolean {
  if (date < leave.fromDate) return false;
  if (leave.toDate !== null && date > leave.toDate) return false;
  return true;
}

/** Which leave entry (if any) covers this person on this date. First match wins. */
export function findLeaveForDate(
  leaveEntries: LeaveEntry[],
  staffId: string,
  date: string,
): LeaveEntry | undefined {
  return leaveEntries.find((l) => l.staffId === staffId && isDateInLeave(l, date));
}

export function leaveRosterEntryType(type: LeaveType): RosterEntryType | null {
  switch (type) {
    case 'holiday':
      return 'holiday';
    case 'maternity':
      return 'maternity';
    case 'sick':
      // Data model is ready (SPEC.md §11) but the sick-leave feature isn't
      // built yet (§14) — no roster cell is derived for it in this phase.
      return null;
    default:
      return null;
  }
}

/**
 * Overlays leave-derived cells onto a week's persisted roster entries.
 * Leave always wins over whatever was previously stored for that cell
 * (R7 "nobody on leave is given a shift").
 */
export function mergeLeaveIntoEntries(
  entriesByKey: Record<string, RosterEntry>,
  dates: string[],
  staffIds: string[],
  leaveEntries: LeaveEntry[],
  weekStart: string,
): Record<string, RosterEntry> {
  const merged = { ...entriesByKey };
  for (const staffId of staffIds) {
    for (const date of dates) {
      const leave = findLeaveForDate(leaveEntries, staffId, date);
      if (!leave) continue;
      const type = leaveRosterEntryType(leave.type);
      if (!type) continue;
      merged[`${staffId}|${date}`] = {
        weekStart,
        staffId,
        date,
        type,
        patternCode: null,
        start: null,
        end: null,
        unpaidLunchMinutes: 0,
        source: 'manual',
        note: null,
      };
    }
  }
  return merged;
}

export function leaveTypeLabel(type: LeaveType): string {
  switch (type) {
    case 'holiday':
      return 'Holiday';
    case 'maternity':
      return 'Maternity Leave';
    case 'sick':
      return 'Sick';
    default:
      return type;
  }
}
