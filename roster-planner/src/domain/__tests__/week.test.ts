// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { formatTimeRange, formatWeekRange, weekDates, weekStartOf } from '../week';

describe('formatWeekRange', () => {
  it('formats a same-month range with ordinals (SPEC.md §9)', () => {
    expect(formatWeekRange('2026-09-21')).toBe('21st – 25th September 2026');
  });

  it('formats a range that crosses a month', () => {
    // Mon 28 Sep - Fri 2 Oct 2026
    expect(formatWeekRange('2026-09-28')).toBe('28th September – 2nd October 2026');
  });
});

describe('formatTimeRange', () => {
  it('standardises the separator and 12h format (SPEC.md §9)', () => {
    expect(formatTimeRange('07:30', '16:30')).toBe('7:30 – 4:30');
    expect(formatTimeRange('08:00', '17:00')).toBe('8:00 – 5:00');
    expect(formatTimeRange('09:00', '18:00')).toBe('9:00 – 6:00');
  });
});

describe('weekDates / weekStartOf', () => {
  it('returns Mon..Fri ISO dates for the week containing the given date', () => {
    const dates = weekDates(new Date('2026-09-23T12:00:00'));
    expect(dates).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  });

  it('resolves the Monday of the week', () => {
    expect(weekStartOf(new Date('2026-09-25T09:00:00'))).toBe('2026-09-21');
  });
});
