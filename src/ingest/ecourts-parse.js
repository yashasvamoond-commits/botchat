/**
 * Pure eCourts parsing — no database, no filesystem.
 *
 * Kept separate from the SQLite store so the same parser can run in the
 * browser (the downloadable single-file app) and in the server.
 */

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
