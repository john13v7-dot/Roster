// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { buildRosterRows } from '../rosterLayout';
import type { Staff, VacantSeat } from '../types';

function staff(overrides: Partial<Staff> & Pick<Staff, 'id' | 'name' | 'sortOrder'>): Staff {
  return {
    type: 'rotating',
    roomId: null,
    payrollIncluded: true,
    activeFrom: null,
    activeTo: null,
    numbered: true,
    ...overrides,
  };
}

describe('buildRosterRows', () => {
  const seedStaff: Staff[] = [
    staff({ id: 'sue', name: 'Sue', type: 'static', sortOrder: 100 }),
    staff({ id: 'hanny', name: 'Hanny', roomId: 'toddlers', sortOrder: 1010 }),
    staff({ id: 'manuel', name: 'Manuel', roomId: 'preschoolers', sortOrder: 2010 }),
    staff({ id: 'usha', name: 'Usha', roomId: 'ecec2', sortOrder: 4020 }),
    staff({ id: 'eirini', name: 'Eirini', sortOrder: 6010, numbered: false }),
    staff({ id: 'megan', name: 'Megan', type: 'static', sortOrder: 7010 }),
    staff({ id: 'jason', name: 'Jason', type: 'paired_management', roomId: 'ecec2', sortOrder: 7020 }),
    staff({ id: 'laura', name: 'Laura', type: 'static', sortOrder: 7050 }),
  ];
  const seedVacant: VacantSeat[] = [{ id: 'v1', roomId: 'toddlers', sortOrder: 1020 }];

  it('orders Sue, room blocks, then 2 spare rows, then the trailing group (SPEC.md §7)', () => {
    const rows = buildRosterRows(seedStaff, seedVacant);
    const kinds = rows.map((r) => (r.kind === 'staff' ? r.staff.id : r.kind));
    expect(kinds).toEqual([
      'sue',
      'hanny',
      'vacant',
      'manuel',
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
    const rows = buildRosterRows(seedStaff, seedVacant);
    const numbers = rows.map((r) => r.rowNumber);
    // sue,hanny,vacant,manuel,usha,spacer,spacer,eirini,megan,jason,laura
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, null, 8, 9, 10]);
  });

  it('keeps a vacant seat blank (no staff) rather than reproducing shifts on it (SPEC.md T1)', () => {
    const rows = buildRosterRows(seedStaff, seedVacant);
    const vacantRow = rows.find((r) => r.kind === 'vacant');
    expect(vacantRow).toBeDefined();
    expect(vacantRow!.kind).toBe('vacant');
  });
});
