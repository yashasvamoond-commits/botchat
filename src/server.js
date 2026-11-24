import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, isOwner, whatsappConfigured, llmConfigured } from './config.js';
import { ROOT } from './config.js';
import { log } from './util/logger.js';
import { db, setting, setSetting, backupTo } from './store/db.js';
import {
  stats, listDocuments, getDocument, updateDocument, deleteDocument, listMatters, getMatter,
  createMatter, updateMatter, docsForMatter, listDeadlines, addDeadline, completeDeadline,
  dueDeadlines, markDeadlineNotified, recentDocuments, docTypeCounts, messagesWith, logMessage,
  listBundles, getBundle, findMatterByName, createDocument, countDocuments,
} from './store/repo.js';
import { searchDocuments, findRelated } from './search/search.js';
import { parseQuery } from './search/queryParser.js';
import { handleText, handleMedia } from './bot/handlers.js';
import { ingestFile } from './ingest/pipeline.js';
import { importEcourtsUpload } from './ingest/ecourts.js';
import { ecourtsSummary, listEcourtsCases, upcomingHearings, findEcourtsCase } from './store/ecourts.js';
import { archiveDelete } from './store/trash.js';
import { buildBundle } from './bundle/builder.js';
import { createDraftDocument, DRAFT_TEMPLATES } from './draft/generator.js';
import { webhookRouter } from './whatsapp/webhook.js';
import { whatsappAuthorised } from './whatsapp/cloud.js';
import { parseMultipart } from './http/multipart.js';
import { formatDate, daysBetween, toIso } from './util/dates.js';
import { clip, plural, slugify } from './util/text.js';
import { DOC_TYPES } from './analysis/taxonomy.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Framing policy.
// A same-origin-only policy (X-Frame-Options: SAMEORIGIN) makes the app refuse to
// render inside the hosted preview pane, which shows the dashboard in an iframe
// from another origin. By default we therefore send no framing header at all —
// the app is already gated by the access code — and a deployment can lock this
// down with FRAME_ANCESTORS (e.g. "self", or "https://docs.example.com").
const frameAncestors = String(process.env.FRAME_ANCESTORS || '').trim();

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (frameAncestors === 'self') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  } else if (frameAncestors) {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  }
  next();
});

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const SIM_OWNER = config.ownerPhone || 'local';
const startedAt = new Date();

/* ───────────────────────────── auth ───────────────────────────── */

const sessions = new Set();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function tokenMatches(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(config.dashboardToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authed(req) {
  if (tokenMatches(req.get('x-dashboard-token'))) return true;
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.xdm_session && sessions.has(cookies.xdm_session)) return true;
  if (req.query.token && tokenMatches(req.query.token)) return true;
  return false;
}

function requireAuth(req, res, next) {
  if (authed(req)) return next();
  res.status(401).json({ error: 'unauthorised' });
}

app.post('/api/login', (req, res) => {
  const { token } = req.body || {};
  if (!tokenMatches(token)) {
    return res.status(401).json({ error: 'That access code is not right.' });
  }
  const session = crypto.randomBytes(24).toString('hex');
  sessions.add(session);
  res.setHeader('Set-Cookie', `xdm_session=${session}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.xdm_session) sessions.delete(cookies.xdm_session);
  res.setHeader('Set-Cookie', 'xdm_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ ok: authed(req), name: config.ownerName || 'there' });
});

// Convenience: open the dashboard with ?token=XXXX once.
app.get('/login', (req, res) => {
  if (req.query.token && tokenMatches(req.query.token)) {
    const session = crypto.randomBytes(24).toString('hex');
    sessions.add(session);
    res.setHeader('Set-Cookie', `xdm_session=${session}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${req.secure ? '; Secure' : ''}`);
    return res.redirect('/');
  }
  res.redirect('/');
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    documents: stats(SIM_OWNER).total,
    whatsapp: whatsappAuthorised(),
    llm: llmConfigured(),
    uptimeHours: Number(((Date.now() - startedAt) / 3600000).toFixed(1)),
  });
});

app.use('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(webhookRouter);

/* ───────────────────────────── api ───────────────────────────── */

const api = express.Router();
api.use(requireAuth);

api.get('/overview', (req, res) => {
  const owner = SIM_OWNER;
  const s = stats(owner);
  res.json({
    stats: s,
    typeCounts: docTypeCounts(owner),
    recent: listDocuments(owner, { limit: 8 }).map(publicDoc),
    matters: listMatters(owner, { status: 'active', limit: 50 }),
    deadlines: listDeadlines(owner, { limit: 8 }),
    bundles: listBundles(owner, 5),
    whatsapp: whatsappAuthorised(),
    llm: llmConfigured(),
    ownerName: config.ownerName || '',
    beenRunning: startedAt.toISOString(),
  });
});

function publicDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    type: doc.doc_type,
    typeLabel: doc.type_label,
    date: doc.doc_date,
    matterId: doc.matter_id,
    court: doc.court,
    caseNumber: doc.case_number,
    parties: doc.parties,
    tags: doc.tags,
    summary: doc.summary,
    pages: doc.pages,
    size: doc.size,
    status: doc.status,
    source: doc.source,
    needsReview: doc.needs_review,
    createdAt: doc.created_at,
    amounts: doc.amounts,
    keyPoints: doc.key_points,
    clauses: doc.clauses,
    language: doc.language,
    sha: doc.sha256,
    originalName: doc.original_name,
    fileName: doc.file_name,
    fileUrl: doc.rel_path ? `/api/file?p=${encodeURIComponent(doc.rel_path)}` : null,
  };
}

api.get('/documents', (req, res) => {
  const owner = SIM_OWNER;
  const { q, type, matter, limit = 50, offset = 0 } = req.query;
  if (q) {
    const plan = parseQuery(String(q), { matters: listMatters(owner, { status: null, limit: 300 }) });
    if (type) plan.typeIds = [String(type)];
    if (matter) plan.matterId = String(matter);
    plan.limit = Math.min(200, Number(limit) || 50);
    const result = searchDocuments(owner, plan);
    return res.json({
      documents: result.docs.map((d) => ({ ...publicDoc(d), score: d._score, snippet: d._snippet })),
      total: result.total,
      suggestion: result.suggestion,
      interpretation: result.explanation,
    });
  }
  const docs = listDocuments(owner, {
    matterId: matter || undefined,
    docType: type || undefined,
    limit: Math.min(500, Number(limit) || 50),
    offset: Number(offset) || 0,
  });
  res.json({ documents: docs.map(publicDoc), total: countDocuments(owner, { matterId: matter, docType: type }) });
});

api.get('/documents/:id', (req, res) => {
  const doc = getDocument(SIM_OWNER, req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  const matter = doc.matter_id ? getMatter(doc.matter_id) : null;
  res.json({
    ...publicDoc(doc),
    text: doc.text,
    entities: doc.entities,
    deadlines: doc.deadlines_json,
    related: findRelated(SIM_OWNER, doc, 5).filter((d) => d.id !== doc.id).map(publicDoc),
    matter,
    docxUrl: doc.entities?.docx ? `/api/file?p=${encodeURIComponent(doc.entities.docx)}` : null,
  });
});

api.patch('/documents/:id', (req, res) => {
  const doc = getDocument(SIM_OWNER, req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  const allowed = ['title', 'doc_type', 'type_label', 'doc_date', 'matter_id', 'tags', 'summary', 'needs_review'];
  const patch = {};
  for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
  if (patch.doc_type && !patch.type_label) {
    const found = DOC_TYPES.find((t) => t.id === patch.doc_type);
    if (found) patch.type_label = found.label;
  }
  const updated = updateDocument(doc.id, patch);
  res.json(publicDoc(updated));
});

api.delete('/documents/:id', async (req, res) => {
  const doc = getDocument(SIM_OWNER, req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  await archiveDelete(doc);
  res.json({ ok: true });
});

api.get('/file', (req, res) => {
  const rel = String(req.query.p || '');
  if (!rel) return res.status(400).end();
  const abs = path.resolve(config.dataDir, rel);
  if (!abs.startsWith(config.dataDir) || !fs.existsSync(abs)) return res.status(404).end();
  const inline = req.query.inline === '1' || /\.(pdf|png|jpe?g|webp|gif|txt)$/i.test(abs);
  if (inline) res.setHeader('Content-Disposition', `inline; filename="${path.basename(abs)}"`);
  else res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
  res.sendFile(abs);
});

api.get('/matters', (_req, res) => {
  res.json({ matters: listMatters(SIM_OWNER, { status: 'active', limit: 200 }) });
});

api.post('/matters', (req, res) => {
  const { title, client, opposite, case_number, court, practice_area } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  res.json(createMatter(SIM_OWNER, { title, client, opposite, case_number, court, practice_area }));
});

api.patch('/matters/:id', (req, res) => {
  const matter = getMatter(req.params.id);
  if (!matter) return res.status(404).json({ error: 'not found' });
  res.json(updateMatter(matter.id, req.body || {}));
});

api.get('/matters/:id', (req, res) => {
  const matter = getMatter(req.params.id);
  if (!matter) return res.status(404).json({ error: 'not found' });
  res.json({ matter, documents: docsForMatter(matter.id).map(publicDoc), bundles: listBundles(SIM_OWNER, 10).filter((b) => b.matter_id === matter.id) });
});

api.get('/deadlines', (_req, res) => {
  res.json({ deadlines: listDeadlines(SIM_OWNER, { limit: 100 }) });
});

api.post('/deadlines', (req, res) => {
  const { title, due_date, detail, remind_days, matter_id, document_id, kind } = req.body || {};
  if (!title || !due_date) return res.status(400).json({ error: 'title and due_date required' });
  res.json(addDeadline(SIM_OWNER, { title, due_date, detail, remind_days, matter_id, document_id, kind }));
});

api.post('/deadlines/:id/done', (req, res) => {
  completeDeadline(Number(req.params.id));
  res.json({ ok: true });
});

api.get('/ecourts', (req, res) => {
  const query = String(req.query.q || '');
  res.json({
    summary: ecourtsSummary(SIM_OWNER),
    cases: listEcourtsCases(SIM_OWNER, { query, limit: Number(req.query.limit) || 100 }),
    upcoming: upcomingHearings(SIM_OWNER, { limit: 20 }),
  });
});

api.get('/ecourts/:cnr', (req, res) => {
  const record = findEcourtsCase(SIM_OWNER, req.params.cnr);
  if (!record) return res.status(404).json({ error: 'No remembered eCourts case with that CNR.' });
  res.json({ case: record });
});

api.post('/upload', async (req, res) => {
  try {
    const { fields, files } = await parseMultipart(req);
    const file = files[0];
    // An eCourts .txt dump goes to permanent memory, not the document library.
    if (/\.txt$/i.test(file.filename || '') || /^text\/plain/i.test(file.mime || '')) {
      const imported = importEcourtsUpload({ owner: SIM_OWNER, buffer: file.buffer, filename: file.filename });
      if (imported.handled) {
        return res.json({
          ecourts: true,
          added: imported.added,
          updated: imported.updated,
          cases: imported.records.map((r) => ({ cnr: r.cnr, title: r.title, nextHearing: r.next_hearing })),
          message: imported.message,
        });
      }
    }
    const result = await ingestFile({
      owner: SIM_OWNER,
      buffer: file.buffer,
      filename: file.filename,
      mime: file.mime,
      caption: fields.caption || '',
      matterId: fields.matterId || null,
    });
    res.json({
      duplicate: result.duplicate,
      document: publicDoc(result.doc),
      suggestions: (result.matterSuggestions || []).map((s) => ({ id: s.matter.id, title: s.matter.title, score: s.score })),
      warnings: result.warnings,
    });
  } catch (err) {
    log.warn('upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

api.post('/bundle', async (req, res) => {
  try {
    const { matterId } = req.body || {};
    const matter = matterId ? getMatter(matterId) : null;
    const docs = matter ? docsForMatter(matter.id) : listDocuments(SIM_OWNER, { limit: 500 }).reverse();
    if (!docs.length) return res.status(400).json({ error: 'No documents to bundle' });
    const result = await buildBundle({ owner: SIM_OWNER, matter, docs, title: matter?.title || 'Library bundle' });
    res.json({
      bundle: result.bundle,
      count: result.count,
      size: result.size,
      url: `/api/file?p=${encodeURIComponent(result.bundle.path)}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/bundles/:id/file', (req, res) => {
  const bundle = getBundle(req.params.id);
  if (!bundle?.path) return res.status(404).end();
  const abs = path.resolve(config.dataDir, bundle.path);
  if (!abs.startsWith(config.dataDir) || !fs.existsSync(abs)) return res.status(404).end();
  res.download(abs);
});

api.get('/templates', (_req, res) => {
  res.json({ templates: DRAFT_TEMPLATES.map((t) => ({ id: t.id, label: t.label })) });
});

api.post('/draft', async (req, res) => {
  try {
    const { templateId, instruction, matterId } = req.body || {};
    const result = await createDraftDocument({
      owner: SIM_OWNER,
      instruction: instruction || '',
      templateId,
      authorName: config.ownerName,
      matterId: matterId || null,
    });
    if (!result) return res.status(400).json({ error: 'Could not build that draft' });
    res.json({
      document: publicDoc(result.doc),
      missing: result.missing,
      docxUrl: result.doc.entities?.docx ? `/api/file?p=${encodeURIComponent(result.doc.entities.docx)}` : null,
      preview: result.text.slice(0, 2000),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.get('/search', (req, res) => {
  const q = String(req.query.q || '');
  const plan = parseQuery(q, { matters: listMatters(SIM_OWNER, { status: null, limit: 300 }) });
  plan.limit = Math.min(100, Number(req.query.limit) || 25);
  const result = searchDocuments(SIM_OWNER, plan);
  res.json({ documents: result.docs.map((d) => ({ ...publicDoc(d), score: d._score, snippet: d._snippet })), total: result.total, interpretation: result.explanation, suggestion: result.suggestion });
});

api.get('/export/csv', async (_req, res) => {
  const docs = listDocuments(SIM_OWNER, { limit: 5000, order: 'created_at DESC' });
  const rows = [
    ['ID', 'Title', 'Type', 'Date', 'Case', 'Court', 'Case no.', 'Parties', 'Pages', 'Tags', 'Added'],
    ...docs.map((d) => [
      d.id, d.title, d.type_label || d.doc_type, d.doc_date || '', d.matter_id || '', d.court || '',
      d.case_number || '', (d.parties || []).map((p) => p.name).join('; '), d.pages || '',
      (d.tags || []).join('; '), String(d.created_at).slice(0, 10),
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="library-${toIso(new Date())}.csv"`);
  res.send(csv);
});

api.get('/backup', async (_req, res) => {
  const file = path.join(config.exportsDir, `backup-${toIso(new Date())}.db`);
  try {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── simulator: the same brain, driven from the dashboard ───────────── */

function serialisePayload(payload) {
  if (!payload) return null;
  if (payload.text) return { kind: 'text', text: payload.text, at: new Date().toISOString() };
  if (payload.document) {
    const rel = path.relative(config.dataDir, payload.document.path);
    if (rel.startsWith('..')) return null;
    return {
      kind: 'document',
      filename: payload.document.filename || path.basename(payload.document.path),
      caption: payload.document.caption || '',
      url: `/api/file?p=${encodeURIComponent(rel)}`,
      mime: payload.document.mime || 'application/octet-stream',
      at: new Date().toISOString(),
    };
  }
  if (payload.image) {
    const rel = path.relative(config.dataDir, payload.image.path);
    return { kind: 'image', url: `/api/file?p=${encodeURIComponent(rel)}`, caption: payload.image.caption || '', at: new Date().toISOString() };
  }
  return null;
}

api.post('/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const out = [];
  const send = async (payload) => {
    const serialised = serialisePayload(payload);
    if (serialised) out.push(serialised);
  };
  logMessage({ owner: SIM_OWNER, direction: 'in', kind: 'text', body: text });
  try {
    await handleText({ owner: SIM_OWNER, text, send });
  } catch (err) {
    log.error('simulator text failed:', err.stack || err.message);
    out.push({ kind: 'text', text: '⚠️ Something went wrong. Nothing was lost — try again.', at: new Date().toISOString() });
  }
  for (const message of out) {
    logMessage({ owner: SIM_OWNER, direction: 'out', kind: message.kind, body: message.text || message.filename || message.caption });
  }
  res.json({ messages: out });
});

api.post('/chat/upload', async (req, res) => {
  try {
    const { fields, files } = await parseMultipart(req);
    const file = files[0];
    const out = [];
    const send = async (payload) => {
      const serialised = serialisePayload(payload);
      if (serialised) out.push(serialised);
    };
    logMessage({ owner: SIM_OWNER, direction: 'in', kind: 'document', body: file.filename });
    await handleMedia({
      owner: SIM_OWNER,
      message: {
        type: /^image\//.test(file.mime) ? 'image' : 'document',
        filename: file.filename,
        mime: file.mime,
        caption: fields.caption || '',
      },
      send,
      downloadMedia: async () => file.buffer,
    });
    for (const message of out) {
      logMessage({ owner: SIM_OWNER, direction: 'out', kind: message.kind, body: message.text || message.filename });
    }
    res.json({ messages: out });
  } catch (err) {
    log.warn('simulator upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

api.get('/chat/history', (_req, res) => {
  const rows = messagesWith(SIM_OWNER, 60);
  res.json({
    messages: rows.map((m) => ({
      direction: m.direction,
      kind: m.kind,
      text: m.body,
      at: m.created_at,
      meta: m.meta,
    })),
  });
});

api.get('/codes', (_req, res) => {
  res.json({ startedAt: startedAt.toISOString(), docs: stats(SIM_OWNER).total });
});

app.use('/api', api);

// The downloadable single-file app (built by `npm run build:offline`).
// /offline opens it in the browser; /download saves it, so it can be kept on a
// phone and used with no server at all.
const OFFLINE_FILE = path.join(ROOT, 'downloads', 'X-Document-Manager.html');
const offlineReady = () => fs.existsSync(OFFLINE_FILE);

app.get('/offline', (_req, res) => {
  if (!offlineReady()) return res.status(404).type('text').send('Offline build missing — run: npm run build:offline');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(OFFLINE_FILE);
});

app.get('/download', (_req, res) => {
  if (!offlineReady()) return res.status(404).type('text').send('Offline build missing — run: npm run build:offline');
  res.download(OFFLINE_FILE, 'X-Document-Manager.html');
});

// Public liveness probe — used by hosting health checks and mobile bookmarklets.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, app: 'x-document-manager', startedAt: startedAt.toISOString() });
});

/* ───────────────────────────── static UI ───────────────────────────── */

const publicDir = path.join(ROOT, 'public');
app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: '1h',
  // The shell, the worker and the manifest must always revalidate, otherwise a
  // phone can keep an old UI pinned in its cache for an hour after an update.
  setHeaders: (res, filePath) => {
    if (/(?:index\.html|sw\.js|manifest\.webmanifest)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* ───────────────────────────── reminders ───────────────────────────── */

async function reminderTick() {
  const todayIso = toIso(new Date());
  const due = dueDeadlines(todayIso);
  for (const deadline of due) {
    const owner = deadline.owner || config.ownerPhone;
    if (deadline.owner && !isOwner(deadline.owner) && deadline.owner !== SIM_OWNER) continue;
    const diff = daysBetween(deadline.due_date);
    const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
    const text = `⏰ *Reminder* — ${deadline.title}\nDue ${formatDate(deadline.due_date, { long: true })} (${when}).`;
    if (whatsappConfigured() && config.ownerPhone) {
      try {
        const { sendText } = await import('./whatsapp/cloud.js');
        await sendText(config.ownerPhone, text);
      } catch (err) {
        log.warn('reminder send failed:', err.message);
      }
    }
    markDeadlineNotified(deadline.id);
    log.info(`reminder: ${deadline.title} due ${deadline.due_date}`);
  }

  // Morning agenda at 08:00 (server local time).
  const now = new Date();
  if (now.getHours() === 8 && now.getMinutes() < 2) {
    const lastDigest = setting('lastDigest', '');
    if (lastDigest !== todayIso) {
      setSetting('lastDigest', todayIso);
      const open = listDeadlines(SIM_OWNER, { limit: 10 });
      if (open.length && whatsappConfigured() && config.ownerPhone) {
        const lines = ['☀️ *Today in your practice*', ''];
        open.forEach((d, i) => lines.push(`${i + 1}. ${d.title} — ${formatDate(d.due_date)}`));
        try {
          const { sendText } = await import('./whatsapp/cloud.js');
          await sendText(config.ownerPhone, lines.join('\n'));
        } catch (err) {
          log.warn('digest failed:', err.message);
        }
      }
    }
  }
}

setInterval(() => { reminderTick().catch((err) => log.warn('reminder tick failed:', err.message)); }, 60_000).unref?.();

/* ───────────────────────────── start ───────────────────────────── */

const server = app.listen(config.port, config.host, () => {
  const s = stats(SIM_OWNER);
  const line = '─'.repeat(66);
  console.log(`\n${line}`);
  console.log('  X DOCUMENT MANAGER — your documents, on demand');
  console.log(line);
  console.log(`  Dashboard   http://localhost:${config.port}`);
  console.log(`  Access code ${config.dashboardToken}`);
  console.log(`  Documents   ${s.total} filed · ${s.matters} cases · ${plural(s.needsReview, 'needs review')}`);
  console.log(`  WhatsApp    ${whatsappConfigured() ? `connected (phone id ${config.whatsapp.phoneNumberId})` : 'not connected — opens in demo mode (dashboard chat works)'}`);
  console.log(`  AI upgrade  ${llmConfigured() ? `on (${config.llm.provider})` : 'off — smart local analysis in use'}`);
  console.log(`  Data folder ${config.dataDir}`);
  console.log(line);
  console.log('  Tip: open the dashboard, use the chat tab, and send your first document.\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref?.();
  });
}

process.on('unhandledRejection', (reason) => log.error('unhandled rejection:', reason?.stack || reason));

export { app, server };
