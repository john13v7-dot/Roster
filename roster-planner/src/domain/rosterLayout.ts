// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Turns staff + room history into the printed row order for a given week
// (SPEC.md §7 "Row numbering"): Sue, room blocks in room order (with a
// blank row for any seat the room's current occupants don't fill), 2
// spare blank rows, then the trailing group (long-term leave, Megan,
// Jason, Shehnaz, Priscilla, Laura) in their own sort order.
//
// A room's occupants and vacancies are computed for the requested week
// from room_history, not stored — that's what makes Add Staff "fill the
// vacant seat first" and a Transfer leave a vacancy behind for free
// (SPEC.md §7, tests T4-T6).

import { roomBlockSortOrderCeiling, rooms as roomConfigs, spareRowCount } from '../config/creche.config';
import type { RoomHistoryEntry, Staff } from './types';

export type RosterRow =
  | { kind: 'staff'; key: string; rowNumber: number | null; staff: Staff }
  | { kind: 'vacant'; key: string; rowNumber: number | null; roomId: string }
  | { kind: 'spacer'; key: string; rowNumber: number | null };

function isStaffActiveAtWeek(staff: Staff, weekStart: string): boolean {
  if (staff.activeFrom && weekStart < staff.activeFrom) return false;
  if (staff.activeTo && weekStart > staff.activeTo) return false;
  return true;
}

function roomHistoryCovers(entry: RoomHistoryEntry, weekStart: string): boolean {
  if (weekStart < entry.fromWeek) return false;
  if (entry.toWeek !== null && weekStart >= entry.toWeek) return false;
  return true;
}

/** This person's room for the given week, or null if roomless that week. */
export function roomIdForStaffAtWeek(
  roomHistory: RoomHistoryEntry[],
  staffId: string,
  weekStart: string,
): string | null {
  const entry = roomHistory.find((h) => h.staffId === staffId && roomHistoryCovers(h, weekStart));
  return entry?.roomId ?? null;
}

export function buildRosterRows(
  staff: Staff[],
  roomHistory: RoomHistoryEntry[],
  weekStart: string,
): RosterRow[] {
  const active = staff.filter((s) => isStaffActiveAtWeek(s, weekStart));

  const roomOf = new Map<string, { roomId: string; fromWeek: string }>();
  for (const s of active) {
    const entry = roomHistory.find((h) => h.staffId === s.id && roomHistoryCovers(h, weekStart));
    if (entry) roomOf.set(s.id, { roomId: entry.roomId, fromWeek: entry.fromWeek });
  }

  const roomless = active.filter((s) => !roomOf.has(s.id));
  const lead = roomless.filter((s) => s.sortOrder < roomBlockSortOrderCeiling).sort(byLayoutOrder);
  const trailing = roomless.filter((s) => s.sortOrder >= roomBlockSortOrderCeiling).sort(byLayoutOrder);

  const rows: RosterRow[] = lead.map((s) => staffRow(s));

  for (const room of [...roomConfigs].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const occupants = active
      .filter((s) => roomOf.get(s.id)?.roomId === room.id)
      .sort((a, b) => {
        const fromA = roomOf.get(a.id)!.fromWeek;
        const fromB = roomOf.get(b.id)!.fromWeek;
        if (fromA !== fromB) return fromA < fromB ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });

    rows.push(...occupants.map((s) => staffRow(s)));

    const vacancyCount = Math.max(0, room.seats - occupants.length);
    for (let i = 0; i < vacancyCount; i++) {
      rows.push({ kind: 'vacant', key: `vacant:${room.id}:${i}`, rowNumber: null, roomId: room.id });
    }
  }

  for (let i = 0; i < spareRowCount; i++) {
    rows.push({ kind: 'spacer', key: `spacer:${i}`, rowNumber: null });
  }

  rows.push(...trailing.map((s) => staffRow(s)));

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

function staffRow(staff: Staff): RosterRow {
  return { kind: 'staff', key: `staff:${staff.id}`, rowNumber: null, staff };
}

function byLayoutOrder(a: Staff, b: Staff): number {
  return a.sortOrder - b.sortOrder;
}
