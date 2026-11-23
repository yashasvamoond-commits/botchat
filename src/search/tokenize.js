import { normalize } from '../util/text.js';

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
  'they', 'them', 'their', 'this', 'that', 'these', 'those', 'there', 'here', 'what', 'which',
  'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'any', 'some', 'no', 'not', 'so', 'than',
  'too', 'very', 'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'shall',
  'please', 'kindly', 'just', 'also', 'about', 'into', 'over', 'under', 'again', 'then', 'now',
  // search chatter
  'find', 'search', 'show', 'see', 'get', 'give', 'send', 'open', 'display', 'list', 'look',
  'need', 'want', 'file', 'files', 'document', 'documents', 'doc', 'docs', 'paper', 'papers',
  'copy', 'copies', 'all', 'any', 'some', 'something', 'anything', 'thing', 'things',
  'dikhao', 'dhundo', 'dhoondo', 'bhejo', 'bhej', 'chahiye', 'karo', 'kar', 'kro', 'mujhe',
  'mera', 'meri', 'mere', 'hai', 'hain', 'ka', 'ki', 'ke', 'se', 'me', 'mein', 'ko', 'aur',
  'wala', 'wali', 'gaya', 'gayi', 'tha', 'thi', 'ho', 'hua', 'please',
  // vague words that carry little search signal
  'period', 'time', 'duration', 'term', 'terms', 'detail', 'details', 'info',
  'information', 'mention', 'mentioned', 'say', 'says', 'said', 'tell', 'know',
  'explain', 'summary', 'summarise', 'summarize', 'everything', 'something',
  'anything', 'item', 'items', 'stuff', 'case', 'cases', 'matter', 'matters',
  'dossier', 'record', 'records',
]);

const SUFFIXES = ['ings', 'ing', 'edly', 'ed', 'ies', 'es', 's'];

/** Very light stemmer that keeps legal terms readable. */
export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  if (/^\d+$/.test(w)) return w;
  for (const suffix of SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      if (suffix === 'ies') return `${w.slice(0, -3)}y`;
      if (suffix === 's' && /(?:ss|us|is)$/.test(w)) return w;
      return w.slice(0, -suffix.length);
    }
  }
  return w;
}

export function tokenize(text) {
  return normalize(text)
    .split(/[^a-z0-9\u0900-\u097F]+/)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w))
    .map((w) => stem(w));
}

/** Split a query into meaningful tokens, keeping original spellings. */
export function queryTokens(text) {
  return normalize(text)
    .split(/[^a-z0-9\u0900-\u097F]+/)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w));
}

export function escapeFts(term) {
  return `"${String(term).replace(/"/g, '""')}"`;
}
