// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { findLeaveForDate, isDateInLeave, mergeLeaveIntoEntries } from '../leave';
import type { LeaveEntry, RosterEntry } from '../types';

const holiday: LeaveEntry = { id: 'l1', staffId: 'hanny', type: 'holiday', fromDate: '2026-09-28', toDate: '2026-10-02' };
const openEndedMaternity: LeaveEntry = { id: 'l2', staffId: 'eirini', type: 'maternity', fromDate: '2026-01-05', toDate: null };

describe('isDateInLeave', () => {
  it('is true on the boundary dates and everything between', () => {
    expect(isDateInLeave(holiday, '2026-09-28')).toBe(true);
    expect(isDateInLeave(holiday, '2026-09-30')).toBe(true);
    expect(isDateInLeave(holiday, '2026-10-02')).toBe(true);
    expect(isDateInLeave(holiday, '2026-09-27')).toBe(false);
    expect(isDateInLeave(holiday, '2026-10-03')).toBe(false);
  });

  it('is open-ended when toDate is null ("until further notice", SPEC.md §12)', () => {
    expect(isDateInLeave(openEndedMaternity, '2027-06-01')).toBe(true);
    expect(isDateInLeave(openEndedMaternity, '2026-01-04')).toBe(false);
  });
});

describe('findLeaveForDate', () => {
  it('only matches the given staff member', () => {
    expect(findLeaveForDate([holiday], 'hanny', '2026-09-29')).toBe(holiday);
    expect(findLeaveForDate([holiday], 'manuel', '2026-09-29')).toBeUndefined();
  });
});

describe('mergeLeaveIntoEntries', () => {
  it('overrides a persisted shift with the leave cell (R7: nobody on leave is given a shift)', () => {
    const persisted: Record<string, RosterEntry> = {
      'hanny|2026-09-28': {
        weekStart: '2026-09-28',
        staffId: 'hanny',
        date: '2026-09-28',
        type: 'shift',
        patternCode: 'S1',
        start: '07:30',
        end: '16:30',
        unpaidLunchMinutes: 60,
        source: 'manual',
        note: null,
      },
    };
    const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    const merged = mergeLeaveIntoEntries(persisted, dates, ['hanny'], [holiday], '2026-09-28');

    expect(merged['hanny|2026-09-28'].type).toBe('holiday');
    expect(merged['hanny|2026-09-29'].type).toBe('holiday');
    expect(merged['hanny|2026-10-02'].type).toBe('holiday');
  });

  it('leaves cells untouched for staff/dates with no leave', () => {
    const merged = mergeLeaveIntoEntries({}, ['2026-09-28'], ['manuel'], [holiday], '2026-09-28');
    expect(merged['manuel|2026-09-28']).toBeUndefined();
  });
});
