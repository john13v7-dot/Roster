// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { buildRosterRows, roomIdForStaffAtWeek } from '../rosterLayout';
import type { RoomHistoryEntry, Staff } from '../types';

const EPOCH = '2000-01-03'; // "has always been in this room" for seed-style fixtures

function staff(overrides: Partial<Staff> & Pick<Staff, 'id' | 'name' | 'sortOrder'>): Staff {
  return {
    type: 'rotating',
    payrollIncluded: true,
    activeFrom: null,
    activeTo: null,
    numbered: true,
    floorOverride: null,
    ...overrides,
  };
}

// A full seed-like set: Toddlers has only Hanny (1 of 2 seats), every
// other room is fully occupied, matching the real seed data's single
// vacancy at Toddlers row 3 (SPEC.md §16).
const seedStaff: Staff[] = [
  staff({ id: 'sue', name: 'Sue', type: 'static', sortOrder: 100 }),
  staff({ id: 'hanny', name: 'Hanny', sortOrder: 1010 }),
  staff({ id: 'manuel', name: 'Manuel', sortOrder: 2010 }),
  staff({ id: 'irene', name: 'Irene', sortOrder: 2020 }),
  staff({ id: 'deoshree', name: 'Deoshree', sortOrder: 2030 }),
  staff({ id: 'sandrine', name: 'Sandrine', sortOrder: 3010 }),
  staff({ id: 'daniel', name: 'Daniel', sortOrder: 3020 }),
  staff({ id: 'arantza', name: 'Arantza', sortOrder: 3030 }),
  staff({ id: 'david', name: 'David', sortOrder: 4010 }),
  staff({ id: 'usha', name: 'Usha', sortOrder: 4020 }),
  staff({ id: 'eirini', name: 'Eirini', sortOrder: 6010, numbered: false }),
  staff({ id: 'megan', name: 'Megan', type: 'static', sortOrder: 7010 }),
  staff({ id: 'jason', name: 'Jason', type: 'paired_management', sortOrder: 7020 }),
  staff({ id: 'laura', name: 'Laura', type: 'static', sortOrder: 7050 }),
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

const WEEK = '2026-09-21';

describe('buildRosterRows', () => {
  it('orders Sue, room blocks (with a vacant row where a seat is unfilled), spare rows, then the trailing group (SPEC.md §7)', () => {
    const rows = buildRosterRows(seedStaff, roomHistory, WEEK);
    const kinds = rows.map((r) => (r.kind === 'staff' ? r.staff.id : r.kind));
    expect(kinds).toEqual([
      'sue',
      'hanny',
      'vacant', // Toddlers seat 2 of 2, nobody in it
      'manuel',
      'irene',
      'deoshree',
      'sandrine',
      'daniel',
      'arantza',
      'david',
      'usha',
      'spacer',
      'spacer',
      'eirini',
      'megan',
      'jason',
      'laura',
    ]);
  });

  it('numbers every row except a row flagged numbered:false, without breaking the sequence (SPEC.md §16)', () => {
    const rows = buildRosterRows(seedStaff, roomHistory, WEEK);
    const numbers = rows.map((r) => r.rowNumber);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, null, 14, 15, 16]);
  });

  it('keeps a vacant seat blank (no staff) rather than reproducing shifts on it (SPEC.md T1)', () => {
    const rows = buildRosterRows(seedStaff, roomHistory, WEEK);
    const vacantRow = rows.find((r) => r.kind === 'vacant');
    expect(vacantRow).toBeDefined();
    expect(vacantRow!.kind).toBe('vacant');
  });

  it('T4: a new person fills the vacant seat instead of adding a row', () => {
    const withNewHire: Staff[] = [...seedStaff, staff({ id: 'newhire', name: 'X', sortOrder: 1020 })];
    const historyWithNewHire: RoomHistoryEntry[] = [
      ...roomHistory,
      { staffId: 'newhire', roomId: 'toddlers', fromWeek: WEEK, toWeek: null },
    ];
    const rows = buildRosterRows(withNewHire, historyWithNewHire, WEEK);
    const kinds = rows.map((r) => (r.kind === 'staff' ? r.staff.id : r.kind));
    expect(kinds).toContain('newhire');
    expect(kinds.filter((k) => k === 'vacant')).toHaveLength(0);
    // Same row count as before — the new hire filled row 3, no row was added.
    expect(rows).toHaveLength(17);
  });

  it('T5/T6: a 4th person in Preschoolers overflows the room (extra row, no vacancy elsewhere)', () => {
    const withFourth: Staff[] = [...seedStaff, staff({ id: 'fourth', name: 'Y', sortOrder: 2040 })];
    const historyWithFourth: RoomHistoryEntry[] = [
      ...roomHistory,
      { staffId: 'fourth', roomId: 'preschoolers', fromWeek: EPOCH, toWeek: null },
    ];
    const rows = buildRosterRows(withFourth, historyWithFourth, WEEK);
    const preschoolersOccupants = rows.filter(
      (r) => r.kind === 'staff' && ['manuel', 'irene', 'deoshree', 'fourth'].includes(r.staff.id),
    );
    expect(preschoolersOccupants).toHaveLength(4);
  });

  it("a transfer applies from its effective week onward, leaving the old room's seat vacant (T5)", () => {
    const historyAfterTransfer: RoomHistoryEntry[] = roomHistory.map((h) =>
      h.staffId === 'usha' ? { ...h, toWeek: '2026-10-05' } : h,
    );
    historyAfterTransfer.push({ staffId: 'usha', roomId: 'toddlers', fromWeek: '2026-10-05', toWeek: null });

    // Before the transfer: Usha still in ECEC2, Toddlers still has its
    // one long-standing vacancy.
    expect(roomIdForStaffAtWeek(historyAfterTransfer, 'usha', '2026-09-21')).toBe('ecec2');
    const before = buildRosterRows(seedStaff, historyAfterTransfer, '2026-09-21');
    expect(before.filter((r) => r.kind === 'vacant')).toHaveLength(1); // Toddlers only

    // From the effective week: Usha shows under Toddlers, ECEC2 now has a vacancy.
    expect(roomIdForStaffAtWeek(historyAfterTransfer, 'usha', '2026-10-05')).toBe('toddlers');
    const after = buildRosterRows(seedStaff, historyAfterTransfer, '2026-10-05');
    const vacantRoomIds = after.filter((r) => r.kind === 'vacant').map((r) => (r as any).roomId);
    expect(vacantRoomIds).toEqual(['ecec2']); // Toddlers now full (Hanny + Usha), ECEC2 short one
  });
});
