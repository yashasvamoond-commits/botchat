/**
 * Turn an uploaded eCourts .txt dump into permanent memory.
 *
 * Shared by the WhatsApp/webhook path and the dashboard upload endpoint, so a
 * file sent from a phone and a file uploaded from a laptop behave the same.
 */

import path from 'node:path';
import {
  looksLikeEcourts, parseEcourtsText, saveEcourtsCases, archiveEcourtsFile, ecourtsSummary,
} from '../store/ecourts.js';
import { formatDate } from '../util/dates.js';
import { plural } from '../util/text.js';

/** Decode a .txt buffer, tolerating UTF-8/UTF-16 and a BOM. */
export function decodeText(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.slice(2).toString('utf16le').replace(/^\uFEFF/, '');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.slice(2));
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

export function ecourtsImportMessage({ added, updated, records }) {
  const lines = [];
  const bits = [];
  if (added) bits.push(`${added} new`);
  if (updated) bits.push(`${updated} updated`);
  lines.push(`⚖️ eCourts data remembered — ${plural(records.length, 'case')}${bits.length ? ` (${bits.join(', ')})` : ''}.`);
  lines.push('_Saved on this machine for good — you will not need to send this file again._');
  const upcoming = records
    .filter((r) => r.next_hearing)
    .sort((a, b) => a.next_hearing.localeCompare(b.next_hearing))
    .slice(0, 5);
  if (upcoming.length) {
    lines.push('', '*Next dates I can see*');
    for (const r of upcoming) {
      lines.push(`• ${formatDate(r.next_hearing, { long: true })} — ${r.title || r.case_number || r.cnr}`);
    }
  }
  lines.push('', 'Say `ecourts` to list every case, or `next hearing` for the diary.');
  return lines.join('\n');
}

/**
 * Import an eCourts dump if that is what this file is.
 * @returns {{handled: boolean, added?: number, updated?: number, records?: Array, message?: string}}
 */
export function importEcourtsUpload({ owner, buffer, filename = 'ecourts.txt' }) {
  const text = decodeText(buffer);
  if (!looksLikeEcourts(filename, text)) return { handled: false };
  const records = parseEcourtsText(text);
  if (!records.length) {
    return {
      handled: true,
      added: 0,
      updated: 0,
      records: [],
      message: '⚖️ That looks like an eCourts file, but I could not find a CNR or case number in it. '
        + 'Copy the case-status page as text (with the CNR line) and send it again.',
    };
  }
  let archive = null;
  try {
    archive = archiveEcourtsFile(owner, filename, buffer);
  } catch {
    archive = null;
  }
  const counts = saveEcourtsCases(owner, records, { sourceFile: archive ? path.basename(archive) : filename });
  return {
    handled: true,
    ...counts,
    records,
    archive,
    summary: ecourtsSummary(owner),
    message: ecourtsImportMessage({ ...counts, records }),
  };
}
