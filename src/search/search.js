import { db } from '../store/db.js';
import { hydrateDocument } from '../store/repo.js';
import { parseQuery, describePlan } from './queryParser.js';
import { escapeFts, queryTokens, stem } from './tokenize.js';
import { TERM_SYNONYMS } from './synonyms.js';
import { levenshtein, normalize, collapse } from '../util/text.js';
import { daysBetween } from '../util/dates.js';

const BM25_WEIGHTS = [10, 6, 5, 4, 3, 1]; // title, doc_type, parties, tags, summary, body

let vocabCache = { at: 0, terms: [], count: -1 };

function vocabulary() {
  const now = Date.now();
  const count = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
  if (now - vocabCache.at < 20000 && vocabCache.count === count) return vocabCache.terms;
  const rows = db.prepare('SELECT term, doc FROM doc_vocab WHERE doc > 0 ORDER BY doc DESC').all();
  vocabCache = { at: now, terms: rows, count };
  return rows;
}

function buildMatch(tokens) {
  if (!tokens.length) return null;
  const groups = tokens.map((token) => {
    const variants = new Set([token]);
    const syn = TERM_SYNONYMS[token];
    if (syn) for (const s of syn) variants.add(s);
    const stemmed = stem(token);
    if (stemmed !== token) variants.add(stemmed);
    const expr = [...variants]
      .filter((v) => v && v.length > 1)
      .map((v) => `${escapeFts(v)}*`)
      .join(' OR ');
    return `(${expr})`;
  });
  return groups.join(' AND ');
}

function buildFilterClauses(plan, { useType = true, useDate = true, useMatter = true, useTags = true } = {}) {
  const where = [];
  const params = [];
  if (useType && plan.typeIds?.length) {
    where.push(`d.doc_type IN (${plan.typeIds.map(() => '?').join(',')})`);
    params.push(...plan.typeIds);
  }
  if (useDate && plan.dateRange) {
    where.push('COALESCE(d.doc_date, substr(d.created_at,1,10)) BETWEEN ? AND ?');
    params.push(plan.dateRange.from, plan.dateRange.to);
  }
  if (useMatter && plan.matterId) {
    where.push('d.matter_id = ?');
    params.push(plan.matterId);
  }
  if (useTags && plan.tags?.length) {
    where.push(`EXISTS (SELECT 1 FROM json_each(d.tags) j WHERE lower(j.value) IN (${plan.tags.map(() => '?').join(',')}))`);
    params.push(...plan.tags);
  }
  if (plan.flags?.unfiled) where.push('d.matter_id IS NULL');
  if (plan.flags?.needsReview) where.push('d.needs_review = 1');
  return { where, params };
}

function runFts(owner, match, filter, limit) {
  const where = ['d.owner = ?', ...filter.where];
  const params = [owner, ...filter.params];
  const sql = `
    SELECT d.*, bm25(doc_search, ${BM25_WEIGHTS.join(',')}) AS rank,
           snippet(doc_search, 5, '[[', ']]', ' … ', 22) AS body_snippet
    FROM doc_search
    JOIN documents d ON d.rowid = doc_search.rowid
    WHERE doc_search MATCH ? AND ${where.join(' AND ')}
    ORDER BY rank
    LIMIT ?`;
  return db.prepare(sql).all(match, ...params, limit);
}

function runFilteredOnly(owner, filter, limit, order = 'COALESCE(d.doc_date, d.created_at) DESC') {
  const where = ['d.owner = ?', ...filter.where];
  const params = [owner, ...filter.params];
  const sql = `SELECT d.* FROM documents d WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`;
  return db.prepare(sql).all(...params, limit);
}

/** Correct likely typos against the words actually present in the library. */
function correctTerms(tokens) {
  const vocab = vocabulary();
  if (!vocab.length) return { tokens, corrections: [] };
  const known = new Set(vocab.map((v) => v.term));
  const corrections = [];
  const out = tokens.map((token) => {
    if (known.has(token)) return token;
    if ([...known].some((k) => k.startsWith(token) && k.length <= token.length + 3)) return token;
    let best = null;
    let bestScore = Infinity;
    for (const { term, doc } of vocab) {
      if (Math.abs(term.length - token.length) > 2) continue;
      if (term.length < 4) continue;
      const dist = levenshtein(token, term);
      const allowed = token.length <= 5 ? 1 : 2;
      if (dist > allowed) continue;
      const score = dist - Math.log10(1 + doc) * 0.3;
      if (score < bestScore) { bestScore = score; best = term; }
    }
    if (best && best !== token) {
      corrections.push({ from: token, to: best });
      return best;
    }
    return token;
  });
  return { tokens: out, corrections };
}

function boostFor(row, plan) {
  let boost = 0;
  if (plan.typeIds?.length && plan.typeIds.includes(row.doc_type)) boost += 4;
  if (plan.matterId && row.matter_id === plan.matterId) boost += 2.5;
  if (plan.tags?.length) {
    let tags = [];
    try { tags = JSON.parse(row.tags || '[]'); } catch { /* ignore */ }
    if (plan.tags.some((t) => tags.map((x) => String(x).toLowerCase()).includes(t))) boost += 3;
  }
  if (plan.terms?.length) {
    const title = normalize(`${row.title || ''} ${row.original_name || ''}`);
    for (const term of plan.terms) if (title.includes(term)) { boost += 2.5; break; }
  }
  const dated = row.doc_date || String(row.created_at || '').slice(0, 10);
  const age = Math.abs(daysBetween(dated) ?? 999);
  if (age <= 90) boost += 1.5;
  else if (age <= 365) boost += 0.7;
  else if (age > 1825) boost -= 0.2;
  boost += Math.min(1, Math.log10(1 + (row.access_count || 0)));
  return boost;
}

/**
 * Search the library.
 * @param {string} owner
 * @param {string|object} input raw query or a plan
 */
export function searchDocuments(owner, input) {
  const plan = typeof input === 'string' ? parseQuery(input) : input;
  const limit = plan.limit || 8;
  const relaxations = [];
  let suggestion = null;

  // Direct id lookup
  if (plan.docId && /^D\d+$/.test(plan.docId)) {
    const row = db.prepare('SELECT d.* FROM documents d WHERE d.id = ? AND d.owner = ?').get(plan.docId, owner);
    if (row) {
      return {
        plan, docs: [{ ...hydrateDocument(row), _score: 100, _snippet: null, _why: ['exact id'] }],
        total: 1, suggestion: null, relaxations,
      };
    }
  }

  const tokens = plan.terms || [];
  let rows = [];
  let match = buildMatch(tokens);

  const strictFilter = buildFilterClauses(plan);
  if (match) {
    rows = runFts(owner, match, strictFilter, Math.max(limit * 4, 40));
  }

  // Relax type first, then date, then matter, then tags.
  if (!rows.length && match && strictFilter.where.length) {
    const relaxed = buildFilterClauses(plan, { useType: false });
    if (relaxed.where.length < strictFilter.where.length) {
      rows = runFts(owner, match, relaxed, Math.max(limit * 4, 40));
      if (rows.length) relaxations.push('type');
    }
  }
  if (!rows.length && match) {
    const relaxed = buildFilterClauses(plan, { useType: false, useDate: false, useMatter: Boolean(plan.lockMatter) });
    if (relaxed.where.length < strictFilter.where.length - (plan.typeIds?.length ? 1 : 0)) {
      rows = runFts(owner, match, relaxed, Math.max(limit * 4, 40));
      if (rows.length) relaxations.push('date');
    }
  }
  if (!rows.length && match && plan.matterId && !plan.lockMatter) {
    const relaxed = buildFilterClauses(plan, { useType: false, useDate: false, useMatter: false, useTags: false });
    rows = runFts(owner, match, relaxed, Math.max(limit * 4, 40));
    if (rows.length) relaxations.push('matter');
  }

  // Broad OR search
  if (!rows.length && tokens.length > 1) {
    const broad = tokens.map((t) => `${escapeFts(t)}*`).join(' OR ');
    const relaxed = buildFilterClauses(plan, { useType: false, useDate: false, useMatter: Boolean(plan.lockMatter) });
    rows = runFts(owner, broad, relaxed, Math.max(limit * 4, 40));
    if (rows.length) relaxations.push('any word');
  }

  // Typo correction
  if (!rows.length && tokens.length) {
    const { tokens: fixed, corrections } = correctTerms(tokens);
    if (corrections.length) {
      const fixedMatch = buildMatch(fixed);
      rows = runFts(owner, fixedMatch, buildFilterClauses(plan, { useType: false, useDate: false, useMatter: Boolean(plan.lockMatter) }), Math.max(limit * 4, 40));
      if (rows.length) {
        relaxations.push('spelling');
        suggestion = corrections.map((c) => `“${c.to}” for “${c.from}”`).join(', ');
        plan.correctedTerms = fixed;
      }
    }
  }

  // Filters only (browse mode)
  if (!rows.length && !tokens.length) {
    const filter = buildFilterClauses(plan);
    rows = runFilteredOnly(owner, filter, Math.max(limit * 4, 40));
    if (plan.sort === 'oldest') {
      rows = runFilteredOnly(owner, filter, Math.max(limit * 4, 40), 'COALESCE(d.doc_date, d.created_at) ASC');
    }
  }

  // Nothing at all: recent documents as a helpful fallback, but only when the
  // user gave a filter (or gave no search words at all). Typing gibberish
  // should produce "nothing found", not the whole library.
  const hadFilters = Boolean(plan.typeIds?.length || plan.dateRange || plan.matterId || plan.tags?.length || plan.flags?.unfiled || plan.docType);
  if (!rows.length && (hadFilters || !tokens.length)) {
    const fallbackFilter = plan.lockMatter && plan.matterId
      ? { where: ['d.matter_id = ?'], params: [plan.matterId] }
      : { where: [], params: [] };
    rows = runFilteredOnly(owner, fallbackFilter, limit, 'd.created_at DESC');
    if (rows.length && (match || tokens.length)) relaxations.push('recent');
  }

  const docs = rows.map((row) => {
    const base = typeof row.rank === 'number' ? -row.rank : 0;
    const doc = hydrateDocument(row);
    return {
      ...doc,
      _score: Number((base + boostFor(row, plan)).toFixed(3)),
      _snippet: row.body_snippet || null,
      _why: [],
    };
  });

  // Sort
  if (plan.sort === 'newest' || plan.sort === 'oldest') {
    docs.sort((a, b) => {
      const da = a.doc_date || String(a.created_at).slice(0, 10);
      const db_ = b.doc_date || String(b.created_at).slice(0, 10);
      return plan.sort === 'oldest' ? da.localeCompare(db_) : db_.localeCompare(da);
    });
  } else {
    docs.sort((a, b) => b._score - a._score);
  }

  const total = docs.length;
  const limited = docs.slice(0, limit);
  for (const doc of limited) {
    if (plan.typeIds?.includes(doc.doc_type)) doc._why.push(`type: ${doc.type_label || doc.doc_type}`);
    if (plan.matterId && doc.matter_id === plan.matterId) doc._why.push('same case');
    if (plan.dateRange) doc._why.push(plan.dateRange.label);
    if (!doc._why.length && doc._snippet) doc._why.push('text match');
  }

  return { plan, docs: limited, total, suggestion, relaxations, explanation: describePlan(plan) };
}

/** Plain search helper used by the dashboard and bundles. */
export function quickSearch(owner, query, limit = 10) {
  const plan = parseQuery(query);
  plan.limit = limit;
  return searchDocuments(owner, plan);
}

/**
 * Best matching passage inside a document, for "what does it say about X" questions.
 */
export function bestPassage(text, question, { pagesMeta = [], maxLength = 600 } = {}) {
  // Join wrapped lines so a sentence broken across lines stays whole.
  // Newlines become single spaces, so offsets (and page numbers) stay valid.
  const source = String(text || '').replace(/\r/g, '').replace(/\n(?!\n)/g, ' ');
  if (!source.trim()) return { passage: '', page: null, score: 0 };
  const terms = queryTokens(question);
  if (!terms.length) {
    return { passage: collapse(source).slice(0, maxLength), page: pageForOffset(pagesMeta, 0), score: 0 };
  }

  const chunks = [];
  const re = /[^\n.!?]{20,600}[.!?]?/g;
  let m;
  while ((m = re.exec(source))) {
    const raw = m[0];
    if (raw.trim().length < 20) continue;
    chunks.push({ text: collapse(raw), index: m.index, page: pageForOffset(pagesMeta, m.index) });
  }
  if (!chunks.length) return { passage: collapse(source).slice(0, maxLength), page: pageForOffset(pagesMeta, 0), score: 0 };

  const docFreq = new Map();
  for (const term of terms) {
    let df = 0;
    for (const chunk of chunks) if (chunk.text.toLowerCase().includes(term)) df += 1;
    docFreq.set(term, df);
  }
  const N = chunks.length;
  const scored = chunks.map((chunk, i) => {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!lower.includes(term)) continue;
      const df = docFreq.get(term) || 1;
      const idf = Math.log(1 + N / df);
      score += idf;
    }
    // Reward terms that sit close together ("notice period", "security deposit").
    for (let t = 0; t < terms.length - 1; t++) {
      const a = lower.indexOf(terms[t]);
      const b = lower.indexOf(terms[t + 1]);
      if (a >= 0 && b >= 0 && Math.abs(a - b) < 70) score += 1.2;
    }
    if (terms.length > 1 && lower.includes(terms.join(' '))) score += 1.5;
    // Field-specific hints: a question about notice, rent, deposit, etc.
    if (/notice|terminat/i.test(question) && /notice|terminat/i.test(chunk.text) && /\d+\s*(?:days?|months?)/i.test(chunk.text)) score += 1.6;
    if (/deposit|security/i.test(question) && /deposit/i.test(chunk.text)) score += 0.8;
    if (/rent|kiraya/i.test(question) && /\brent\b/i.test(chunk.text)) score += 0.6;
    if (/jurisdiction|court/i.test(question) && /jurisdiction/i.test(chunk.text)) score += 0.9;
    if (/arbitrat/i.test(question) && /arbitrat/i.test(chunk.text)) score += 0.9;
    if (/penalt|interest|late/i.test(question) && /penalt|interest/i.test(chunk.text)) score += 0.7;
    if (/\d/.test(question) && /\d/.test(chunk.text)) score += 0.4;
    if (/(?:amount|rent|deposit|notice|period|date|due|party|parties|clause)/i.test(question)
      && /(?:amount|rent|deposit|notice|period|due|date|party|parties)/i.test(chunk.text)) score += 0.3;
    return { ...chunk, score, i };
  }).filter((c) => c.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { passage: '', page: null, score: 0 };

  // Include the following sentence for context.
  const next = chunks[top.i + 1];
  let passage = top.text;
  if (next && (passage.length + next.text.length) < maxLength) passage += ` ${next.text}`;
  return { passage: passage.slice(0, maxLength), page: top.page || 1, score: Number(top.score.toFixed(2)) };
}

function pageForOffset(pagesMeta, offset) {
  if (!Array.isArray(pagesMeta) || !pagesMeta.length) return 1;
  let page = pagesMeta[0].page;
  for (const p of pagesMeta) {
    if (offset >= p.start) page = p.page;
    else break;
  }
  return page;
}

/** Documents that look like the same matter / type as this one. */
export function findRelated(owner, doc, limit = 5) {
  if (!doc) return [];
  const partners = (doc.parties || []).map((p) => (typeof p === 'string' ? p : p.name)).filter(Boolean);
  const names = [...new Set(partners.flatMap((p) => String(p).split(/\s+/).filter((w) => w.length > 3)))];
  const rows = db.prepare(
    `SELECT d.* FROM documents d
     WHERE d.owner = ? AND d.id != ?
       AND (d.matter_id IS NOT NULL AND d.matter_id = ?)
     ORDER BY COALESCE(d.doc_date, d.created_at) DESC LIMIT ?`,
  ).all(owner, doc.id, doc.matter_id || '', limit);
  if (rows.length) return rows.map(hydrateDocument);
  if (!names.length) return [];
  const like = names.map(() => 'd.parties LIKE ?').join(' OR ');
  const found = db.prepare(
    `SELECT d.* FROM documents d WHERE d.owner = ? AND d.id != ? AND (${like})
     ORDER BY COALESCE(d.doc_date, d.created_at) DESC LIMIT ?`,
  ).all(owner, doc.id, ...names.map((n) => `%${n}%`), limit);
  return found.map(hydrateDocument);
}
