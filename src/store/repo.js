import { db, nextSeq, tx } from './db.js';
import { toIso } from '../util/dates.js';
import { normalize } from '../util/text.js';

const DOC_JSON_FIELDS = ['key_points', 'parties', 'amounts', 'statutes', 'deadlines_json', 'clauses', 'tags', 'entities'];
const DOC_COLUMNS = [
  'owner', 'matter_id', 'title', 'doc_type', 'type_label', 'type_confidence', 'doc_date',
  'date_source', 'court', 'case_number', 'original_name', 'file_name', 'rel_path', 'mime',
  'size', 'pages', 'sha256', 'status', 'source', 'text', 'text_source', 'summary',
  ...DOC_JSON_FIELDS, 'confidence', 'needs_review', 'duplicate_of', 'version_of', 'language',
];

function hydrate(row) {
  if (!row) return null;
  const doc = { ...row };
  for (const key of DOC_JSON_FIELDS) {
    const value = doc[key];
    if (typeof value === 'string' && value) {
      try { doc[key] = JSON.parse(value); } catch { doc[key] = null; }
    } else if (value == null) {
      doc[key] = null;
    }
  }
  doc.parties = doc.parties || [];
  doc.amounts = doc.amounts || [];
  doc.statutes = doc.statutes || [];
  doc.clauses = doc.clauses || [];
  doc.key_points = doc.key_points || [];
  doc.tags = doc.tags || [];
  doc.deadlines_json = doc.deadlines_json || [];
  doc.entities = doc.entities || {};
  doc.needs_review = Boolean(doc.needs_review);
  return doc;
}

function stringifyForDb(fields) {
  const out = { ...fields };
  for (const key of DOC_JSON_FIELDS) {
    if (out[key] !== undefined && out[key] !== null && typeof out[key] !== 'string') {
      out[key] = JSON.stringify(out[key]);
    }
  }
  if (out.needs_review !== undefined) out.needs_review = out.needs_review ? 1 : 0;
  return out;
}

function searchableText(doc) {
  return {
    title: [doc.title, doc.original_name, doc.file_name].filter(Boolean).join(' '),
    doc_type: [doc.doc_type, doc.type_label].filter(Boolean).join(' '),
    parties: (doc.parties || [])
      .map((p) => (typeof p === 'string' ? p : [p.name, p.role].filter(Boolean).join(' ')))
      .join(' '),
    tags: (doc.tags || []).join(' '),
    summary: [doc.summary, doc.court, doc.case_number].filter(Boolean).join(' '),
    body: String(doc.text || '').slice(0, 2_000_000),
  };
}

export function reindexDoc(doc) {
  const fields = searchableText(doc);
  const row = db.prepare('SELECT rowid AS rid FROM documents WHERE id = ?').get(doc.id);
  if (!row) return;
  db.prepare('DELETE FROM doc_search WHERE rowid = ?').run(row.rid);
  db.prepare(
    `INSERT INTO doc_search(rowid, title, doc_type, parties, tags, summary, body)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.rid, fields.title, fields.doc_type, fields.parties, fields.tags, fields.summary, fields.body);
  db.prepare('UPDATE documents SET fts_rowid = ? WHERE id = ?').run(row.rid, doc.id);
}

export function createDocument(fields) {
  const now = new Date().toISOString();
  const seq = fields.seq ?? nextSeq('doc');
  const id = fields.id || `D${seq}`;
  const record = stringifyForDb({
    status: 'processing',
    source: 'upload',
    ...fields,
    id,
    seq,
    created_at: now,
    updated_at: now,
  });
  const columns = ['id', 'seq', 'created_at', 'updated_at', ...DOC_COLUMNS.filter((c) => record[c] !== undefined)];
  const sql = `INSERT INTO documents(${columns.join(', ')}) VALUES(${columns.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...columns.map((c) => record[c]));
  const doc = getDocument(record.owner, id);
  reindexDoc(doc);
  return doc;
}

export function updateDocument(id, fields) {
  const record = stringifyForDb(fields);
  const keys = DOC_COLUMNS.filter((c) => record[c] !== undefined);
  if (!keys.length) return getDocumentById(id);
  const sql = `UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => record[k]), new Date().toISOString(), id);
  const doc = getDocumentById(id);
  if (doc) reindexDoc(doc);
  return doc;
}

export function getDocument(owner, id) {
  const clean = String(id || '').toUpperCase().replace(/^#/, '').trim();
  if (!clean) return null;
  const row = db
    .prepare('SELECT * FROM documents WHERE id = ? AND owner = ?')
    .get(clean, owner);
  return hydrate(row);
}

export function getDocumentById(id) {
  return hydrate(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
}

export function getDocumentBySha(owner, sha) {
  return hydrate(
    db.prepare('SELECT * FROM documents WHERE owner = ? AND sha256 = ? ORDER BY id LIMIT 1').get(owner, sha),
  );
}

export function deleteDocument(owner, id) {
  const doc = getDocument(owner, id);
  if (!doc) return null;
  const row = db.prepare('SELECT rowid AS rid FROM documents WHERE id = ?').get(doc.id);
  if (row) db.prepare('DELETE FROM doc_search WHERE rowid = ?').run(row.rid);
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  db.prepare('UPDATE deadlines SET status = ? WHERE document_id = ?').run('cancelled', doc.id);
  return doc;
}

export function touchDocument(id) {
  db.prepare(
    'UPDATE documents SET access_count = access_count + 1, last_accessed = ? WHERE id = ?',
  ).run(new Date().toISOString(), id);
}

export function listDocuments(owner, { matterId, docType, limit = 50, offset = 0, status, order = 'created_at DESC' } = {}) {
  const where = ['owner = ?'];
  const params = [owner];
  if (matterId) { where.push('matter_id = ?'); params.push(matterId); }
  if (docType) { where.push('doc_type = ?'); params.push(docType); }
  if (status) { where.push('status = ?'); params.push(status); }
  const safeOrder = /^[a-z_]+ (ASC|DESC)$/i.test(order) ? order : 'created_at DESC';
  const rows = db
    .prepare(`SELECT * FROM documents WHERE ${where.join(' AND ')} ORDER BY ${safeOrder} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return rows.map(hydrate);
}

export function countDocuments(owner, filters = {}) {
  const where = ['owner = ?'];
  const params = [owner];
  if (filters.matterId) { where.push('matter_id = ?'); params.push(filters.matterId); }
  if (filters.docType) { where.push('doc_type = ?'); params.push(filters.docType); }
  const row = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE ${where.join(' AND ')}`).get(...params);
  return row.n;
}

export function docTypeCounts(owner) {
  return db
    .prepare(
      `SELECT doc_type, type_label, COUNT(*) AS n
       FROM documents WHERE owner = ? GROUP BY doc_type ORDER BY n DESC`,
    )
    .all(owner);
}

export function recentDocuments(owner, days = 30, limit = 30) {
  const since = toIso(new Date(Date.now() - days * 86400000));
  return db
    .prepare(
      `SELECT * FROM documents WHERE owner = ?
       AND COALESCE(doc_date, substr(created_at,1,10)) >= ?
       ORDER BY COALESCE(doc_date, substr(created_at,1,10)) DESC, id DESC LIMIT ?`,
    )
    .all(owner, since, limit)
    .map(hydrate);
}

export function allDocumentsForIndex(owner) {
  return db
    .prepare('SELECT id, seq, owner, matter_id, title, doc_type, type_label, doc_date, parties, tags, summary, status, needs_review, created_at, rel_path FROM documents WHERE owner = ?')
    .all(owner)
    .map((r) => ({
      ...r,
      parties: safeJson(r.parties) || [],
      tags: safeJson(r.tags) || [],
    }));
}

function safeJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/* ───────────────────────────── matters ───────────────────────────── */

function hydrateMatter(row) {
  return row ? { ...row } : null;
}

export function createMatter(owner, fields = {}) {
  return tx(() => {
    const seq = nextSeq('matter');
    const id = `M${seq}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO matters(id, seq, owner, title, client, opposite, case_number, court, practice_area, status, notes, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, seq, owner, fields.title || `Matter ${seq}`, fields.client || null, fields.opposite || null,
      fields.case_number || null, fields.court || null, fields.practice_area || null,
      fields.status || 'active', fields.notes || null, now, now,
    );
    return getMatter(id);
  });
}

export function getMatter(id) {
  return hydrateMatter(db.prepare('SELECT * FROM matters WHERE id = ?').get(String(id || '').toUpperCase()));
}

export function listMatters(owner, { status = 'active', limit = 100 } = {}) {
  // Numbered lists must be stable: case 1 is always the first one created.
  const rows = status
    ? db.prepare('SELECT * FROM matters WHERE owner = ? AND status = ? ORDER BY seq ASC, id ASC LIMIT ?').all(owner, status, limit)
    : db.prepare('SELECT * FROM matters WHERE owner = ? ORDER BY seq ASC, id ASC LIMIT ?').all(owner, limit);
  return rows.map((m) => ({ ...m, doc_count: docsForMatter(m.id).length }));
}

export function updateMatter(id, fields) {
  const allowed = ['title', 'client', 'opposite', 'case_number', 'court', 'practice_area', 'status', 'notes'];
  const keys = allowed.filter((k) => fields[k] !== undefined);
  if (!keys.length) return getMatter(id);
  db.prepare(`UPDATE matters SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), new Date().toISOString(), id);
  return getMatter(id);
}

export function deleteMatter(id) {
  db.prepare('UPDATE documents SET matter_id = NULL WHERE matter_id = ?').run(id);
  db.prepare('DELETE FROM matters WHERE id = ?').run(id);
}

export function docsForMatter(matterId) {
  return db
    .prepare('SELECT * FROM documents WHERE matter_id = ? ORDER BY COALESCE(doc_date, created_at) ASC, id ASC')
    .all(matterId)
    .map(hydrate);
}

/** Best-effort match of a free-text name to an existing matter. */
export function findMatterByName(owner, query) {
  const q = normalize(query).replace(/\b(case|matter|file)\b/g, '').trim();
  if (!q) return null;
  const matters = listMatters(owner, { status: null, limit: 500 });
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  let best = null;
  let bestScore = 0;
  for (const m of matters) {
    const hay = normalize(`${m.title} ${m.client || ''} ${m.opposite || ''} ${m.case_number || ''}`);
    let score = 0;
    if (hay.includes(q)) score += 10;
    for (const t of tokens) if (hay.includes(t)) score += 2;
    if (m.id.toLowerCase() === q) score += 20;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 2 ? best : null;
}

/* ───────────────────────────── deadlines ───────────────────────────── */

export function addDeadline(owner, fields) {
  const info = db.prepare(
    `INSERT INTO deadlines(owner, document_id, matter_id, kind, title, detail, due_date, remind_days, status, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    owner, fields.document_id || null, fields.matter_id || null, fields.kind || 'deadline',
    fields.title, fields.detail || null, fields.due_date, fields.remind_days ?? 3,
    fields.status || 'open', new Date().toISOString(),
  );
  return db.prepare('SELECT * FROM deadlines WHERE id = ?').get(info.lastInsertRowid);
}

export function listDeadlines(owner, { status = 'open', limit = 100, from = '0000-01-01', to = '9999-12-31' } = {}) {
  const params = [owner, from, to];
  let sql = 'SELECT * FROM deadlines WHERE owner = ? AND due_date >= ? AND due_date <= ?';
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY due_date ASC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function dueDeadlines(nowIso, limit = 50) {
  return db
    .prepare(
      `SELECT * FROM deadlines
       WHERE status = 'open' AND notified_at IS NULL
         AND date(due_date, '-' || remind_days || ' days') <= date(?)
       ORDER BY due_date ASC LIMIT ?`,
    )
    .all(nowIso, limit);
}

export function markDeadlineNotified(id) {
  db.prepare('UPDATE deadlines SET notified_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function completeDeadline(id) {
  db.prepare("UPDATE deadlines SET status = 'done' WHERE id = ?").run(id);
}

/* ───────────────────────────── messages ───────────────────────────── */

export function logMessage({ owner, direction, waId, kind, body, meta }) {
  try {
    db.prepare(
      'INSERT INTO messages(owner, direction, wa_id, kind, body, meta, created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(owner || null, direction, waId || null, kind || 'text', body || null,
      meta ? JSON.stringify(meta) : null, new Date().toISOString());
  } catch (err) {
    if (!String(err.message).includes('UNIQUE')) throw err;
  }
}

export function messagesWith(owner, limit = 100) {
  return db
    .prepare('SELECT * FROM messages WHERE owner = ? ORDER BY id DESC LIMIT ?')
    .all(owner, limit)
    .reverse()
    .map((m) => ({ ...m, meta: safeJson(m.meta) }));
}

export function seenWaId(waId) {
  if (!waId) return false;
  return Boolean(db.prepare('SELECT 1 AS x FROM messages WHERE wa_id = ?').get(waId));
}

/* ───────────────────────────── bundles ───────────────────────────── */

export function createBundle(owner, fields) {
  const seq = nextSeq('bundle');
  const id = `B${seq}`;
  db.prepare(
    'INSERT INTO bundles(id, seq, owner, matter_id, title, doc_ids, path, size, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(id, seq, owner, fields.matter_id || null, fields.title, JSON.stringify(fields.doc_ids || []),
    fields.path || null, fields.size || null, new Date().toISOString());
  return db.prepare('SELECT * FROM bundles WHERE id = ?').get(id);
}

export function getBundle(id) {
  const row = db.prepare('SELECT * FROM bundles WHERE id = ?').get(String(id || '').toUpperCase());
  return row ? { ...row, doc_ids: safeJson(row.doc_ids) || [] } : null;
}

export function listBundles(owner, limit = 20) {
  return db.prepare('SELECT * FROM bundles WHERE owner = ? ORDER BY id DESC LIMIT ?').all(owner, limit)
    .map((b) => ({ ...b, doc_ids: safeJson(b.doc_ids) || [] }));
}

/* ───────────────────────────── stats ───────────────────────────── */

export function stats(owner) {
  const total = db.prepare('SELECT COUNT(*) n FROM documents WHERE owner = ?').get(owner).n;
  const pages = db.prepare('SELECT COALESCE(SUM(pages),0) n FROM documents WHERE owner = ?').get(owner).n;
  const size = db.prepare('SELECT COALESCE(SUM(size),0) n FROM documents WHERE owner = ?').get(owner).n;
  const review = db.prepare('SELECT COUNT(*) n FROM documents WHERE owner = ? AND needs_review = 1').get(owner).n;
  const matters = db.prepare("SELECT COUNT(*) n FROM matters WHERE owner = ? AND status = 'active'").get(owner).n;
  const bytes = typeof size === 'bigint' ? Number(size) : size;
  return { total, pages: typeof pages === 'bigint' ? Number(pages) : pages, bytes, needsReview: review, matters };
}

export const hydrateDocument = hydrate;
