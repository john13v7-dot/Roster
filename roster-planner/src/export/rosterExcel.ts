// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Builds the roster .xlsx workbook (SPEC.md §9). Column layout: No. | Name |
// Mon | Tue | Wed | Thu | Fri | Break | (blank notes). No day-heading row by
// default, matching /reference.

import ExcelJS from 'exceljs';
import { breakLabel } from '../config/creche.config';
import { statusColors } from '../config/theme';
import { rosterCellContent } from '../domain/rosterCell';
import type { RosterRow } from '../domain/rosterLayout';
import { formatWeekRange } from '../domain/week';
import type { RosterEntry } from '../domain/types';

const COLUMN_COUNT = 9; // No, Name, Mon-Fri, Break, Notes
const solidFill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const statusFill: Record<'holiday' | 'maternity' | 'off', ExcelJS.Fill> = {
  holiday: solidFill(hex(statusColors.holiday)),
  maternity: solidFill(hex(statusColors.maternityLeave)),
  off: solidFill(hex(statusColors.off)),
};
const statusFontColor: Partial<Record<'holiday' | 'maternity' | 'off', string>> = {
  holiday: 'FFFFFFFF',
  maternity: 'FFFFFFFF',
};

function hex(cssHex: string): string {
  return `FF${cssHex.replace('#', '').toUpperCase()}`;
}

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

export function buildRosterWorkbook(
  rows: RosterRow[],
  dates: string[],
  entriesByKey: Record<string, RosterEntry>,
  weekStart: string,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 },
  });

  sheet.columns = [
    { width: 5 }, // No.
    { width: 20 }, // Name
    { width: 13 }, // Mon
    { width: 13 }, // Tue
    { width: 13 }, // Wed
    { width: 13 }, // Thu
    { width: 13 }, // Fri
    { width: 10 }, // Break
    { width: 16 }, // Notes
  ];

  const titleRow = sheet.addRow(['STAFF ROSTER']);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, COLUMN_COUNT);
  titleRow.getCell(1).font = { name: 'Times New Roman', size: 20, bold: true, color: { argb: 'FFE53E3E' } };
  titleRow.getCell(1).alignment = { horizontal: 'left' };
  titleRow.height = 28;

  const dateRow = sheet.addRow([formatWeekRange(weekStart)]);
  sheet.mergeCells(dateRow.number, 1, dateRow.number, COLUMN_COUNT);
  dateRow.getCell(1).font = { name: 'Times New Roman', size: 13, bold: true };

  sheet.addRow([]); // spacer row, matching /reference

  for (const row of rows) {
    const name = row.kind === 'staff' ? row.staff.name : '';
    const cellsText = dates.map((date) => {
      const staffId = row.kind === 'staff' ? row.staff.id : null;
      const entry = staffId ? entriesByKey[`${staffId}|${date}`] : undefined;
      return rosterCellContent(entry).text;
    });
    const hasBreak = row.kind === 'staff' || row.kind === 'vacant';
    const values = [row.rowNumber ?? '', name, ...cellsText, hasBreak ? breakLabel : '', ''];
    const sheetRow = sheet.addRow(values);
    sheetRow.height = 20;

    for (let col = 1; col <= COLUMN_COUNT; col++) {
      const cell = sheetRow.getCell(col);
      cell.border = thinBorder;
      cell.alignment = { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' };
    }

    dates.forEach((date, i) => {
      const staffId = row.kind === 'staff' ? row.staff.id : null;
      const entry = staffId ? entriesByKey[`${staffId}|${date}`] : undefined;
      const { status } = rosterCellContent(entry);
      if (!status) return;
      const cell = sheetRow.getCell(3 + i);
      cell.fill = statusFill[status];
      const fontColor = statusFontColor[status];
      if (fontColor) cell.font = { color: { argb: fontColor }, bold: true };
    });
  }

  return workbook;
}
