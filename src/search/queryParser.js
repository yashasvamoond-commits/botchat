import { relativeRange, MONTHS, LOCAL_MONTH_WORDS, localizeDateText } from '../util/dates.js';
import { normalize, collapse } from '../util/text.js';
import { TYPE_HINTS } from './synonyms.js';
import { queryTokens } from './tokenize.js';

const COMMAND_PREFIX = /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:kindly\s+)?(?:find|search(?:\s+for)?|show(?:\s+me)?|get(?:\s+me)?|give(?:\s+me)?|send(?:\s+me)?|open|display|list|look\s+for|pull\s+up|dikhao|dhundo|dhoondo|bhejo|chahiye)\b\s*/i;

const DATE_PHRASES = [
  'today', 'yesterday', 'this week', 'last week', 'this month', 'last month',
  'previous month', 'this year', 'last year', 'previous year', 'aaj', 'pichle mahine',
  'is mahine', 'pichle saal', 'is saal', 'is hafte',
  // Hindi / Urdu forms of the same phrases
  'आज', 'कल', 'इस हफ्ते', 'इस हफ़्ते', 'पिछले हफ्ते', 'पिछले हफ़्ते', 'इस महीने', 'इस माह',
  'पिछले महीने', 'पिछले माह', 'इस साल', 'पिछले साल',
  'آج', 'کل', 'اس ہفتے', 'گزشتہ ہفتے', 'اس ماہ', 'اس مہینے', 'گزشتہ ماہ', 'پچھلے مہینے',
  'اس سال', 'گزشتہ سال', 'پچھلے سال',
];

const LOCAL_MONTH_ALT = Object.keys(LOCAL_MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const LOCAL_MONTH_YEAR = new RegExp(`(${LOCAL_MONTH_ALT})(?:\\s*(\\d{4}))?`);

const SORT_HINTS = [
  { re: /\b(?:latest|newest|most\s+recent|recent|last\s+one|new\s+one)\b/i, sort: 'newest' },
  { re: /\b(?:oldest|earliest|first\s+one|original\s+one)\b/i, sort: 'oldest' },
];

/**
 * Turn a human sentence into a structured search plan.
 * @param {string} raw
 * @param {{matters?: Array}} options
 */
export function parseQuery(raw, { matters = [] } = {}) {
  const original = String(raw || '').trim();
  let text = original;
  const plan = {
    raw: original,
    cleaned: '',
    terms: [],
    typeIds: [],
    dateRange: null,
    matterId: null,
    matterName: null,
    tags: [],
    limit: 8,
    sort: 'relevance',
    flags: {},
    relaxable: false,
  };

  // #tags
  plan.tags = [...text.matchAll(/#([a-zA-Z0-9_-]{2,30})/g)].map((m) => m[1].toLowerCase());
  text = text.replace(/#[a-zA-Z0-9_-]{2,30}/g, ' ');

  // explicit document id
  const idMatch = /\b([DMB]\d{1,6})\b/i.exec(text);
  if (idMatch) {
    plan.docId = idMatch[1].toUpperCase();
    text = text.replace(idMatch[0], ' ');
  }

  // flags
  if (/\b(?:unfiled|unsorted|no\s+case|not\s+filed|orphan|bina\s+case)\b/i.test(text)) {
    plan.flags.unfiled = true;
    text = text.replace(/\b(?:unfiled|unsorted|no\s+case|not\s+filed|orphan|bina\s+case)\b/gi, ' ');
  }
  if (/\b(?:needs?\s+review|to\s+check|doubtful|verify|review)\b/i.test(text)) {
    plan.flags.needsReview = true;
    text = text.replace(/\b(?:needs?\s+review|to\s+check|doubtful|verify|review)\b/gi, ' ');
  }
  if (/\b(?:scanned|scan|photo)\b/i.test(text)) plan.flags.scanned = true;

  // limit: "first 5", "top 3", "last 10"
  const limitMatch = /\b(?:first|top|last|show)\s+(\d{1,2})\b/i.exec(text);
  if (limitMatch) {
    plan.limit = Math.max(1, Math.min(25, Number(limitMatch[1])));
    text = text.replace(limitMatch[0], ' ');
  }

  // sort
  for (const hint of SORT_HINTS) {
    if (hint.re.test(text)) {
      plan.sort = hint.sort;
      text = text.replace(hint.re, ' ');
      break;
    }
  }

  // dates — check every recognised phrase in the text
  const lower = normalize(text);
  const rangeCandidates = [];
  for (const phrase of DATE_PHRASES) if (lower.includes(phrase)) rangeCandidates.push(phrase);
  const localMonth = LOCAL_MONTH_YEAR.exec(text);
  if (localMonth) rangeCandidates.push(collapse(localMonth[0]));
  const monthYear = /\b(?:in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i.exec(text);
  if (monthYear) rangeCandidates.push(monthYear[0].replace(/^in\s+/i, ''));
  const yearOnly = /\b(19\d{2}|20\d{2})\b/.exec(text);
  if (yearOnly && !monthYear) rangeCandidates.push(yearOnly[1]);
  const lastN = /\blast\s+(\d{1,2})\s+(days?|weeks?|months?)\b/i.exec(text);
  if (lastN) rangeCandidates.push(lastN[0]);
  // "पिछले 3 महीने" / "گزشتہ 3 ماہ" → "last 3 months"
  const lastNLocal = /(?:पिछले|पिछला|گزشتہ|پچھلے)\s*(\d{1,2})\s*(दिन|दिवस|सप्ताह|हफ्ते|हफ़्ते|महीने|माह|دن|ہفتے|ماہ|مہینے)/.exec(text);
  if (lastNLocal) {
    const unit = /दिन|दिवस|دن/.test(lastNLocal[2]) ? 'days'
      : /सप्ताह|हफ|ہفت/.test(lastNLocal[2]) ? 'weeks' : 'months';
    rangeCandidates.push(`last ${lastNLocal[1]} ${unit}`);
  }

  for (const candidate of rangeCandidates) {
    // Local month names are understood by translating just the probe string.
    const range = relativeRange(candidate) || relativeRange(localizeDateText(candidate));
    if (!range) continue;
    plan.dateRange = range;
    if (!text.replace(new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ').trim().length
        || new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
      text = text.replace(new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    } else {
      // Candidate came from a translated probe: strip the original local phrase.
      const localMatch = LOCAL_MONTH_YEAR.exec(text);
      if (localMatch && /^(?:last|previous)\b/.test(candidate) === false) text = text.replace(localMatch[0], ' ');
    }
    break;
  }

  // matter — explicit phrasings first, then any party name in the query
  const explicitMatter = (() => {
    const m1 = /(?:case|matter|file|client)\s+(?:of\s+|named\s+|called\s+)?(?:mr\.?|mrs\.?|ms\.?)?([a-z][a-z\s.'-]{2,40}?)(?=\s+(?:cases?|matters?|documents?|files?|from|dated|in|of)\b|$)/i.exec(text);
    if (m1) return collapse(m1[1]);
    const m2 = /((?:[A-Za-z][\w.'-]*\s+){0,4})(?:cases?|matters?|files?)\b/i.exec(text);
    if (m2) return collapse(m2[1]);
    const m3 = /\b(?:everything|all|documents?)\s+(?:in|of|from)\s+(?:the\s+)?(.+)$/i.exec(text);
    if (m3) return collapse(m3[1]);
    return null;
  })();

  const scoreMatters = (needle) => {
    const q = normalize(needle || '')
      .replace(/\b(?:case|matter|file|client|the|of|named|called|everything|all|from|in|show|me|documents?|files?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length < 3) return [];
    const tokens = [...new Set(q.split(/[^a-z0-9]+/).filter((t) => t.length > 2))];
    if (!tokens.length) return [];
    return matters.map((m) => {
      const title = normalize(m.title || '');
      const hay = `${title} ${normalize(m.client || '')} ${normalize(m.opposite || '')} ${normalize(m.case_number || '')}`;
      let score = 0;
      if (title === q || normalize(m.id) === q) score += 20;
      if (q.length >= 4 && title.includes(q)) score += 6;
      for (const token of tokens) {
        if (/^\d{4}$/.test(token)) continue;
        if (title.includes(token)) score += 3;
        else if (hay.includes(token)) score += 1;
      }
      return { matter: m, score };
    }).filter((entry) => entry.score >= 3).sort((a, b) => b.score - a.score);
  };

  const explicitCandidates = scoreMatters(explicitMatter);
  const candidates = explicitCandidates.length ? explicitCandidates : scoreMatters(text);
  if (candidates.length) {
    const top = candidates[0];
    plan.matterId = top.matter.id;
    plan.matterName = top.matter.title;
    plan.matterCandidates = candidates.slice(0, 4).map((c) => ({ id: c.matter.id, title: c.matter.title, score: c.score }));
    if (candidates[1] && top.score - candidates[1].score <= 1 && top.score >= 3) plan.matterAmbiguous = true;
    // Strip the case words out of the free-text terms.
    const words = normalize(`${top.matter.title} ${top.matter.client || ''}`).split(/[^a-z]+/).filter((w) => w.length > 3);
    for (const word of words) text = text.replace(new RegExp(`\\b${word}\\b`, 'ig'), ' ');
    if (explicitMatter) text = text.replace(new RegExp(explicitMatter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }

  // document types
  for (const hint of TYPE_HINTS) {
    if (hint.re.test(text) || hint.re.test(original)) {
      for (const id of hint.ids) if (!plan.typeIds.includes(id)) plan.typeIds.push(id);
      // The words stay in the query too: "notice period" must still search for "period".
      hint.re.lastIndex = 0;
    }
  }

  // command words + filler
  text = text.replace(COMMAND_PREFIX, ' ');
  text = text.replace(/\b(?:dated?|from|of|in|on|by|about|regarding|related|to|the|a|an|please|kindly|wala|wali|mera|meri|mere|mujhe|kar|karo|kro|do|dena|dijiye)\b/gi, ' ');

  plan.terms = [...new Set(queryTokens(text))].slice(0, 8);
  plan.cleaned = collapse(text);
  plan.relaxable = Boolean(plan.typeIds.length || plan.dateRange || plan.matterId);

  if (plan.sort === 'relevance' && !plan.terms.length && (plan.typeIds.length || plan.dateRange || plan.matterId || plan.flags.unfiled)) {
    plan.sort = 'newest';
  }

  return plan;
}

/** Human-readable explanation of what the bot understood. */
export function describePlan(plan) {
  const bits = [];
  if (plan.matterName) bits.push(`case “${plan.matterName}”`);
  if (plan.typeIds.length) bits.push(`type ${plan.typeIds.join('/')}`);
  if (plan.dateRange) bits.push(`dated ${plan.dateRange.label}`);
  if (plan.tags.length) bits.push(`tag #${plan.tags.join(' #')}`);
  if (plan.terms.length) bits.push(`words: ${plan.terms.join(', ')}`);
  if (plan.flags.unfiled) bits.push('unfiled only');
  if (plan.flags.needsReview) bits.push('needs review');
  return bits.join(' · ');
}

export { MONTHS };
