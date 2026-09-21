// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Every creche-specific fact — room names, floors, seat counts, shift
// patterns, cover numbers, the duty list — lives in this one file
// (SPEC.md §0). Nothing else in the app should hard-code these, so a
// second creche can be set up by replacing this file (or, later, through
// the first-run setup screen in SPEC.md §21).

export type FloorId = 'ground' | 'first';

export interface RoomConfig {
  id: string;
  name: string;
  floor: FloorId;
  seats: number;
  sortOrder: number;
}

/** Floors and rooms (SPEC.md §5 "Floors and rooms"). */
export const rooms: RoomConfig[] = [
  { id: 'toddlers', name: 'Toddlers', floor: 'ground', seats: 2, sortOrder: 1 },
  { id: 'preschoolers', name: 'Preschoolers', floor: 'ground', seats: 3, sortOrder: 2 },
  { id: 'ecec1', name: 'ECEC 1', floor: 'first', seats: 3, sortOrder: 3 },
  // Jason (paired management) also belongs here but is not one of the
  // room's own seats — he is a fixed extra on this room/floor.
  { id: 'ecec2', name: 'ECEC 2', floor: 'first', seats: 2, sortOrder: 4 },
];

export type ShiftPatternCode = 'S1' | 'S2' | 'S3' | 'S4';

export interface ShiftPatternConfig {
  code: ShiftPatternCode;
  start: string; // 24h "HH:mm"
  end: string; // 24h "HH:mm"
  unpaidLunchMinutes: number;
}

/** The 4 shift patterns, 9-hour span, 8 paid + 1 unpaid lunch (SPEC.md §5). */
export const shiftPatterns: ShiftPatternConfig[] = [
  { code: 'S1', start: '07:30', end: '16:30', unpaidLunchMinutes: 60 },
  { code: 'S2', start: '08:00', end: '17:00', unpaidLunchMinutes: 60 },
  { code: 'S3', start: '08:30', end: '17:30', unpaidLunchMinutes: 60 },
  { code: 'S4', start: '09:00', end: '18:00', unpaidLunchMinutes: 60 },
];

/** Paid, on-shift break shown in the Break column (SPEC.md §9), info only. */
export const breakLabel = '10 MINS';

/** Opening / closing cover requirements (SPEC.md §5, R1/R2). */
export const coverRules = {
  openingTime: '07:30',
  closingTime: '18:00',
  /** Minimum people starting at openingTime, including one of pairedManagementStaffIds. */
  minOpeningCover: 3,
  /** Minimum people finishing at closingTime, including one of pairedManagementStaffIds
   *  (or the fallback manager if neither paired-management person closes). */
  minClosingCover: 3,
  /** Minimum room staff (excluding paired management/manager) within the cover count. */
  minRoomStaffInCover: 2,
} as const;

/** R4 floor-balance defaults (SPEC.md §5, confirm item §18.1). */
export const floorBalanceRules = {
  /** Red: a floor has zero staff at opening or closing. */
  redOnZeroFloorAtOpenOrClose: true,
  /** Amber: within a shift pattern, floor headcounts differ by more than this. */
  maxFloorImbalancePerShift: 1,
} as const;

/** R9/R10 fairness tuning (SPEC.md §6 "Weights are configurable in Settings"). */
export const fairnessWeights: Record<ShiftPatternCode, number> = {
  S1: 1,
  S2: 1,
  S3: 1,
  S4: 1,
};

/** The fixed duty list, in print order (SPEC.md §10). */
export interface DutyConfig {
  id: string;
  name: string;
  sortOrder: number;
  defaultText?: string;
}

export const duties: DutyConfig[] = [
  { id: 'cot-room', name: 'Cot Room', sortOrder: 1, defaultText: 'Staff working in the room' },
  { id: 'changing-area', name: 'Changing Area', sortOrder: 2, defaultText: 'Staff working in the room' },
  { id: 'hallway-upstairs', name: 'Hallway upstairs / Hover stairs upstairs', sortOrder: 3 },
  { id: 'childrens-toilets', name: "Children's Toilets", sortOrder: 4 },
  { id: 'staff-toilet-upstairs', name: 'Staff Toilet upstairs', sortOrder: 5 },
  { id: 'kitchen', name: 'Kitchen', sortOrder: 6 },
  { id: 'staff-room', name: 'Staff Room', sortOrder: 7 },
  { id: 'hallway-downstairs', name: 'Hallway downstairs / windows / door handles', sortOrder: 8 },
  { id: 'staff-toilet', name: 'Staff Toilet', sortOrder: 9 },
  { id: 'back-garden', name: 'Back Garden', sortOrder: 10 },
  { id: 'bins', name: 'Bins', sortOrder: 11 },
  { id: 'front-creche', name: 'Front creche', sortOrder: 12 },
  { id: 'paper-soap', name: 'Paper and Soap dispensers', sortOrder: 13 },
  { id: 'spare', name: 'Spare', sortOrder: 14 },
  { id: 'dusting', name: 'Dusting (check if we had spider webs)', sortOrder: 15 },
  {
    id: 'laundry',
    name: 'Laundry (laundry to be done in the morning and the last one at 2pm)',
    sortOrder: 16,
  },
];

export const timezone = 'Europe/Dublin';

/** Blank spacer rows printed right after the last room block (SPEC.md §7 "Row numbering"). */
export const spareRowCount = 2;

/**
 * Staff/vacant-seat rows with sortOrder below this print in the room
 * blocks (Toddlers..ECEC2); the spare rows are inserted right after the
 * last of them. Rows at or above it (long-term leave, Megan, Jason,
 * Shehnaz, Priscilla, Laura) print after the spare rows, in their own
 * sortOrder — even when, like Jason, they also carry a roomId for
 * floor-cover purposes (SPEC.md §5, §7).
 */
export const roomBlockSortOrderCeiling = 5000;
