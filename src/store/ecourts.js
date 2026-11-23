/**
 * eCourts memory.
 *
 * The user shares an eCourts "Case Status" dump once as a .txt file; we parse
 * every case out of it and keep it in SQLite, so it is remembered across
 * restarts and sessions without asking for the file again.
 *
 * The parser is deliberately tolerant: it accepts the copied text from the
 * eCourts website (English), the Hindi version, the Urdu version, and the
 * tab / pipe separated shape that some exports use.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from '../config.js';
import { normalize, collapse, clip } from '../util/text.js';
import { parseDate } from '../util/dates.js';

const FIELD_LABELS = [
  { key: 'cnr', re: /^(?:cnr\s*(?:number|no\.?)?|सी\s*एन\s*आर(?:\s*संख्या)?|سی\s*این\s*آر(?:\s*نمبر)?)$/i },
  { key: 'case_number', re: /^(?:case\s*(?:number|no\.?)|case\s*no|द्वारा\s*संख्या|वाद\s*संख्या|मुकदमा\s*संख्या|केस\s*संख्या|مقدمہ\s*نمبر|کیس\s*نمبر|درخواست\s*نمبر)$/i },
  { key: 'petitioner', re: /^(?:petitioner(?:\(?s\)?)?|complainant(?:\(?s\)?)?|plaintiff(?:\(?s\)?)?|appellant(?:\(?s\)?)?|याचिकाकर्ता|वादी|शिकायतकर्ता|مدعی|درخواست\s*دہندہ)$/i },
  { key: 'respondent', re: /^(?:respondent(?:\(?s\)?)?|defendant(?:\(?s\)?)?|opposite\s*party|प्रतिवादी|विरोधी\s*पक्ष|مدعا\s*علیہ|مخالف\s*فریق)$/i },
  { key: 'court', re: /^(?:court(?:\s*name)?|न्यायालय|अदालत|عدالت)$/i },
  { key: 'status', re: /^(?:case\s*status|status|स्थिति|हालत|کیس\s*کی\s*حیثیت|حیثیت|صورت\s*حال)$/i },
  { key: 'stage', re: /^(?:stage(?:\s*of\s*case)?|चरण|अवस्था|مرحلہ|اسٹیج)$/i },
  { key: 'filing_date', re: /^(?:filing\s*date|date\s*of\s*filing|दाखिल\s*करने\s*की\s*तारीख|फाइलिंग\s*तारीख|دائر\s*کرنے\s*کی\s*تاریخ)$/i },
  { key: 'next_hearing', re: /^(?:next\s*hearing(?:\s*date)?|next\s*date|date\s*of\s*next\s*hearing|अगली\s*सुनवाई(?:\s*की\s*तारीख)?|अगली\s*तारीख|اگلی\s*سماعت(?:\s*کی\s*تاریخ)?)$/i },
  { key: 'last_hearing', re: /^(?:last\s*hearing(?:\s*date)?|previous\s*hearing|पिछली\s*सुनवाई|پچھلی\s*سماعت)$/i },
  { key: 'acts', re: /^(?:acts?|sections?|under\s*act(?:\(?s\)?)?|धारा(?:एं)?|अधिनियम|دفعہ|دفعات|ایکٹ)$/i },
  { key: 'police_station', re: /^(?:police\s*station|ps|थाना|تھانہ)$/i },
  { key: 'fir_number', re: /^(?:fir\s*(?:number|no\.?)?|एफ\s*आई\s*आर(?:\s*संख्या)?|ایف\s*آئی\s*آر)$/i },
];

const SEPARATOR = /\s*(?::|：|\||\t|\s-\s|=)\s*/;
const CNR_RE = /\b([A-Z]{2}[A-Z0-9]{2}\d{12,16}|\d{16})\b/;

function cleanValue(value) {
  const out = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/^[\s:：|\-–—]+/, '')
    .replace(/[\s|]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function labelKey(label) {
  const l = normalize(label)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.:()\[\]|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const entry of FIELD_LABELS) if (entry.re.test(l)) return entry.key;
  return null;
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = parseDate(value);
  return parsed?.iso || null;
}

/**
 * Split the dump into blocks, one per case.
 * A new block starts at every CNR line; if the file has no CNR at all we split
 * on blank-line groups that contain a case-number line.
 */
export function splitBlocks(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const lines = clean.split('\n');
  const blocks = [];
  let current = [];
  let seenCaseLabel = false;
  const push = () => {
    if (current.some((l) => l.trim())) blocks.push(current.join('\n'));
    current = [];
  };
  const hasCnr = /\b[A-Z]{2}[A-Z0-9]{2}\d{12,16}\b/i.test(clean);
  for (const line of lines) {
    const isCnrLine = /cnr|सी\s*एन\s*आर|سی\s*این\s*آر/i.test(line) && CNR_RE.test(line);
    const isCaseNoLine = /^(?:case\s*(?:number|no)|वाद\s*संख्या|मुकदमा\s*संख्या|مقدمہ\s*نمبر|کیس\s*نمبر)/i.test(line.trim());
    if (hasCnr) {
      if (isCnrLine && (seenCaseLabel || current.length > 3)) { push(); seenCaseLabel = false; }
      if (isCnrLine) seenCaseLabel = true;
      current.push(line);
    } else {
      if (isCaseNoLine && seenCaseLabel) { push(); seenCaseLabel = false; }
      if (isCaseNoLine) seenCaseLabel = true;
      current.push(line);
    }
  }
  push();
  return blocks;
}

/** Parse a label/value block into a plain object. */
function parseBlock(block) {
  const record = {};
  const extraLines = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = SEPARATOR.exec(line);
    if (!sep) { extraLines.push(line); continue; }
    const label = line.slice(0, sep.index).trim();
    const value = cleanValue(line.slice(sep.index + sep[0].length));
    const key = labelKey(label);
    if (key && value) {
      record[key] = record[key] ? `${record[key]}, ${value}` : value;
    } else if (!key) {
      extraLines.push(line);
    }
  }

  // Fall back to a body scan when the dump is a run-on paragraph.
  const body = block;
  const cnr = record.cnr || (CNR_RE.exec(body)?.[1] ?? null);
  if (cnr) record.cnr = String(cnr).toUpperCase().replace(/\s+/g, '');

  record.filing_date = isoOrNull(record.filing_date);
  record.next_hearing = isoOrNull(record.next_hearing);
  record.last_hearing = isoOrNull(record.last_hearing);

  record.cnr = record.cnr || null;
  record.case_number = record.case_number || null;
  record.court = record.court || null;
  record.petitioner = record.petitioner || null;
  record.respondent = record.respondent || null;
  record.status = record.status || null;
  record.stage = record.stage || null;
  record.acts = record.acts || null;
  record.police_station = record.police_station || null;
  record.fir_number = record.fir_number || null;

  if (!record.title) {
    const parties = [record.petitioner, record.respondent].filter(Boolean);
    if (parties.length === 2) record.title = `${parties[0]} v ${parties[1]}`;
    else if (parties.length === 1) record.title = parties[0];
    else if (record.case_number) record.title = `Case ${record.case_number}`;
  }
  record.raw = clip(block.trim(), 4000);
  record.extra = extraLines.slice(0, 8).join(' · ');
  const meaningful = record.cnr || record.case_number || record.petitioner || record.respondent || record.title;
  return meaningful ? record : null;
}

/** Parse a whole eCourts .txt dump into case records. */
export function parseEcourtsText(text) {
  const batches = Array.isArray(text) ? text : [text];
  const out = [];
  const seen = new Set();
  for (const batch of batches) {
    for (const block of splitBlocks(batch)) {
      const record = parseBlock(block);
      if (!record) continue;
      const key = record.cnr || normalize(`${record.case_number || ''}|${record.title || ''}`);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

/** Is this file an eCourts dump rather than an ordinary document? */
export function looksLikeEcourts(filename = '', text = '') {
  const name = String(filename || '').toLowerCase();
  const body = String(text || '');
  if (/ecourt|court-?status|case-?status/.test(name)) return true;
  const hits = [
    /cnr\s*(?:number|no)/i,
    /e-?courts?/i,
    /case\s*status/i,
    /next\s*hearing\s*date/i,
    /सी\s*एन\s*आर/,
    /अगली\s*सुनवाई/,
    /سی\s*این\s*آر/,
    /اگلی\s*سماعت/,
  ].filter((re) => re.test(body)).length;
  return hits >= 2;
}

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
