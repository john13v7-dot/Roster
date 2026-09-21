// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import { buildRosterWorkbook } from '../rosterExcel';
import { buildRosterHtml } from '../rosterHtml';
import type { RosterRow } from '../../domain/rosterLayout';
import type { RosterEntry, Staff } from '../../domain/types';

const hanny: Staff = {
  id: 'hanny',
  name: 'Hanny',
  type: 'rotating',
  roomId: 'toddlers',
  payrollIncluded: true,
  activeFrom: null,
  activeTo: null,
  sortOrder: 1010,
  numbered: true,
};

const rows: RosterRow[] = [
  { kind: 'staff', key: 'staff:hanny', rowNumber: 1, staff: hanny },
  { kind: 'vacant', key: 'vacant:v1', rowNumber: 2, seat: { id: 'v1', roomId: 'toddlers', sortOrder: 1020 } },
];

const dates = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];

const entriesByKey: Record<string, RosterEntry> = {
  'hanny|2026-09-21': {
    weekStart: '2026-09-21',
    staffId: 'hanny',
    date: '2026-09-21',
    type: 'shift',
    patternCode: 'S1',
    start: '07:30',
    end: '16:30',
    unpaidLunchMinutes: 60,
    source: 'manual',
    note: null,
  },
  'hanny|2026-09-22': {
    weekStart: '2026-09-21',
    staffId: 'hanny',
    date: '2026-09-22',
    type: 'holiday',
    patternCode: null,
    start: null,
    end: null,
    unpaidLunchMinutes: 0,
    source: 'manual',
    note: null,
  },
};

describe('buildRosterWorkbook', () => {
  it('writes the title, date range and row content matching the on-screen text', async () => {
    const workbook = buildRosterWorkbook(rows, dates, entriesByKey, '2026-09-21');
    const sheet = workbook.getWorksheet('Roster')!;

    expect(sheet.getCell('A1').value).toBe('STAFF ROSTER');
    expect(sheet.getCell('A2').value).toBe('21st – 25th September 2026');

    // Row 1: title, Row 2: date, Row 3: spacer, Row 4: Hanny, Row 5: vacant.
    const hannyRow = sheet.getRow(4);
    expect(hannyRow.getCell(1).value).toBe(1); // No.
    expect(hannyRow.getCell(2).value).toBe('Hanny');
    expect(hannyRow.getCell(3).value).toBe('7:30 – 4:30'); // Mon
    expect(hannyRow.getCell(4).value).toBe('Holiday'); // Tue
    expect(hannyRow.getCell(8).value).toBe('10 MINS'); // Break

    const vacantRow = sheet.getRow(5);
    expect(vacantRow.getCell(2).value).toBe(''); // blank name, never a shift (T1)
    expect(vacantRow.getCell(3).value).toBe('');

    // Excel export can be produced without throwing.
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

describe('buildRosterHtml', () => {
  it('renders the same title/date/cell text as the Excel export', () => {
    const html = buildRosterHtml(rows, dates, entriesByKey, '2026-09-21');
    expect(html).toContain('STAFF ROSTER');
    expect(html).toContain('21st – 25th September 2026');
    expect(html).toContain('7:30 – 4:30');
    expect(html).toContain('Holiday');
    expect(html).toContain('10 MINS');
  });
});
