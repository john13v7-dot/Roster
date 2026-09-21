// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Turns the staff + vacant-seat lists into the printed row order (SPEC.md
// §7 "Row numbering"): Sue, room blocks in room order, 2 spare blank rows,
// then long-term-leave/floater rows in their own sort order. Row numbers
// are recomputed from this order every time — they are positions, not IDs.

import { roomBlockSortOrderCeiling, spareRowCount } from '../config/creche.config';
import type { Staff, VacantSeat } from './types';

export type RosterRow =
  | { kind: 'staff'; key: string; rowNumber: number | null; staff: Staff }
  | { kind: 'vacant'; key: string; rowNumber: number | null; seat: VacantSeat }
  | { kind: 'spacer'; key: string; rowNumber: number | null };

export function buildRosterRows(staff: Staff[], vacantSeats: VacantSeat[]): RosterRow[] {
  type Sortable = { sortOrder: number; row: RosterRow };

  const sortable: Sortable[] = [
    ...staff.map((s) => ({
      sortOrder: s.sortOrder,
      row: { kind: 'staff', key: `staff:${s.id}`, rowNumber: null, staff: s } as RosterRow,
    })),
    ...vacantSeats.map((v) => ({
      sortOrder: v.sortOrder,
      row: { kind: 'vacant', key: `vacant:${v.id}`, rowNumber: null, seat: v } as RosterRow,
    })),
  ];

  sortable.sort((a, b) => a.sortOrder - b.sortOrder);

  const lastRoomBlockIndex = sortable.reduce(
    (last, entry, index) => (entry.sortOrder < roomBlockSortOrderCeiling ? index : last),
    -1,
  );

  const rows: RosterRow[] = [];
  sortable.forEach((entry, index) => {
    rows.push(entry.row);
    if (index === lastRoomBlockIndex) {
      for (let i = 0; i < spareRowCount; i++) {
        rows.push({ kind: 'spacer', key: `spacer:${i}`, rowNumber: null });
      }
    }
  });

  // Every row gets a number (including a vacant seat and a blank spare row)
  // except a staff row explicitly flagged numbered:false, e.g. a
  // long-term-leave row (SPEC.md §16 "n/a").
  let nextNumber = 1;
  return rows.map((row) => {
    const numbered = row.kind === 'staff' ? row.staff.numbered : true;
    if (!numbered) return row;
    return { ...row, rowNumber: nextNumber++ };
  });
}
