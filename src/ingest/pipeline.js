import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { log } from '../util/logger.js';
import { extractText, extensionOf, kindOf } from '../text/extract.js';
import { ocrImage, ocrAvailable } from '../text/ocr.js';
import { analyzeDocument } from '../analysis/analyzer.js';
import { llmConfigured } from '../config.js';
import { llmEnrichDocument, llmVisionExtract } from '../analysis/llm.js';
import { canonicalFileName, libraryFolder, ownerSlug } from './naming.js';
import { createDocument, updateDocument, getDocumentBySha, getDocument, findMatterByName, createMatter, listMatters, addDeadline } from '../store/repo.js';
import { TYPE_BY_ID } from '../analysis/taxonomy.js';
import { collapse, normalize } from '../util/text.js';
import { toIso, daysBetween } from '../util/dates.js';

const MAX_TEXT_CHARS = 400_000;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeExt(filename, mime) {
  const ext = extensionOf(filename, mime);
  return ext && ext.length <= 9 ? ext : '.bin';
}

/** Best matter for a document, based on party names. */
export function suggestMatters(owner, parties = [], limit = 3) {
  const matters = listMatters(owner, { status: 'active', limit: 200 });
  if (!matters.length || !parties.length) return [];
  const tokens = [...new Set(
    parties.flatMap((p) => normalize(typeof p === 'string' ? p : p.name || '')
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3)),
  )];
  const scored = matters.map((m) => {
    const hay = normalize(`${m.title} ${m.client || ''} ${m.opposite || ''} ${m.case_number || ''}`);
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 1;
    return { matter: m, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

async function readImageText({ buffer, filename, mime }) {
  let text = '';
  let method = 'none';
  const ocr = await ocrAvailable();
  if (ocr) {
    const result = await ocrImage(buffer, { filename });
    if (result.text && result.text.trim().length > 15) {
      text = result.text.trim();
      method = result.method;
    }
  }
  if (!text && llmConfigured()) {
    const vision = await llmVisionExtract({
      base64: buffer.toString('base64'),
      mime: mime || 'image/jpeg',
      hint: `File name: ${filename}. Transcribe faithfully.`,
    });
    if (vision) { text = vision; method = 'llm-vision'; }
  }
  return { text, method };
}

function buildPageMeta(pageTexts) {
  const meta = [];
  let offset = 0;
  for (const page of pageTexts) {
    meta.push({ page: page.page, start: offset, end: offset + page.text.length });
    offset += page.text.length + 2; // joined with "\n\n"
  }
  return meta;
}

/**
 * Ingest a file end-to-end.
 * @returns {Promise<{doc:object, analysis:object, duplicate:boolean, matterSuggestions:Array, warnings:string[]}>}
 */
export async function ingestFile({
  owner,
  buffer,
  filename = 'document',
  mime = 'application/octet-stream',
  caption = '',
  source = 'upload',
  hints = {},
  matterId = null,
  autoFile = false,
  skipLlm = false,
}) {
  if (!buffer || !buffer.length) throw new Error('Empty file');
  const hash = sha256(buffer);
  const duplicate = getDocumentBySha(owner, hash);
  if (duplicate) {
    return { doc: duplicate, analysis: null, duplicate: true, matterSuggestions: [], warnings: ['This exact file is already saved.'] };
  }

  const ext = safeExt(filename, mime);
  const kind = kindOf(ext, mime);
  const tempFile = path.join(config.importsDir, `${hash.slice(0, 16)}${ext}`);
  await fs.writeFile(tempFile, buffer);

  // 1. Read the text.
  const extraction = await extractText({ buffer, filename, mime });
  let text = extraction.text || '';
  let method = extraction.method;
  const warnings = [...(extraction.warnings || [])];

  if (kind === 'image' || (extraction.scanned && text.length < 30)) {
    if (kind === 'image') {
      const imageText = await readImageText({ buffer, filename, mime });
      if (imageText.text) {
        text = imageText.text;
        method = imageText.method;
        warnings.length = 0;
      }
    }
  }

  text = text.slice(0, MAX_TEXT_CHARS);
  const pageMeta = buildPageMeta(extraction.pageTexts || []);

  // 2. Understand it.
  const analysis = analyzeDocument({
    text,
    filename,
    caption,
    mime,
    pageTexts: extraction.pageTexts || [],
    hints,
  });

  // 3. Optional AI pass.
  let llm = null;
  if (!skipLlm && llmConfigured() && text.length > 120) {
    llm = await llmEnrichDocument({ text, filename, base: analysis });
    if (llm) {
      analysis.llmUsed = true;
      if (llm.summary && llm.summary.length > 40) analysis.summary = llm.summary;
      if (Array.isArray(llm.keyPoints) && llm.keyPoints.length) analysis.keyPoints = llm.keyPoints.slice(0, 6);
      if (llm.title) analysis.title = String(llm.title).slice(0, 100);
      if (llm.docType && TYPE_BY_ID.has(llm.docType)) {
        analysis.docType = llm.docType;
        analysis.typeLabel = TYPE_BY_ID.get(llm.docType).label;
        analysis.typeConfidence = Math.max(analysis.typeConfidence, 0.9);
      }
      if (llm.docDate && /^\d{4}-\d{2}-\d{2}$/.test(llm.docDate)) analysis.docDate = llm.docDate;
      if (Array.isArray(llm.parties) && llm.parties.length) {
        analysis.parties = llm.parties
          .filter((p) => p && p.name)
          .slice(0, 8)
          .map((p) => ({ name: String(p.name).slice(0, 90), role: p.role ? String(p.role) : null }));
      }
      if (Array.isArray(llm.amounts) && llm.amounts.length && !analysis.amounts.length) {
        analysis.amounts = llm.amounts.filter((a) => a && a.raw).map((a) => ({ raw: String(a.raw), value: null, label: a.label || 'Amount', context: '' }));
      }
      if (llm.court) analysis.court = String(llm.court).slice(0, 120);
      if (llm.caseNumber) analysis.caseNumber = String(llm.caseNumber).slice(0, 60);
      if (Array.isArray(llm.risks) && llm.risks.length) {
        for (const risk of llm.risks.slice(0, 3)) analysis.flags.push({ level: 'info', message: String(risk).slice(0, 200) });
      }
      if (Array.isArray(llm.tags) && llm.tags.length) {
        analysis.tags = [...new Set([...analysis.tags, ...llm.tags.map((t) => String(t).toLowerCase().slice(0, 30))])].slice(0, 14);
      }
    }
  }

  // 4. Which case does it belong to?
  let matter = matterId ? findMatterFor(owner, matterId) : null;
  let matterAuto = false;
  const suggestions = suggestMatters(owner, analysis.parties);
  if (!matter && autoFile && suggestions.length && suggestions[0].score >= 2) {
    matter = suggestions[0].matter;
    matterAuto = true;
  }
  if (!matter && !suggestions.length && analysis.parties.length && autoFile) {
    // Create a clean new matter automatically when the names are obvious.
    const named = analysis.parties.filter((p) => p.name);
    if (named.length >= 2) {
      matter = createMatter(owner, {
        title: `${shortName(named[0].name)} v ${shortName(named[1].name)}`,
        client: named[0].name,
        opposite: named[1].name,
        case_number: analysis.caseNumber || null,
        court: analysis.court || null,
        practice_area: TYPE_BY_ID.get(analysis.docType)?.area || null,
        notes: 'Created automatically when you filed the first document.',
      });
      matterAuto = true;
    }
  }

  // 5. Decide where it lives.
  const seqId = hints.previewId || null;
  const extForFile = ext === '.bin' ? '.pdf' : ext;
  const tempId = seqId || 'PENDING';
  const relFolder = libraryFolder({
    ownerSlug: ownerSlug(owner),
    matter,
    docType: analysis.docType,
  });
  const fileName = canonicalFileName({
    docDate: analysis.docDate,
    title: analysis.title,
    id: tempId,
    ext: extForFile,
  });
  const absFolder = path.join(config.libraryDir, relFolder);
  await fs.mkdir(absFolder, { recursive: true });

  // 6. Save the record first so the id is final, then move the file into place.
  const doc = createDocument({
    owner,
    matter_id: matter?.id || null,
    title: analysis.title,
    doc_type: analysis.docType,
    type_label: analysis.typeLabel,
    type_confidence: analysis.typeConfidence,
    doc_date: analysis.docDate,
    date_source: analysis.dateSource,
    court: analysis.court,
    case_number: analysis.caseNumber,
    original_name: filename.slice(0, 200),
    mime,
    size: buffer.length,
    pages: extraction.pageCount || null,
    sha256: hash,
    status: text.length ? 'filed' : 'needs_review',
    source,
    text,
    text_source: method,
    summary: analysis.summary,
    key_points: analysis.keyPoints,
    parties: analysis.parties,
    amounts: analysis.amounts,
    statutes: analysis.statutes,
    deadlines_json: analysis.deadlines,
    clauses: analysis.clauses,
    tags: analysis.tags,
    entities: {
      references: analysis.references,
      identifiers: analysis.identifiers,
      blanks: analysis.blanks,
      tenure: analysis.tenure,
      pageMeta,
      flags: analysis.flags,
      caughtBy: analysis.caughtBy,
      llmUsed: Boolean(analysis.llmUsed),
      warnings,
    },
    confidence: analysis.confidence,
    needs_review: !text.length || analysis.confidence < 0.45,
    language: analysis.language,
  });

  const finalName = canonicalFileName({
    docDate: analysis.docDate,
    title: analysis.title,
    id: doc.id,
    ext: extForFile,
  });
  const finalPath = path.join(absFolder, finalName);
  await fs.rename(tempFile, finalPath).catch(async () => {
    await fs.copyFile(tempFile, finalPath);
    await fs.unlink(tempFile).catch(() => {});
  });

  const relPath = path.relative(config.dataDir, finalPath);
  const updated = updateDocument(doc.id, { file_name: finalName, rel_path: relPath });

  // 7. Sidecar text file next to the document — readable outside the app.
  if (text.length > 40) {
    const sidecar = path.join(absFolder, `${path.basename(finalName, path.extname(finalName))}.txt`);
    const header = [
      `X DOCUMENT MANAGER — ${doc.id}`,
      `Title: ${analysis.title}`,
      `Type: ${analysis.typeLabel}`,
      `Date: ${analysis.docDate || 'unknown'}`,
      `Parties: ${analysis.parties.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ') || '—'}`,
      analysis.court ? `Court: ${analysis.court}` : '',
      analysis.caseNumber ? `Case no.: ${analysis.caseNumber}` : '',
      '',
      'SUMMARY',
      analysis.summary,
      '',
      'DOCUMENT TEXT',
      text,
    ].filter(Boolean).join('\n');
    fs.writeFile(sidecar, header, 'utf8').catch(() => {});
  }

  // 8. Remember any dates that matter.
  if (text.length) {
    const todayIso = toIso(new Date());
    const keep = analysis.deadlines
      .filter((d) => d.due_date && (daysBetween(d.due_date, todayIso) ?? -1) >= -1)
      .slice(0, 3);
    for (const deadline of keep) {
      addDeadline(owner, {
        document_id: doc.id,
        matter_id: matter?.id || null,
        kind: deadline.kind === 'hearing' ? 'hearing' : 'deadline',
        title: `${deadline.title} — ${doc.id}`,
        detail: deadline.detail,
        due_date: deadline.due_date,
        remind_days: deadline.kind === 'hearing' ? 2 : 3,
      });
    }
  }

  log.info(`filed ${doc.id} (${analysis.typeLabel}) for ${owner}: ${finalName}`);
  return {
    doc: updated,
    analysis,
    duplicate: false,
    matter,
    matterAuto,
    matterSuggestions: suggestions.filter((s) => s.matter.id !== matter?.id),
    warnings,
  };
}

function shortName(name) {
  return collapse(String(name || '').replace(/^(?:Mr|Mrs|Ms|Dr|Shri|Smt|Late|M\/s|Messrs)\.?\s+/i, '')).slice(0, 40);
}

function findMatterFor(owner, id) {
  const matters = listMatters(owner, { status: null, limit: 500 });
  return matters.find((m) => m.id === String(id).toUpperCase()) || null;
}

/** Save generated text (drafts, notes) as a document in the library. */
export async function ingestGeneratedText({
  owner, text, title, docType = 'draft', source = 'generated', matterId = null, caption = '',
}) {
  const buffer = Buffer.from(text, 'utf8');
  const analysis = analyzeDocument({ text, filename: `${title}.txt`, caption, hints: { docType } });
  analysis.title = title || analysis.title;
  analysis.summary = caption || analysis.summary;

  const doc = createDocument({
    owner,
    matter_id: matterId,
    title: analysis.title,
    doc_type: docType,
    type_label: TYPE_BY_ID.get(docType)?.label || 'Draft',
    type_confidence: 0.99,
    doc_date: toIso(new Date()),
    date_source: 'created',
    original_name: `${title}.txt`,
    mime: 'text/plain',
    size: buffer.length,
    sha256: sha256(buffer),
    status: 'filed',
    source,
    text,
    text_source: 'generated',
    summary: analysis.summary,
    key_points: analysis.keyPoints,
    parties: analysis.parties,
    amounts: analysis.amounts,
    statutes: analysis.statutes,
    deadlines_json: [],
    clauses: analysis.clauses,
    tags: [...new Set([...(analysis.tags || []), 'draft'])],
    entities: { flags: analysis.flags, pageMeta: [] },
    confidence: 0.99,
    needs_review: false,
    language: 'en',
  });

  const relFolder = libraryFolder({ ownerSlug: ownerSlug(owner), matter: null, docType });
  const absFolder = path.join(config.libraryDir, relFolder);
  await fs.mkdir(absFolder, { recursive: true });
  const fileName = canonicalFileName({ docDate: toIso(new Date()), title: analysis.title, id: doc.id, ext: '.txt' });
  const absPath = path.join(absFolder, fileName);
  await fs.writeFile(absPath, text, 'utf8');
  return updateDocument(doc.id, { file_name: fileName, rel_path: path.relative(config.dataDir, absPath) });
}

/** Re-run analysis after the user corrects something (type, date, matter). */
export async function reprocessDocument(owner, id, overrides = {}) {
  const doc = getDocument(owner, id);
  if (!doc) return null;
  const analysis = analyzeDocument({
    text: doc.text || '',
    filename: doc.original_name || '',
    caption: '',
    mime: doc.mime || '',
    matterName: overrides.matterName || '',
    hints: {
      docType: overrides.docType || undefined,
      docDate: overrides.docDate || undefined,
    },
  });
  const updated = updateDocument(doc.id, {
    title: overrides.title || analysis.title,
    doc_type: analysis.docType,
    type_label: analysis.typeLabel,
    type_confidence: analysis.typeConfidence,
    doc_date: analysis.docDate,
    court: analysis.court,
    case_number: analysis.caseNumber,
    summary: analysis.summary,
    key_points: analysis.keyPoints,
    parties: analysis.parties,
    amounts: analysis.amounts,
    statutes: analysis.statutes,
    clauses: analysis.clauses,
    tags: analysis.tags,
    needs_review: doc.needs_review && !analysis.typeConfidence,
    confidence: analysis.confidence,
  });
  return syncDocFile(owner, doc.id);
}

/** Keep the file on disk in step with the record (title, date, type, case). */
export async function syncDocFile(owner, docId) {
  const doc = getDocument(owner, docId);
  if (!doc || !doc.rel_path) return doc;
  const matter = doc.matter_id ? findMatterFor(owner, doc.matter_id) : null;
  const ext = path.extname(doc.file_name || doc.rel_path || '').toLowerCase() || '.pdf';
  const folder = libraryFolder({ ownerSlug: ownerSlug(owner), matter, docType: doc.doc_type });
  const name = canonicalFileName({ docDate: doc.doc_date, title: doc.title, id: doc.id, ext });
  const absFolder = path.join(config.libraryDir, folder);
  await fs.mkdir(absFolder, { recursive: true });
  const newAbs = path.join(absFolder, name);
  const oldAbs = path.join(config.dataDir, doc.rel_path);
  if (oldAbs === newAbs) return doc;

  const move = async (from, to) => {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to).catch(async () => {
      await fs.copyFile(from, to);
      await fs.unlink(from).catch(() => {});
    });
  };

  if (await exists(oldAbs)) await move(oldAbs, newAbs);

  // Companion files (editable Word copy, extracted text) follow the PDF.
  const oldBase = oldAbs.replace(/\.[a-z0-9]+$/i, '');
  const newBase = newAbs.replace(/\.[a-z0-9]+$/i, '');
  const entities = { ...(doc.entities || {}) };
  let entitiesChanged = false;
  for (const companion of ['.docx', '.txt']) {
    if (!entities[companion.slice(1)]) continue;
    const companionAbs = path.join(config.dataDir, entities[companion.slice(1)]);
    if (!(await exists(companionAbs))) continue;
    const target = `${newBase}${companion}`;
    await move(companionAbs, target);
    entities[companion.slice(1)] = path.relative(config.dataDir, target);
    entitiesChanged = true;
  }
  if (await exists(`${oldBase}.txt`) && !entities.txt) {
    await move(`${oldBase}.txt`, `${newBase}.txt`);
  }

  return updateDocument(doc.id, {
    rel_path: path.relative(config.dataDir, newAbs),
    file_name: name,
    ...(entitiesChanged ? { entities } : {}),
  });
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
