// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// Wires the Roster screen's Export Excel / Export PDF buttons: build the
// file, warn that it contains staff names, then hand it to the system
// share sheet (SPEC.md §9).

import { Alert } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import type { RosterRow } from '../domain/rosterLayout';
import type { RosterEntry } from '../domain/types';
import { buildRosterWorkbook } from './rosterExcel';
import { buildRosterHtml } from './rosterHtml';

const SHARE_WARNING = 'This file contains staff names. Share it carefully.';

function confirmShare(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Before you share', SHARE_WARNING, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]);
  });
}

async function shareAndCleanUp(file: File, mimeType: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Sharing unavailable', 'This device cannot open the share sheet.');
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: file.name });
  // The share sheet hands the file off asynchronously (especially on
  // Android), so we don't delete it the instant shareAsync returns —
  // instead each export overwrites/replaces its own previous temp file
  // (see exportRosterToExcel/Pdf below), so nothing accumulates.
}

function exportsDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export async function exportRosterToExcel(
  rows: RosterRow[],
  dates: string[],
  entriesByKey: Record<string, RosterEntry>,
  weekStart: string,
): Promise<void> {
  const proceed = await confirmShare();
  if (!proceed) return;

  const workbook = buildRosterWorkbook(rows, dates, entriesByKey, weekStart);
  const buffer = await workbook.xlsx.writeBuffer();

  const file = new File(exportsDirectory(), `Roster_${weekStart}.xlsx`);
  if (file.exists) file.delete();
  file.write(new Uint8Array(buffer as unknown as ArrayBufferLike));

  await shareAndCleanUp(
    file,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export async function exportRosterToPdf(
  rows: RosterRow[],
  dates: string[],
  entriesByKey: Record<string, RosterEntry>,
  weekStart: string,
): Promise<void> {
  const proceed = await confirmShare();
  if (!proceed) return;

  const html = buildRosterHtml(rows, dates, entriesByKey, weekStart);
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  const file = new File(exportsDirectory(), `Roster_${weekStart}.pdf`);
  if (file.exists) file.delete();
  await new File(uri).copy(file);

  await shareAndCleanUp(file, 'application/pdf');
}
