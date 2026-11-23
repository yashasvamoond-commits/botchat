import { foldDigits, transliterate } from './script.js';

/** Small shared text helpers. No dependencies. */

export function slugify(input, { max = 60, sep = '-' } = {}) {
  const ascii = transliterate(String(input || ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[₹]/g, 'Rs ')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, sep)
    .replace(new RegExp(`${sep}{2,}`, 'g'), sep)
    .replace(new RegExp(`^${sep}|${sep}$`, 'g'), '');
  return ascii.slice(0, max).replace(new RegExp(`${sep}$`), '') || 'file';
}

export function titleCase(input) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'v', 'vs', 'with']);
  return String(input || '')
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\bV\b/g, 'v')
    .trim();
}

export function collapse(input) {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

export function clip(input, len = 160, suffix = '…') {
  const s = collapse(input);
  return s.length <= len ? s : s.slice(0, Math.max(0, len - suffix.length)).trimEnd() + suffix;
}

export function truncateLines(input, maxLines, maxChars = 3800) {
  const lines = String(input || '').split('\n');
  let out = lines.slice(0, maxLines).join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars);
  if (lines.length > maxLines) out += '\n…';
  return out;
}

/** Split text into sentences without breaking on common abbreviations or headings. */
const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|shri|smt|sr|jr|no|nos|sec|secs|vs|adv|st|ltd|pvt|co|govt|hon|rs|etc|viz|i\.e|e\.g|w\.e\.f|s\.o|d\.o|w\.o|r\.o|a\.c|a\/c|b\/o|o\/o|sc|hc|ps)\.)$/i;

export function sentences(text) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  // A heading on its own line is its own sentence; so is a danda (।) or an
  // Urdu full stop (۔), which end sentences just like a full stop.
  const rough = clean
    .split(/\n+/)
    .filter((line) => line.trim())
    .flatMap((line) => line.split(/(?<=[.!?।۔])\s+(?=[A-Z(0-9"'“]|[\u0900-\u097F]|[\u0600-\u06FF])/g));
  const merged = [];
  for (const part of rough) {
    const last = merged[merged.length - 1];
    if (last && ABBREVIATIONS.test(last.trim())) merged[merged.length - 1] = `${last} ${part}`;
    else merged.push(part);
  }
  return merged
    .map((sentence) => collapse(sentence))
    .filter((sentence) => sentence.length > 1);
}

export function paragraphs(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => collapse(p))
    .filter((p) => p.length > 1);
}

export function words(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9\u0900-\u097F\u0600-\u06FF]+/g) || [];
}

/** Strip diacritics, normalise quotes/dashes, lowercase. */
export function normalize(input) {
  return foldDigits(String(input || ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Arabic/Urdu: drop vowel marks and tatweel, unify letter shapes so a query
    // typed on one keyboard still matches a document typed on another.
    .replace(/[\u064B-\u065F\u0670\u0640\u200c\u200d]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ہ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trim a long body of text around the first occurrence of any term. */
export function excerptAround(text, terms, radius = 260) {
  const src = collapse(text);
  if (!src) return '';
  const lower = src.toLowerCase();
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    const idx = lower.indexOf(String(t).toLowerCase());
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  if (best === -1) return src.slice(0, radius * 2);
  const start = Math.max(0, best - radius);
  const end = Math.min(src.length, best + radius);
  return `${start > 0 ? '…' : ''}${src.slice(start, end).trim()}${end < src.length ? '…' : ''}`;
}
