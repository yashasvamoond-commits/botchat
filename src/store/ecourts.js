/**
 * eCourts memory.
 *
 * The user shares an eCourts "Case Status" dump once as a .txt file; we parse
 * every case out of it and keep it in SQLite, so it is remembered across
 * restarts and sessions without asking for the file again.
 *
 * The parsing itself lives in ../ingest/ecourts-parse.js (pure, browser-safe);
 * this module adds the SQLite persistence, the archive folder and the queries.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from '../config.js';
import { normalize, collapse, clip } from '../util/text.js';
import {
  parseEcourtsText, looksLikeEcourts, splitBlocks,
} from '../ingest/ecourts-parse.js';

// Re-exported so existing imports keep working.
export { parseEcourtsText, looksLikeEcourts, splitBlocks };

function caseId(owner, record) {
  const basis = record.cnr || `${record.case_number || ''}|${record.title || ''}`;
  return `E${crypto.createHash('sha1').update(`${owner}|${normalize(basis)}`).digest('hex').slice(0, 10)}`;
}

/** Upsert parsed cases. Returns counts so the bot can report what changed. */
export function saveEcourtsCases(owner, records, { sourceFile = null } = {}) {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  const insert = db.prepare(`INSERT INTO ecourts_cases
    (id, owner, cnr, case_number, title, court, petitioner, respondent, status, stage,
     filing_date, next_hearing, last_hearing, acts, police_station, fir_number,
     source_file, raw, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const update = db.prepare(`UPDATE ecourts_cases SET
     cnr=?, case_number=?, title=?, court=?, petitioner=?, respondent=?, status=?, stage=?,
     filing_date=?, next_hearing=?, last_hearing=?, acts=?, police_station=?, fir_number=?,
     source_file=?, raw=?, updated_at=? WHERE id=? AND owner=?`);
  for (const record of records) {
    const id = caseId(owner, record);
    const existing = db.prepare('SELECT id FROM ecourts_cases WHERE id = ? AND owner = ?').get(id, owner);
    if (existing) {
      update.run(
        record.cnr, record.case_number, record.title, record.court, record.petitioner, record.respondent,
        record.status, record.stage, record.filing_date, record.next_hearing, record.last_hearing,
        record.acts, record.police_station, record.fir_number, sourceFile, record.raw, now, id, owner,
      );
      updated += 1;
    } else {
      insert.run(
        id, owner, record.cnr, record.case_number, record.title, record.court, record.petitioner, record.respondent,
        record.status, record.stage, record.filing_date, record.next_hearing, record.last_hearing,
        record.acts, record.police_station, record.fir_number, sourceFile, record.raw, now, now,
      );
      added += 1;
    }
  }
  return { added, updated, total: added + updated };
}

/** Keep the raw file next to the database so nothing is lost. */
export function archiveEcourtsFile(owner, filename, buffer) {
  const dir = path.join(config.dataDir, 'ecourts');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = String(filename || 'ecourts.txt').replace(/[^\w.\-\u0900-\u097F\u0600-\u06FF]+/g, '_').slice(-60);
  const target = path.join(dir, `${stamp}_${owner}_${safe.endsWith('.txt') ? safe : `${safe}.txt`}`);
  fs.writeFileSync(target, buffer);
  return target;
}

export function listEcourtsCases(owner, { query = '', limit = 25 } = {}) {
  const rows = db.prepare('SELECT * FROM ecourts_cases WHERE owner = ?').all(owner);
  const needle = normalize(query || '').trim();
  const filtered = needle
    ? rows.filter((row) => normalize(
        [row.cnr, row.case_number, row.title, row.court, row.petitioner, row.respondent, row.status, row.stage, row.acts]
          .filter(Boolean).join(' '),
      ).includes(needle))
    : rows;
  const withDate = filtered.filter((r) => r.next_hearing).sort((a, b) => a.next_hearing.localeCompare(b.next_hearing));
  const withoutDate = filtered.filter((r) => !r.next_hearing);
  return [...withDate, ...withoutDate].slice(0, limit);
}

export function findEcourtsCase(owner, needle) {
  const text = String(needle || '').trim();
  if (!text) return null;
  const upper = text.toUpperCase().replace(/\s+/g, '');
  const rows = db.prepare('SELECT * FROM ecourts_cases WHERE owner = ?').all(owner);
  const byCnr = rows.find((r) => r.cnr && (r.cnr === upper || r.cnr.replace(/\s+/g, '') === upper));
  if (byCnr) return byCnr;
  const n = normalize(text);
  return rows.find((r) => normalize([r.case_number, r.title, r.cnr].filter(Boolean).join(' ')).includes(n)) || null;
}

export function ecourtsSummary(owner) {
  const row = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN next_hearing IS NOT NULL THEN 1 ELSE 0 END) AS withHearing,
      MIN(CASE WHEN next_hearing >= date('now') THEN next_hearing END) AS nextDate
    FROM ecourts_cases WHERE owner = ?`).get(owner);
  return {
    total: Number(row?.total || 0),
    withHearing: Number(row?.withHearing || 0),
    nextDate: row?.nextDate || null,
  };
}

/** Upcoming hearings across the remembered eCourts data. */
export function upcomingHearings(owner, { from = new Date().toISOString().slice(0, 10), limit = 10 } = {}) {
  return db.prepare(`SELECT * FROM ecourts_cases
    WHERE owner = ? AND next_hearing IS NOT NULL AND next_hearing >= ?
    ORDER BY next_hearing ASC LIMIT ?`).all(owner, from, limit);
}

export function deleteEcourtsCase(owner, id) {
  return db.prepare('DELETE FROM ecourts_cases WHERE id = ? AND owner = ?').run(id, owner).changes > 0;
}
