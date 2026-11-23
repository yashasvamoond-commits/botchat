/**
 * The document analyst. Pure functions: text in → structured intelligence out.
 * No AI key required. An optional LLM pass (see llm.js) improves the wording.
 */
import { classifyDocument } from './classify.js';
import { TYPE_BY_ID } from './taxonomy.js';
import {
  extractParties, extractAmounts, extractReferences, extractCourt, extractStatutes,
  extractIdentifiers, extractDeadlines, extractDocumentDate, detectLanguage, findBlanks, extractTenure,
} from './entities.js';
import { sentences, paragraphs, collapse, clip, normalize, titleCase } from '../util/text.js';
import { formatDate, toIso, daysBetween } from '../util/dates.js';

const KEY_POINT_HINTS = [
  /shall\s+(?:pay|refund|deliver|execute|comply|indemnify|vacate|provide)/i,
  /(?:rent|consideration|deposit|amount|salary|fee)\s+(?:of|is|is\s+fixed|shall\s+be)/i,
  /(?:terminat|revok|cancel)/i,
  /(?:notice\s+period|prior\s+written\s+notice)/i,
  /(?:jurisdiction|arbitration|dispute)/i,
  /(?:penalty|interest|damages|compensation)/i,
  /(?:validity|valid\s+for|period\s+of|commencing|effective\s+from)/i,
  /(?:due|payable|within\s+\d+\s+days)/i,
  /(?:confidential|non-?disclosure|exclusiv)/i,
  /(?:renew|extension|option)/i,
  /(?:signed|executed\s+at|witness)/i,
];

const CLAUSE_CATEGORIES = [
  { key: 'notice', pattern: /\b(?:notice|termination|terminate|terminable)\b/i, label: 'Notice & termination' },
  { key: 'term', pattern: /\b(?:terms?|tenure|period|duration|commencement|commencing)\b/i, label: 'Term' },
  { key: 'deposit', pattern: /\b(?:deposit|advance|security)\b/i, label: 'Security deposit' },
  { key: 'rent', pattern: /\b(?:rent|licen[cs]e\s+fee|consideration|salary|price|payment)\b/i, label: 'Payment' },
  { key: 'renewal', pattern: /\b(?:renewal|renew|extension)\b/i, label: 'Renewal' },
  { key: 'jurisdiction', pattern: /\b(?:jurisdiction|courts?\s+at)\b/i, label: 'Jurisdiction' },
  { key: 'arbitration', pattern: /\b(?:arbitration|arbitrator)\b/i, label: 'Arbitration' },
  { key: 'confidentiality', pattern: /\b(?:confidential|non-?disclosure|nda)\b/i, label: 'Confidentiality' },
  { key: 'indemnity', pattern: /\b(?:indemn\w*|liabilit\w*)\b/i, label: 'Indemnity & liability' },
  { key: 'maintenance', pattern: /\b(?:maintenance|repair|whitewash|society\s+charges|electricity|water)\b/i, label: 'Maintenance & utilities' },
  { key: 'possession', pattern: /\b(?:possession|handover|vacat\w*)\b/i, label: 'Possession' },
  { key: 'default', pattern: /\b(?:default|breach|penalt\w*|forfeit\w*)\b/i, label: 'Default & penalty' },
  { key: 'assignment', pattern: /\b(?:assign\w*|sublet|sub-?lease|transfer)\b/i, label: 'Assignment' },
  { key: 'governing', pattern: /\b(?:governing\s+law|entire\s+agreement|amendment|waiver)\b/i, label: 'General' },
];

function surname(name) {
  const cleaned = collapse(String(name || '').replace(/^(?:Mr|Mrs|Ms|Dr|Shri|Smt|Late|M\/s|Messrs)\.?\s+/i, ''))
    .replace(/\b(?:Private|Pvt)\b.*$/i, '')
    .replace(/\bLtd\.?$/i, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter((p) => p && !/^(?:son|daughter|wife|of|s\/o|d\/o|w\/o|r\/o)$/i.test(p));
  return parts.length ? parts[parts.length - 1] : '';
}

function partyNames(parties) {
  return parties.filter((p) => p.name && !/^(?:and|or)$/i.test(p.name));
}

function filenameHint(filename) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\b(?:final|copy|scan|scanned|signed|draft|new|whatsapp|img|image|document|doc|pdf|file)\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || base.length < 3) return '';
  return titleCase(base).slice(0, 70);
}

const NOTICE_TYPES = new Set(['legal_notice', 'cheque_bounce_notice', 'notice_reply', 'rent_notice']);

export function buildTitle({ typeLabel, docType = '', parties = [], docDate, caseNumber, reference, filename = '', originalName = '' }) {
  const strong = partyNames(parties).filter((p) => (p.strength ?? 3) >= 3);
  const named = strong.length ? strong : [];
  const addressee = named.find((p) => /addressee/i.test(p.role || ''));
  const order = addressee ? [addressee, ...named.filter((p) => p !== addressee)] : named;
  const first = order[0] ? surname(order[0].name) : '';
  const second = order[1] ? surname(order[1].name) : '';
  const year = docDate ? docDate.slice(0, 4) : '';
  const isNotice = NOTICE_TYPES.has(docType) || /notice/i.test(typeLabel);
  const hint = filenameHint(originalName || filename);

  let title = typeLabel;
  if (isNotice && first) {
    title = `${typeLabel} — to ${first}`;
  } else if (first && second && normalize(first) !== normalize(second)) {
    title = `${typeLabel} — ${first} v ${second}`;
  } else if (first) {
    title = `${typeLabel} — ${first}`;
  } else if (hint && normalize(hint).startsWith(normalize(typeLabel.split(/[\/(]/)[0]).split(' ')[0])) {
    title = hint;
  } else if (hint) {
    title = `${typeLabel} — ${hint}`;
  } else if (caseNumber || reference) {
    title = `${typeLabel} — ${caseNumber || reference}`;
  }
  if (year && !title.includes(year) && title.length < 82) title += ` (${year})`;
  return clip(title, 95);
}

function scoreSentence(sentence, index, total) {
  let score = 0;
  for (const hint of KEY_POINT_HINTS) if (hint.test(sentence)) score += 2;
  if (/\d/.test(sentence)) score += 0.5;
  if (sentence.length < 40) score -= 1.5;
  if (sentence.length > 400) score -= 1;
  if (/(?:whereas|in witness|before me|notary|signature|thumb)/i.test(sentence)) score -= 1;
  // Earlier sentences usually carry the operative facts; mild boost.
  score += Math.max(0, 1 - index / Math.max(10, total)) * 0.8;
  return score;
}

const NOISE_LINE = /^(?:[A-Z\s&.,'\-]{4,60})$/;

export function keyPoints(text, limit = 5) {
  const list = sentences(text).filter((s) => {
    if (s.length < 45 || s.length > 600) return false;
    if (NOISE_LINE.test(s.trim())) return false;
    if (/^page\s+\d+\s+of\s+\d+$/i.test(s)) return false;
    if (/^(?:in\s+the\s+court|before\s+the|to,|date\s*:|subject\s*:)/i.test(s) && s.length < 120) return false;
    // Headings glued to the opening sentence make poor key points.
    if (/^(?:rent|sale|legal|power|affidavit|vakalatnama|agreement|deed|notice|fir|invoice|tax)[a-z ]{0,40}\b(?:this|the)\b/i.test(s)) return false;
    return true;
  });
  const scored = list.map((s, i) => ({ sentence: s, score: scoreSentence(s, i, list.length), index: i }));
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const used = new Set();
  for (const item of scored) {
    if (picked.length >= limit) break;
    const fingerprint = normalize(item.sentence).slice(0, 60);
    if (used.has(fingerprint)) continue;
    used.add(fingerprint);
    picked.push(item);
  }
  return picked.sort((a, b) => a.index - b.index).map((p) => clip(p.sentence, 240));
}

export function extractClauses(text) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const blocks = String(text || '').split(/\n(?=\s*(?:\d{1,2}[.)]|[IVX]{1,4}[.)]|[a-z][.)])\s+)/);
  const clauses = [];
  for (const block of blocks) {
    const trimmed = collapse(block);
    const headingMatch = /^(?:\d{1,2}[.)]|[IVX]{1,4}[.)]|[a-z][.)])\s*([^.:\n]{2,80})/.exec(trimmed);
    const heading = headingMatch ? headingMatch[1] : '';
    // Only real clause blocks make useful "clauses" — skip letters, preambles and recitals.
    if (!heading) continue;
    const haystack = `${heading} ${trimmed}`;
    for (const category of CLAUSE_CATEGORIES) {
      if (!category.pattern.test(haystack)) continue;
      if (clauses.some((c) => c.key === category.key)) continue;
      let body = trimmed.replace(/^(?:\d{1,2}[.)]|[IVX]{1,4}[.)]|[a-z][.)])\s*/, '');
      if (heading) {
        body = body.replace(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.:\s\-–—]*`, 'i'), '');
      }
      clauses.push({
        key: category.key,
        label: category.label,
        heading: clip(heading || category.label, 70),
        text: clip(body, 320),
      });
      break;
    }
  }
  return clauses.slice(0, 8);
}

function buildSummary({ typeLabel, docDate, parties, amounts, court, caseNumber, clauses, text, language }) {
  const named = partyNames(parties);
  const isNotice = /notice/i.test(typeLabel);
  const addressee = named.find((p) => /addressee/i.test(p.role || ''));
  const bits = [];
  bits.push(`${typeLabel}${docDate ? ` dated ${formatDate(docDate, { long: true })}` : ''}`);
  if (isNotice && addressee) {
    bits.push(`addressed to ${addressee.name}`);
    const other = named.find((p) => p !== addressee);
    if (other) bits.push(`on behalf of ${other.name}`);
  } else if (named.length >= 2) {
    bits.push(`between ${named[0].name}${named[0].role ? ` (${named[0].role})` : ''} and ${named[1].name}${named[1].role ? ` (${named[1].role})` : ''}`);
  } else if (named.length === 1) {
    bits.push(`involving ${named[0].name}${named[0].role ? ` (${named[0].role})` : ''}`);
  }
  if (court) bits.push(`filed in ${court}`);
  if (caseNumber) bits.push(`case ${caseNumber}`);
  let summary = `${bits.join(', ')}.`;

  if (amounts.length) {
    const top = amounts.slice(0, 2).map((a) => `${a.label.toLowerCase()} ${a.raw}`).join(', ');
    summary += ` Key figures: ${top}.`;
  }

  const importantClause = clauses.find((c) => ['term', 'rent', 'notice', 'jurisdiction', 'arbitration'].includes(c.key) && c.heading && c.heading.length < 40);
  if (importantClause) {
    summary += ` ${importantClause.label}: ${clip(importantClause.text, 170)}`;
  } else {
    const body = keyPoints(text, 1)[0];
    if (body) summary += ` ${clip(body, 190)}`;
  }

  if (!String(text || '').trim()) {
    summary = `${typeLabel}${docDate ? ` dated ${formatDate(docDate)}` : ''} — no readable text inside this file, so it is catalogued by its name, date and caption.`;
  }
  if (language === 'hi') summary += ' (Document is in Hindi.)';
  return clip(summary, 620);
}

function buildTags({ docType, typeLabel, parties, court, docDate, matterName, language, status }) {
  const tags = new Set();
  tags.add(typeLabel.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  if (docType) tags.add(docType.replace(/_/g, ' '));
  for (const p of partyNames(parties).slice(0, 3)) {
    const s = surname(p.name);
    if (s && s.length > 2) tags.add(s.toLowerCase());
  }
  if (court) tags.add(court.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  if (docDate) tags.add(docDate.slice(0, 4));
  if (matterName) tags.add(matterName.toLowerCase());
  if (language === 'hi') tags.add('hindi');
  if (status === 'scanned') tags.add('scan');
  return [...tags].filter(Boolean).slice(0, 12);
}

/**
 * Analyse a document.
 * @param {object} input
 * @param {string} input.text Extracted text
 * @param {string} [input.filename]
 * @param {string} [input.caption] WhatsApp caption or user note
 * @param {string} [input.mime]
 * @param {string} [input.matterName]
 * @param {object} [input.hints] { docType, docDate } supplied by the user
 */
export function analyzeDocument({
  text = '', filename = '', caption = '', mime = '', matterName = '', hints = {},
  pageTexts = [], caughtBy = 'upload',
} = {}) {
  const cleanText = String(text || '').replace(/\u0000/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  const combinedForGuess = caption ? `${caption}\n${cleanText.slice(0, 8000)}` : cleanText;
  const classification = hints.docType && TYPE_BY_ID.has(hints.docType)
    ? { id: hints.docType, label: TYPE_BY_ID.get(hints.docType).label, confidence: 0.99, evidence: ['set by user'], score: 99, runnerUp: null }
    : classifyDocument({ text: combinedForGuess, filename, caption, mime });

  const parties = extractParties(combinedForGuess);
  const amounts = extractAmounts(cleanText);
  const statutes = extractStatutes(cleanText);
  const references = extractReferences(combinedForGuess);
  const court = extractCourt(cleanText);
  const identifiers = extractIdentifiers(cleanText);
  const language = detectLanguage(cleanText);
  const blanks = findBlanks(cleanText);
  const dateGuess = hints.docDate
    ? { iso: hints.docDate, source: 'user', confident: true }
    : extractDocumentDate(cleanText, { filename });
  const docDate = dateGuess?.iso || null;
  const caseNumber = references.caseNumbers[0] || null;
  const tenure = extractTenure(cleanText);
  const deadlines = extractDeadlines(cleanText, { docDate: docDate || toIso(new Date()) });
  const clauses = extractClauses(cleanText);
  const points = keyPoints(cleanText);

  const typeLabel = classification.label;
  const title = buildTitle({
    typeLabel, docType: classification.id, parties, docDate, caseNumber,
    reference: references.other[0], filename, originalName: filename,
  });

  const summary = buildSummary({
    typeLabel, docDate, parties, amounts, court, caseNumber, clauses, text: cleanText, language,
  });

  const flags = [];
  if (!cleanText) {
    flags.push({ level: 'warn', message: 'No readable text — stored and searchable by name, date and caption only.' });
  }
  if (classification.confidence < 0.5 && classification.id !== 'photo') {
    flags.push({ level: 'info', message: `Type uncertain (guessed ${typeLabel}). You can correct it by replying "type ${classification.id} ${'{doc}'}".` });
  }
  if (blanks.length) {
    flags.push({ level: 'warn', message: `Contains ${blanks.length} blank field(s) that may need filling: ${blanks.slice(0, 3).join(', ')}` });
  }
  if (tenure?.end && daysBetween(tenure.end) < 0) {
    flags.push({ level: 'info', message: `The ${tenure.months}-month term ended on ${formatDate(tenure.end)}.` });
  }
  if (docDate && daysBetween(docDate) < -1825) {
    flags.push({ level: 'info', message: 'Document is more than five years old.' });
  }

  const tags = buildTags({
    docType: classification.id, typeLabel, parties, court, docDate, matterName, language,
    status: cleanText ? 'text' : 'scanned',
  });

  const hasStrongSignal = cleanText.length > 200;
  const confidence = Number((
    (hasStrongSignal ? 0.35 : 0.12) +
    classification.confidence * 0.35 +
    Math.min(parties.length, 3) * 0.05 +
    (docDate ? 0.1 : 0) +
    (caseNumber || court ? 0.05 : 0)
  ).toFixed(2));

  return {
    docType: classification.id,
    typeLabel,
    typeConfidence: classification.confidence,
    typeEvidence: classification.evidence,
    runnerUpType: classification.runnerUp,
    title,
    docDate,
    dateSource: dateGuess?.source || null,
    dateConfident: Boolean(dateGuess?.confident),
    parties,
    amounts,
    statutes,
    references,
    court,
    caseNumber,
    identifiers,
    language,
    summary,
    keyPoints: points,
    clauses,
    tags,
    deadlines,
    tenure,
    blanks,
    flags,
    confidence: Math.min(confidence, 0.98),
    pageTexts,
    caughtBy,
    wordCount: cleanText ? cleanText.split(/\s+/).length : 0,
  };
}

export function describeAnalysis(analysis) {
  const lines = [];
  lines.push(`Type: ${analysis.typeLabel} (${Math.round(analysis.typeConfidence * 100)}% sure)`);
  if (analysis.docDate) lines.push(`Date: ${formatDate(analysis.docDate, { long: true })}`);
  if (analysis.parties.length) {
    lines.push(`Parties: ${analysis.parties.slice(0, 3).map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}`);
  }
  if (analysis.court) lines.push(`Court: ${analysis.court}`);
  if (analysis.caseNumber) lines.push(`Case no.: ${analysis.caseNumber}`);
  if (analysis.amounts.length) lines.push(`Amounts: ${analysis.amounts.slice(0, 3).map((a) => a.raw).join(', ')}`);
  return lines.join('\n');
}
