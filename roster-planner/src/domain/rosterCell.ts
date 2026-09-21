// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// The text shown for a roster cell — shared by the on-screen table, the
// Excel export and the PDF export, so all three always agree (SPEC.md §2
// "PDF and Excel show identical content and layout").

import { formatTimeRange } from './week';
import type { RosterEntry } from './types';

export type RosterCellStatus = 'holiday' | 'maternity' | 'off' | null;

export interface RosterCellContent {
  text: string;
  status: RosterCellStatus;
}

export function rosterCellContent(entry: RosterEntry | undefined): RosterCellContent {
  if (!entry) return { text: '', status: null };
  switch (entry.type) {
    case 'holiday':
      return { text: 'Holiday', status: 'holiday' };
    case 'maternity':
      return { text: 'Maternity Leave', status: 'maternity' };
    case 'off':
      return { text: 'OFF', status: 'off' };
    case 'blank':
      return { text: '', status: null };
    case 'shift':
      if (!entry.start || !entry.end) return { text: '', status: null };
      return { text: formatTimeRange(entry.start, entry.end), status: null };
    default:
      return { text: '', status: null };
  }
}
