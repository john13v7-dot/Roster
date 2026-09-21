// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { computeCoverageStrip, evaluateWeekRules } from '../rules';
import type { FairnessLedgerEntry, LeaveEntry, RoomHistoryEntry, RosterEntry, Staff } from '../../domain/types';

const EPOCH = '2000-01-03';
const WEEK = '2026-09-21';
const DATES = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const MON = DATES[0];

function staff(overrides: Partial<Staff> & Pick<Staff, 'id' | 'name' | 'type' | 'sortOrder'>): Staff {
  return {
    payrollIncluded: true,
    activeFrom: null,
    activeTo: null,
    numbered: true,
    floorOverride: null,
    ...overrides,
  };
}

const roster: Staff[] = [
  staff({ id: 'hanny', name: 'Hanny', type: 'rotating', sortOrder: 1010 }),
  staff({ id: 'manuel', name: 'Manuel', type: 'rotating', sortOrder: 2010 }),
  staff({ id: 'irene', name: 'Irene', type: 'rotating', sortOrder: 2020 }),
  staff({ id: 'deoshree', name: 'Deoshree', type: 'rotating', sortOrder: 2030 }),
  staff({ id: 'sandrine', name: 'Sandrine', type: 'rotating', sortOrder: 3010 }),
  staff({ id: 'daniel', name: 'Daniel', type: 'rotating', sortOrder: 3020 }),
  staff({ id: 'arantza', name: 'Arantza', type: 'rotating', sortOrder: 3030 }),
  staff({ id: 'david', name: 'David', type: 'rotating', sortOrder: 4010 }),
  staff({ id: 'usha', name: 'Usha', type: 'rotating', sortOrder: 4020 }),
  staff({ id: 'jason', name: 'Jason', type: 'paired_management', sortOrder: 7020, floorOverride: 'first' }),
  staff({ id: 'shehnaz', name: 'Shehnaz', type: 'paired_management', sortOrder: 7030 }),
  staff({ id: 'priscilla', name: 'Priscilla', type: 'manager', sortOrder: 7040 }),
];

const roomHistory: RoomHistoryEntry[] = [
  { staffId: 'hanny', roomId: 'toddlers', fromWeek: EPOCH, toWeek: null },
  { staffId: 'manuel', roomId: 'preschoolers', fromWeek: EPOCH, toWeek: null },
  { staffId: 'irene', roomId: 'preschoolers', fromWeek: EPOCH, toWeek: null },
  { staffId: 'deoshree', roomId: 'preschoolers', fromWeek: EPOCH, toWeek: null },
  { staffId: 'sandrine', roomId: 'ecec1', fromWeek: EPOCH, toWeek: null },
  { staffId: 'daniel', roomId: 'ecec1', fromWeek: EPOCH, toWeek: null },
  { staffId: 'arantza', roomId: 'ecec1', fromWeek: EPOCH, toWeek: null },
  { staffId: 'david', roomId: 'ecec2', fromWeek: EPOCH, toWeek: null },
  { staffId: 'usha', roomId: 'ecec2', fromWeek: EPOCH, toWeek: null },
];

function shift(staffId: string, date: string, code: 'S1' | 'S2' | 'S3' | 'S4'): RosterEntry {
  const times: Record<string, [string, string]> = {
    S1: ['07:30', '16:30'],
    S2: ['08:00', '17:00'],
    S3: ['08:30', '17:30'],
    S4: ['09:00', '18:00'],
  };
  const [start, end] = times[code];
  return {
    weekStart: WEEK,
    staffId,
    date,
    type: 'shift',
    patternCode: code,
    start,
    end,
    unpaidLunchMinutes: 60,
    source: 'manual',
    note: null,
  };
}

function manualShift(staffId: string, date: string, start: string, end: string): RosterEntry {
  return {
    weekStart: WEEK,
    staffId,
    date,
    type: 'shift',
    patternCode: null,
    start,
    end,
    unpaidLunchMinutes: 0,
    source: 'manual',
    note: null,
  };
}

/** A fully-covered week: matches the seed data's own pattern assignment (SPEC.md §16). */
function baseWeekEntries(): Record<string, RosterEntry> {
  const patternByStaff: Record<string, 'S1' | 'S2' | 'S3' | 'S4'> = {
    hanny: 'S1',
    deoshree: 'S1',
    jason: 'S1',
    manuel: 'S2',
    daniel: 'S2',
    sandrine: 'S3',
    david: 'S3',
    irene: 'S4',
    arantza: 'S4',
    usha: 'S4',
    shehnaz: 'S4',
  };
  const entries: Record<string, RosterEntry> = {};
  for (const date of DATES) {
    for (const [staffId, code] of Object.entries(patternByStaff)) {
      entries[`${staffId}|${date}`] = shift(staffId, date, code);
    }
  }
  return entries;
}

function run(entriesByKey: Record<string, RosterEntry>, extra: Partial<Parameters<typeof evaluateWeekRules>[0]> = {}) {
  return evaluateWeekRules({
    weekStart: WEEK,
    dates: DATES,
    staff: roster,
    roomHistory,
    entriesByKey,
    leaveEntries: [],
    fairnessLedger: [],
    ...extra,
  });
}

describe('R1/R2 — opening and closing cover', () => {
  it('passes on a fully-staffed week', () => {
    const warnings = run(baseWeekEntries());
    expect(warnings.filter((w) => w.ruleId === 'R1')).toHaveLength(0);
    expect(warnings.filter((w) => w.ruleId === 'R2')).toHaveLength(0);
  });

  it('flags R1 red when nobody opens at 7:30', () => {
    const entries = baseWeekEntries();
    delete entries[`hanny|${MON}`];
    delete entries[`deoshree|${MON}`];
    delete entries[`jason|${MON}`];
    const warnings = run(entries);
    expect(warnings.some((w) => w.ruleId === 'R1' && w.severity === 'red' && w.date === MON)).toBe(true);
  });

  it('T8: Priscilla closing manually covers R2 when neither Jason nor Shehnaz closes', () => {
    const entries = baseWeekEntries();
    // Move everyone off the 18:00 close except add Priscilla manually.
    for (const id of ['irene', 'arantza', 'usha', 'shehnaz']) {
      entries[`${id}|${MON}`] = shift(id, MON, 'S3'); // no longer finishing at 18:00
    }
    entries['priscilla|' + MON] = manualShift('priscilla', MON, '10:00', '18:00');
    const warnings = run(entries);
    // Still short on room-staff closers (only 0 room staff now), so R2 should still fire —
    // but NOT for "no management cover", since Priscilla covers that part.
    const r2 = warnings.filter((w) => w.ruleId === 'R2' && w.date === MON);
    expect(r2.some((w) => w.message.includes('no Jason/Shehnaz or Priscilla'))).toBe(false);
  });
});

describe('R3 — Jason/Shehnaz complementary starts', () => {
  it('passes when they are on complementary S1/S4', () => {
    const warnings = run(baseWeekEntries());
    expect(warnings.filter((w) => w.ruleId === 'R3')).toHaveLength(0);
  });

  it('flags when both present but not complementary', () => {
    const entries = baseWeekEntries();
    entries[`shehnaz|${MON}`] = shift('shehnaz', MON, 'S2');
    const warnings = run(entries);
    expect(warnings.some((w) => w.ruleId === 'R3' && w.date === MON)).toBe(true);
  });

  it('T8: warns "set manually" when Shehnaz is on holiday and Jason still works', () => {
    const entries = baseWeekEntries();
    entries[`shehnaz|${MON}`] = {
      weekStart: WEEK,
      staffId: 'shehnaz',
      date: MON,
      type: 'holiday',
      patternCode: null,
      start: null,
      end: null,
      unpaidLunchMinutes: 0,
      source: 'manual',
      note: null,
    };
    const warnings = run(entries);
    const r3 = warnings.find((w) => w.ruleId === 'R3' && w.date === MON);
    expect(r3).toBeDefined();
    expect(r3!.message).toContain('set');
  });
});

describe('R4 — floor balance', () => {
  it('flags the S3 slot in the base week: Sandrine (ECEC1) and David (ECEC2) are both 1st floor, none on ground', () => {
    // This is a genuine characteristic of the seed roster (SPEC.md §16) —
    // the app is supposed to surface it, not silently accept it.
    const warnings = run(baseWeekEntries());
    const r4 = warnings.filter((w) => w.ruleId === 'R4');
    expect(r4.every((w) => w.severity === 'amber' && w.message.startsWith('S3'))).toBe(true);
    expect(r4).toHaveLength(DATES.length);
  });

  it('T7-style: Sandrine, David and Jason (all 1st floor) alone on the 18:00 close is a red zero-floor violation', () => {
    const entries: Record<string, RosterEntry> = {};
    entries[`sandrine|${MON}`] = shift('sandrine', MON, 'S4');
    entries[`david|${MON}`] = shift('david', MON, 'S4');
    entries[`jason|${MON}`] = shift('jason', MON, 'S4');
    const warnings = run(entries);
    expect(
      warnings.some(
        (w) => w.ruleId === 'R4' && w.severity === 'red' && w.date === MON && w.message.includes('Closing'),
      ),
    ).toBe(true);
  });
});

describe('R5/R6 — vacant seats and room capacity', () => {
  it('flags a vacant seat when a room is short of its seat count', () => {
    // Only 8 of 9 rotating room seats filled in the fixture's own room_history — actually
    // roomHistory above fills every seat, so remove one to create a vacancy.
    const shortHistory = roomHistory.filter((h) => h.staffId !== 'usha');
    const warnings = evaluateWeekRules({
      weekStart: WEEK,
      dates: DATES,
      staff: roster,
      roomHistory: shortHistory,
      entriesByKey: {},
      leaveEntries: [],
      fairnessLedger: [],
    });
    expect(warnings.some((w) => w.ruleId === 'R5' && w.message.includes('ECEC 2'))).toBe(true);
  });

  it('flags over capacity when a room has more occupants than seats', () => {
    // Preschoolers already has its 3 seats full (manuel/irene/deoshree) —
    // a 4th person overflows it.
    const extra: RoomHistoryEntry = { staffId: 'jason', roomId: 'preschoolers', fromWeek: EPOCH, toWeek: null };
    const warnings = evaluateWeekRules({
      weekStart: WEEK,
      dates: DATES,
      staff: roster,
      roomHistory: [...roomHistory, extra],
      entriesByKey: {},
      leaveEntries: [],
      fairnessLedger: [],
    });
    expect(warnings.some((w) => w.ruleId === 'R6' && w.message.includes('Preschoolers'))).toBe(true);
  });
});

describe('R7 — nobody on leave has a shift', () => {
  it('flags a shift that overlaps a leave entry', () => {
    const entries = baseWeekEntries();
    const leave: LeaveEntry[] = [{ id: 'l1', staffId: 'hanny', type: 'holiday', fromDate: MON, toDate: MON }];
    const warnings = run(entries, { leaveEntries: leave });
    expect(warnings.some((w) => w.ruleId === 'R7' && w.staffId === 'hanny')).toBe(true);
  });

  it('does not flag when leave already overrode the cell (the normal app path)', () => {
    const entries = baseWeekEntries();
    entries[`hanny|${MON}`] = {
      weekStart: WEEK,
      staffId: 'hanny',
      date: MON,
      type: 'holiday',
      patternCode: null,
      start: null,
      end: null,
      unpaidLunchMinutes: 0,
      source: 'manual',
      note: null,
    };
    const leave: LeaveEntry[] = [{ id: 'l1', staffId: 'hanny', type: 'holiday', fromDate: MON, toDate: MON }];
    const warnings = run(entries, { leaveEntries: leave });
    expect(warnings.some((w) => w.ruleId === 'R7')).toBe(false);
  });
});

describe('R8 — day-level overrides', () => {
  it('flags a day that deviates from the week majority pattern', () => {
    const entries = baseWeekEntries();
    entries[`hanny|${MON}`] = shift('hanny', MON, 'S2'); // Hanny is S1 the rest of the week
    const warnings = run(entries);
    expect(warnings.some((w) => w.ruleId === 'R8' && w.staffId === 'hanny' && w.date === MON)).toBe(true);
  });
});

describe('R9 — no repeat of the same pattern two weeks running', () => {
  it('flags when this week matches last week\'s locked pattern', () => {
    const entries = baseWeekEntries(); // hanny is S1 this week
    const ledger: FairnessLedgerEntry[] = [{ staffId: 'hanny', weekStart: '2026-09-14', patternCode: 'S1' }];
    const warnings = run(entries, { fairnessLedger: ledger });
    expect(warnings.some((w) => w.ruleId === 'R9' && w.staffId === 'hanny')).toBe(true);
  });

  it('does not flag when the pattern changed from last week', () => {
    const entries = baseWeekEntries();
    const ledger: FairnessLedgerEntry[] = [{ staffId: 'hanny', weekStart: '2026-09-14', patternCode: 'S3' }];
    const warnings = run(entries, { fairnessLedger: ledger });
    expect(warnings.some((w) => w.ruleId === 'R9' && w.staffId === 'hanny')).toBe(false);
  });
});

describe('R10 — fairness outlier', () => {
  it('flags a person with 2+ more of a pattern than the least-served colleague', () => {
    const ledger: FairnessLedgerEntry[] = [
      { staffId: 'hanny', weekStart: '2026-08-24', patternCode: 'S1' },
      { staffId: 'hanny', weekStart: '2026-08-31', patternCode: 'S1' },
      { staffId: 'hanny', weekStart: '2026-09-07', patternCode: 'S1' },
      { staffId: 'manuel', weekStart: '2026-08-24', patternCode: 'S2' },
    ];
    const warnings = run({}, { fairnessLedger: ledger });
    expect(warnings.some((w) => w.ruleId === 'R10' && w.staffId === 'hanny')).toBe(true);
  });

  it('does not flag when everyone is within 1 of each other', () => {
    const ledger: FairnessLedgerEntry[] = [
      { staffId: 'hanny', weekStart: '2026-08-24', patternCode: 'S1' },
      { staffId: 'manuel', weekStart: '2026-08-24', patternCode: 'S1' },
    ];
    const warnings = run({}, { fairnessLedger: ledger });
    expect(warnings.filter((w) => w.ruleId === 'R10')).toHaveLength(0);
  });
});

describe('computeCoverageStrip', () => {
  it('reports opening/closing ok and floor headcounts on the base week', () => {
    const coverage = computeCoverageStrip({
      weekStart: WEEK,
      dates: DATES,
      staff: roster,
      roomHistory,
      entriesByKey: baseWeekEntries(),
    });
    expect(coverage).toHaveLength(5);
    for (const day of coverage) {
      expect(day.openingOk).toBe(true);
      expect(day.closingOk).toBe(true);
      expect(day.groundCount + day.firstCount).toBe(11); // 10 rotating + jason (shehnaz also works)
    }
  });

  it('flags opening as not ok when nobody opens', () => {
    const coverage = computeCoverageStrip({
      weekStart: WEEK,
      dates: DATES,
      staff: roster,
      roomHistory,
      entriesByKey: {},
    });
    expect(coverage.every((d: any) => !d.openingOk && !d.closingOk)).toBe(true);
  });
});
