import fs from 'node:fs/promises';
import path from 'node:path';
import { config, llmConfigured } from '../config.js';
import { log } from '../util/logger.js';
import { interpret } from './interpreter.js';
import { getSession, updateSession, pushUndo, popUndo } from './session.js';
import {
  getDocument, getMatter, listMatters, listDocuments, recentDocuments, stats, docTypeCounts,
  docsForMatter, findMatterByName, createMatter, updateDocument, updateMatter, listDeadlines,
  addDeadline, completeDeadline, createBundle as _createBundleRecord, getBundle, listBundles,
  messagesWith, countDocuments,
} from '../store/repo.js';
import { searchDocuments, bestPassage, findRelated } from '../search/search.js';
import { parseQuery } from '../search/queryParser.js';
import { classifyDocument } from '../analysis/classify.js';
import { ingestFile, syncDocFile } from '../ingest/pipeline.js';
import { importEcourtsUpload } from '../ingest/ecourts.js';
import { handleEcourts, ecourtsCard } from './ecourts.js';
import { ecourtsSummary } from '../store/ecourts.js';
import { buildBundle, absolutePathOf } from '../bundle/builder.js';
import { createDraftDocument, DRAFT_TEMPLATES } from '../draft/generator.js';
import { llmAnswerQuestion } from '../analysis/llm.js';
import { archiveDelete, restoreArchived, purgeArchived } from '../store/trash.js';
import { TYPE_BY_ID } from '../analysis/taxonomy.js';
import {
  docCard, filedCard, resultsMessage, matterListMessage, caseOverview, deadlineLine,
  helpMessage, formatBytes, cleanSnippet, docListLine, shortSummary,
} from './formatters.js';
import { buildPdf } from '../util/pdf-writer.js';
import { pdfBlocksFromText } from '../draft/generator.js';
import { formatDate, toIso, daysBetween, relativeDay } from '../util/dates.js';
import { clip, collapse, plural, slugify, normalize } from '../util/text.js';
import { formatIndianCurrency } from '../util/numberWords.js';

const MAX_CHUNK = 3400;

async function sendText(send, text) {
  const str = String(text ?? '').trim();
  if (!str) return;
  if (str.length <= MAX_CHUNK) {
    await send({ text: str });
    return;
  }
  const lines = str.split('\n');
  let buffer = '';
  for (const line of lines) {
    if ((buffer + line).length > MAX_CHUNK) {
      await send({ text: buffer.trim() });
      buffer = '';
    }
    buffer += `${line}\n`;
  }
  if (buffer.trim()) await send({ text: buffer.trim() });
}

async function sendDocFile(send, doc, { caption = '', format = null } = {}) {
  let abs = absolutePathOf(doc);
  if (format === 'docx') {
    const docxRel = doc.entities?.docx;
    if (docxRel) {
      const docxAbs = path.join(config.dataDir, docxRel);
      if (await exists(docxAbs)) abs = docxAbs;
    }
  }
  if (!abs || !(await exists(abs))) {
    await sendText(send, `⚠️ The file for ${doc.id} is not on disk. The record is safe — send the document again and I will re-attach it.`);
    return false;
  }
  await send({
    document: {
      path: abs,
      filename: path.basename(abs),
      caption: caption || `${doc.id} · ${clip(doc.title, 80)}`,
      mime: mimeOf(abs),
    },
  });
  return true;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.zip': 'application/zip',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
  }[ext] || 'application/octet-stream';
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function ownerMatters(owner) {
  return listMatters(owner, { status: null, limit: 300 });
}

/* ───────────────────────────── media ───────────────────────────── */

export async function handleMedia({ owner, message, send, downloadMedia, phoneName = '' }) {
  const filename = message.filename || (message.type === 'image' ? `photo-${Date.now()}.jpg` : 'document');
  const caption = message.caption || '';
  await sendText(send, `📥 Reading *${clip(filename, 60)}*…`);
  let buffer;
  try {
    buffer = await downloadMedia(message);
  } catch (err) {
    log.error('media download failed', err.message);
    await sendText(send, '⚠️ WhatsApp did not let me download that file. Please try sending it again.');
    return;
  }

  // An eCourts .txt dump is remembered permanently instead of being filed as a paper.
  if (/\.txt$/i.test(filename) || /^text\/plain/i.test(message.mime || '')) {
    try {
      const imported = importEcourtsUpload({ owner, buffer, filename });
      if (imported.handled) {
        await sendText(send, imported.message);
        return;
      }
    } catch (err) {
      log.warn('ecourts import failed:', err.message);
    }
  }

  try {
    const result = await ingestFile({
      owner,
      buffer,
      filename,
      mime: message.mime || 'application/octet-stream',
      caption,
      source: message.type === 'image' ? 'photo' : 'upload',
    });

    if (result.duplicate) {
      const doc = result.doc;
      await sendText(send, `📎 This exact file is already in your library as *${doc.id}* — ${clip(doc.title, 70)}.\n\nReply *${doc.id}* to get the file back.`);
      return;
    }

    let { doc, matter } = result;
    let matterAuto = result.matterAuto;

    // Strong automatic match beats asking.
    if (!matter && result.matterSuggestions?.length) {
      const top = result.matterSuggestions[0];
      if (top.score >= 2) {
        doc = updateDocument(doc.id, { matter_id: top.matter.id });
        matter = top.matter;
        matterAuto = true;
      }
    }

    const session = getSession(owner);
    await sendText(send, filedCard(doc, {
      matter,
      matterAuto,
      suggestions: result.matterSuggestions || [],
      warnings: result.warnings || [],
    }));

    updateSession(owner, {
      lastDocId: doc.id,
      lastMatterId: matter?.id || session.lastMatterId,
      pending: matter ? null : {
        kind: 'matter_choice',
        docId: doc.id,
        options: (result.matterSuggestions || []).map((s) => s.matter.id),
      },
    });

    if (matterAuto) {
      await sendText(send, `_Wrong case? Reply_ \`move ${doc.id} to <case name>\` _or_ \`skip\`.`);
    }
  } catch (err) {
    log.error('ingest failed:', err.stack || err.message);
    await sendText(send, '⚠️ Something went wrong while reading that file. It was not saved. Please try once more.');
  }
}

/* ───────────────────────────── text ───────────────────────────── */

export async function handleText({ owner, text, send, phoneName = '' }) {
  const session = getSession(owner);
  const intent = interpret(text, {
    pending: session.pending,
    hasResults: session.lastResults.length > 0,
  });

  // A free-text answer while we are waiting to file a document into a case.
  if (session.pending?.kind === 'matter_choice' && intent.intent === 'search') {
    const matter = findMatterByName(owner, text) || ownerMatters(owner).find((m) => m.title.toLowerCase() === text.toLowerCase().trim());
    if (matter) {
      await assignToMatter({ owner, docId: session.pending.docId, matter, send });
      return;
    }
  }
  if (session.pending?.kind === 'remind' && intent.intent === 'search') {
    await createReminder({ owner, send, title: session.pending.title, due: null, remindDays: 1, raw: text });
    return;
  }

  try {
    switch (intent.intent) {
      case 'empty':
        return;
      case 'greeting': {
        if (!session.introShown) {
          updateSession(owner, { introShown: true });
          await sendText(send, `${helpMessage({ ownerName: config.ownerName ? config.ownerName.split(/\s+/).pop() : '' })}\n\n_Send me your first document to begin._`);
        } else {
          await sendText(send, '👋 Ready. Send a document, or tell me what you are looking for.');
        }
        return;
      }
      case 'help':
        updateSession(owner, { introShown: true });
        return sendText(send, helpMessage({ ownerName: config.ownerName ? config.ownerName.split(/\s+/).pop() : '' }));
      case 'thanks':
        return sendText(send, '🙏 Anytime. Your files are all in order.');
      case 'stats':
        return sendStats({ owner, send });
      case 'ecourts':
        await sendText(send, '⚖️ Looking in your remembered eCourts data…');
        return handleEcourts({ owner, intent: 'ecourts', query: intent.query || '', send });
      case 'hearings':
        return handleEcourts({ owner, intent: 'hearings', send });
      case 'ecourts_case':
        return handleEcourts({ owner, intent: 'ecourts_case', query: intent.query, send });
      case 'list_cases':
        return sendText(send, matterListMessage(ownerMatters(owner).filter((m) => m.status === 'active'), { totalDocs: stats(owner).total }));
      case 'new_case':
        return createNewCase({ owner, title: intent.title, send });
      case 'open_case':
        return openCase({ owner, index: intent.index, query: intent.query, send, session });
      case 'open_doc':
        return openDoc({ owner, docId: intent.id, send, session });
      case 'open_bundle':
        return sendBundleById({ owner, id: intent.id, send });
      case 'select':
        return handleSelection({ owner, index: intent.index, send, session });
      case 'more':
        return showMore({ owner, send, session });
      case 'search':
        return handleSearch({ owner, query: intent.query || text, send, session });
      case 'question':
        return answerQuestion({ owner, question: intent.question || text, send, session });
      case 'recent':
        return sendRecent({ owner, send, session });
      case 'deadlines':
        return sendDeadlines({ owner, send, session });
      case 'remind':
        return createReminder({ owner, send, due: intent.due, title: intent.title, remindDays: intent.remindDays, raw: text, session });
      case 'bundle':
        return bundleCase({ owner, target: intent.target, send, session });
      case 'index':
        return sendCaseIndex({ owner, index: intent.index, send, session });
      case 'delete':
        return askDelete({ owner, id: intent.id, send, session });
      case 'confirm':
        return runConfirmed({ owner, send, session });
      case 'cancel':
        updateSession(owner, { pending: null });
        return sendText(send, 'Okay, nothing changed.');
      case 'skip':
        updateSession(owner, { pending: null });
        return sendText(send, 'Leaving it unfiled. It is still searchable — type `unfiled` to find it later.');
      case 'rename':
        return renameDoc({ owner, id: intent.id, title: intent.title, send });
      case 'tag':
        return tagDoc({ owner, id: intent.id, tags: intent.tags, send });
      case 'move':
        return moveDoc({ owner, id: intent.id, target: intent.target, send });
      case 'set_type':
        return setDocType({ owner, id: intent.id, typeText: intent.type, send, session });
      case 'set_date':
        return setDocDate({ owner, id: intent.id, date: intent.date, send });
      case 'add_note':
        return addNote({ owner, id: intent.id, note: intent.note, send });
      case 'undo':
        return undoLast({ owner, send, session });
      case 'export':
        return exportCsv({ owner, send });
      case 'draft':
        return makeDraft({ owner, templateId: intent.templateId, instruction: intent.instruction, send, session });
      case 'draft_pick':
        return pickDraftTemplate({ owner, instruction: intent.instruction, send, session });
      case 'send_file':
        return sendFileVersion({ owner, id: intent.id, format: intent.format, send, session });
      case 'mark_done':
        return markDeadlineDone({ owner, index: intent.index, send });
      default:
        return sendText(send, 'I did not quite catch that. Type *help* to see what I can do.');
    }
  } catch (err) {
    log.error('handler error:', err.stack || err.message);
    await sendText(send, '⚠️ Something went wrong on my side. Nothing was lost. Try again in a moment, or type *help*.');
  }
}

/* ───────────────────────────── actions ───────────────────────────── */

async function openDoc({ owner, docId, send, session }) {
  const doc = getDocument(owner, docId);
  if (!doc) {
    await sendText(send, `I cannot find *${docId}*. Type *cases* to look around, or search by name.`);
    return;
  }
  const matter = doc.matter_id ? getMatter(doc.matter_id) : null;
  const related = findRelated(owner, doc, 3).filter((d) => d.id !== doc.id);
  await sendText(send, docCard(doc, { matter, related }));
  await sendDocFile(send, doc, { caption: `${doc.id} · ${clip(doc.title, 70)}` });
  if (related.length) {
    await sendText(send, `📎 Also in this case: ${related.map((d) => `${d.id} (${clip(d.title, 40)})`).join(', ')}.\nSay *bundle* to compile the whole case into one zip.`);
  }
  updateSession(owner, { lastDocId: doc.id, lastMatterId: doc.matter_id || session.lastMatterId, lastResults: related.length ? [doc.id, ...related.map((d) => d.id)] : session.lastResults });
}

async function handleSearch({ owner, query, send, session, forceMatterId = null }) {
  const plan = parseQuery(query, { matters: ownerMatters(owner) });
  if (plan.docId && /^D\d+$/.test(plan.docId)) return openDoc({ owner, docId: plan.docId, send, session });

  if (plan.matterAmbiguous && !forceMatterId && plan.matterCandidates?.length > 1) {
    const matters = plan.matterCandidates
      .map((c) => getMatter(c.id))
      .filter(Boolean)
      .slice(0, 4);
    const lines = [`Two of your cases match “${clip(query, 40)}”. Which one?`, ''];
    matters.forEach((m, i) => lines.push(`${i + 1}. *${m.title}* (${m.id})`));
    lines.push('', 'Reply with a number.');
    updateSession(owner, { pending: { kind: 'case_pick', options: matters.map((m) => m.id), query } });
    await sendText(send, lines.join('\n'));
    return;
  }

  if (forceMatterId) {
    plan.matterId = forceMatterId;
    plan.matterAmbiguous = false;
    plan.lockMatter = true;
  }

  // "show me the Mehta case" with no other words → show the case file itself.
  if (!plan.terms.length && plan.matterId) {
    const matter = getMatter(plan.matterId);
    if (matter) return openCase({ owner, query: matter.id, send, session });
  }

  plan.limit = Math.max(plan.limit, 8);
  const result = searchDocuments(owner, plan);
  const docs = result.docs;

  if (!docs.length) {
    await sendText(send, `🔎 I could not find anything for “${clip(query, 60)}”.\n\nTry fewer words, a party name, a year, or the document id. Type \`recent\` to see the newest files.`);
    return;
  }

  if (docs.length === 1 && plan.terms.length) {
    updateSession(owner, { lastResults: docs.map((d) => d.id), lastQuery: query, lastPage: 0, pending: null });
    await openDoc({ owner, docId: docs[0].id, send, session });
    return;
  }

  updateSession(owner, {
    lastResults: docs.map((d) => d.id),
    lastQuery: query,
    lastPage: 0,
    pending: null,
  });
  await sendText(send, resultsMessage({
    docs, total: result.total, plan, suggestion: result.suggestion, page: 0,
    relaxations: result.relaxations,
  }));
}

async function handleSelection({ owner, index, send, session }) {
  const pending = session.pending;
  if (pending?.kind === 'matter_choice') {
    const optionId = pending.options?.[index];
    if (!optionId) {
      await sendText(send, 'That option is not in the list. Reply with one of the numbers shown, or `skip`.');
      return;
    }
    const matter = getMatter(optionId);
    if (matter) return assignToMatter({ owner, docId: pending.docId, matter, send });
  }
  if (pending?.kind === 'bundle_pick') {
    const matterId = pending.options?.[index];
    const matter = matterId ? getMatter(matterId) : null;
    if (!matter) {
      await sendText(send, 'Please pick one of the numbers shown.');
      return;
    }
    updateSession(owner, { pending: null, lastMatterId: matter.id });
    return bundleCase({ owner, target: matter.id, send, session: getSession(owner) });
  }
  if (pending?.kind === 'case_pick') {
    const matterId = pending.options?.[index];
    if (!matterId) {
      await sendText(send, 'Please reply with one of the numbers shown.');
      return;
    }
    updateSession(owner, { pending: null, lastMatterId: matterId });
    return handleSearch({ owner, query: pending.query, send, session: getSession(owner), forceMatterId: matterId });
  }
  if (pending?.kind === 'draft_pick') {
    const template = pending.options?.[index];
    if (!template) {
      await sendText(send, 'Please pick one of the numbers shown.');
      return;
    }
    return makeDraft({ owner, templateId: template, instruction: pending.instruction, send, session });
  }
  const id = session.lastResults?.[index];
  if (!id) {
    await sendText(send, 'That number is not in the last list. Search again, or type *recent*.');
    return;
  }
  return openDoc({ owner, docId: id, send, session });
}

async function showMore({ owner, send, session }) {
  const ids = session.lastResults || [];
  if (ids.length <= 8) {
    await sendText(send, 'That is everything in this list.');
    return;
  }
  const page = (session.lastPage || 0) + 1;
  const docs = ids.map((id) => getDocument(owner, id)).filter(Boolean);
  if (page * 8 >= docs.length) {
    updateSession(owner, { lastPage: 0 });
    await sendText(send, 'No more results. Send a new search whenever you like.');
    return;
  }
  updateSession(owner, { lastPage: page });
  const lines = [`🔎 *More results* (page ${page + 1})`, ''];
  docs.slice(page * 8, page * 8 + 8).forEach((doc, i) => lines.push(docListLine(doc, page * 8 + i + 1)));
  lines.push('', docs.length > page * 8 + 8 ? 'Reply a number, or *more* again.' : 'Reply a number to open the file.');
  await sendText(send, lines.join('\n'));
}

async function sendRecent({ owner, send, session }) {
  const docs = listDocuments(owner, { limit: 10, order: 'created_at DESC' });
  if (!docs.length) {
    await sendText(send, 'Nothing here yet. Send me your first document — a PDF, Word file or a clear photo.');
    return;
  }
  updateSession(owner, { lastResults: docs.map((d) => d.id), lastPage: 0, lastQuery: '' });
  const lines = ['🕘 *Newest in your library*', ''];
  docs.forEach((doc, i) => lines.push(docListLine(doc, i + 1), `    _added ${relativeDay(String(doc.created_at).slice(0, 10)) || String(doc.created_at).slice(0, 10)}_`));
  lines.push('', 'Reply a number to open one.');
  await sendText(send, lines.join('\n'));
}

async function sendStats({ owner, send }) {
  const s = stats(owner);
  const types = docTypeCounts(owner).slice(0, 5);
  const deadlines = listDeadlines(owner, { limit: 5 });
  const lines = ['📊 *Your library*', ''];
  lines.push(`📄 ${plural(s.total, 'document')} · ${s.pages ? plural(s.pages, 'page') : 'pages not counted'} · ${formatBytes(s.bytes)}`);
  lines.push(`📁 ${plural(s.matters, 'active case')}`);
  if (s.needsReview) lines.push(`⚠️ ${plural(s.needsReview, 'document')} to check`);
  if (types.length) {
    lines.push('', '*By type*');
    types.forEach((t) => lines.push(`• ${t.type_label || t.doc_type} — ${t.n}`));
  }
  if (deadlines.length) {
    lines.push('', '*Next dates*');
    deadlines.forEach((d, i) => lines.push(deadlineLine(d, i + 1)));
  }
  const courts = ecourtsSummary(owner);
  if (courts.total) {
    lines.push(`⚖️ ${plural(courts.total, 'eCourts case')} remembered${courts.nextDate ? ` · next hearing ${formatDate(courts.nextDate)}` : ''}`);
  }
  lines.push('', 'Type `cases`, `deadlines`, `ecourts`, or just ask for a document.');
  await sendText(send, lines.join('\n'));
}

async function createNewCase({ owner, title, send }) {
  let cleanTitle = collapse(title || '');
  if (!cleanTitle) {
    await sendText(send, 'Name the case, for example:\n`new case Sharma v Mehta`\nor\n`new case Sharma — rent dispute`');
    return;
  }
  const existing = findMatterByName(owner, cleanTitle);
  if (existing) {
    await sendText(send, `That looks like the case you already have: *${existing.title}* (${existing.id}). Reply \`case ${existing.id}\` to open it.`);
    return;
  }
  const vsMatch = /^(.+?)\s+(?:v|vs\.?|versus|and)\s+(.+)$/i.exec(cleanTitle);
  const matter = createMatter(owner, {
    title: cleanTitle,
    client: vsMatch ? collapse(vsMatch[1]) : null,
    opposite: vsMatch ? collapse(vsMatch[2]) : null,
    practice_area: null,
  });
  const pending = getSession(owner).pending;
  if (pending?.kind === 'matter_choice' && pending.docId) {
    await assignToMatter({ owner, docId: pending.docId, matter, send });
    return;
  }
  await sendText(send, `📁 Case created: *${matter.title}* (${matter.id}).\n\nSend me the first document, or reply \`move D12 to ${matter.id}\` to put an existing document in it.`);
  updateSession(owner, { lastMatterId: matter.id });
}

async function openCase({ owner, index, query, send, session }) {
  const matters = ownerMatters(owner).filter((m) => m.status === 'active');
  let matter = null;
  if (typeof index === 'number') matter = matters[index];
  else if (query) {
    const raw = String(query).trim();
    if (/^m\d+$/i.test(raw)) matter = getMatter(raw.toUpperCase());
    if (!matter && /^\d+$/.test(raw)) matter = matters[Number(raw) - 1] || null;
    if (!matter) matter = findMatterByName(owner, raw);
  }
  if (!matter) {
    await sendText(send, `I could not find that case. Type \`cases\` to see the list.\n\n${matterListMessage(matters.slice(0, 6), { totalDocs: matters.reduce((sum, m) => sum + (m.doc_count || 0), 0) })}`);
    return;
  }
  const docs = docsForMatter(matter.id);
  updateSession(owner, {
    lastMatterId: matter.id,
    lastResults: docs.map((d) => d.id),
    lastPage: 0,
    pending: null,
  });
  await sendText(send, caseOverview(matter, docs));
}

async function assignToMatter({ owner, docId, matter, send }) {
  const doc = getDocument(owner, docId);
  if (!doc) {
    await sendText(send, `I could not find ${docId}.`);
    return;
  }
  updateDocument(doc.id, { matter_id: matter.id });
  await syncDocFile(owner, doc.id);
  pushUndo(owner, { type: 'matter', docId: doc.id, previous: doc.matter_id || null });
  updateSession(owner, { pending: null, lastMatterId: matter.id });
  await sendText(send, `📁 Filed *${doc.id}* in *${matter.title}* (${matter.id}).\n\nType \`case ${matter.id}\` to see the whole file, or \`bundle\` to compile it into a zip.`);
}

async function moveDoc({ owner, id, target, send }) {
  const doc = id ? getDocument(owner, id) : null;
  if (!doc) {
    await sendText(send, `I could not find ${id || 'that document'}. Include the id, for example \`move D12 to Sharma\`.`);
    return;
  }
  let matter = null;
  const targetRaw = String(target || '').trim();
  if (/^m\d+$/i.test(targetRaw)) matter = getMatter(targetRaw.toUpperCase());
  if (!matter && /^\d+$/.test(targetRaw)) {
    const active = ownerMatters(owner).filter((m) => m.status === 'active');
    matter = active[Number(targetRaw) - 1] || null;
  }
  if (!matter) matter = findMatterByName(owner, targetRaw);
  if (!matter) {
    await sendText(send, `No case matches “${target}”. Type \`cases\` to see the numbered list, or \`new case ${target}\` to create it.`);
    return;
  }
  updateDocument(doc.id, { matter_id: matter.id });
  await syncDocFile(owner, doc.id);
  pushUndo(owner, { type: 'matter', docId: doc.id, previous: doc.matter_id || null });
  await sendText(send, `📁 Moved *${doc.id}* to *${matter.title}* (${matter.id}).`);
}

async function renameDoc({ owner, id, title, send }) {
  const doc = getDocument(owner, id);
  if (!doc) {
    await sendText(send, `I could not find ${id}.`);
    return;
  }
  const old = { title: doc.title, rel_path: doc.rel_path, file_name: doc.file_name };
  updateDocument(doc.id, { title: collapse(title).slice(0, 120) });
  await syncDocFile(owner, doc.id);
  pushUndo(owner, { type: 'rename', docId: doc.id, previous: old });
  await sendText(send, `✏️ Renamed *${doc.id}* to “${collapse(title)}”.\n_Search will now find it under the new title._`);
}

async function tagDoc({ owner, id, tags, send }) {
  const doc = getDocument(owner, id);
  if (!doc) {
    await sendText(send, `I could not find ${id}.`);
    return;
  }
  const merged = [...new Set([...(doc.tags || []), ...tags.map((t) => t.toLowerCase())])].slice(0, 16);
  updateDocument(doc.id, { tags: merged });
  pushUndo(owner, { type: 'tag', docId: doc.id, previous: doc.tags || [] });
  await sendText(send, `🏷 Added ${tags.map((t) => `#${t}`).join(' ')} to *${doc.id}*.\n\nNow reply \`#${tags[0]}\` to find everything with that tag.`);
}

async function setDocType({ owner, id, typeText, send, session }) {
  const docId = id || session.lastDocId;
  const doc = docId ? getDocument(owner, docId) : null;
  if (!doc) {
    await sendText(send, 'Tell me which document, for example `type D12 plaint`.');
    return;
  }
  const guess = classifyDocument({ text: `${typeText} ${typeText}`, filename: typeText });
  const type = TYPE_BY_ID.get(guess.id);
  if (!type) {
    await sendText(send, 'I do not recognise that type. Try: plaint, affidavit, legal notice, rent agreement, sale deed, power of attorney, court order, invoice.');
    return;
  }
  updateDocument(doc.id, { doc_type: type.id, type_label: type.label, type_confidence: 0.99, needs_review: false });
  await syncDocFile(owner, doc.id);
  pushUndo(owner, { type: 'type', docId: doc.id, previous: { doc_type: doc.doc_type, type_label: doc.type_label } });
  await sendText(send, `✅ *${doc.id}* is now filed as *${type.label}*.`);
}

async function setDocDate({ owner, id, date, send }) {
  const doc = getDocument(owner, id);
  if (!doc) {
    await sendText(send, `I could not find ${id}.`);
    return;
  }
  updateDocument(doc.id, { doc_date: date, date_source: 'user' });
  await syncDocFile(owner, doc.id);
  pushUndo(owner, { type: 'date', docId: doc.id, previous: doc.doc_date });
  await sendText(send, `🗓 Date for *${doc.id}* set to *${formatDate(date, { long: true })}*.`);
}

async function addNote({ owner, id, note, send }) {
  const doc = getDocument(owner, id);
  if (!doc) {
    await sendText(send, `I could not find ${id}.`);
    return;
  }
  const addition = `\n\n[Note added by you: ${note}]`;
  const newText = `${doc.text || ''}${addition}`.slice(0, 400000);
  updateDocument(doc.id, {
    text: newText,
    summary: doc.summary ? `${doc.summary} ${clip(note, 200)}` : clip(note, 300),
    tags: [...new Set([...(doc.tags || []), 'noted'])],
    status: 'filed',
    needs_review: false,
  });
  await sendText(send, `📝 Note saved on *${doc.id}*. It is now searchable: “${clip(note, 60)}”.`);
}

async function askDelete({ owner, id, send, session }) {
  const docId = id || session.lastDocId;
  const doc = docId ? getDocument(owner, docId) : null;
  if (!doc) {
    await sendText(send, 'Which document should I remove? Reply `delete D12`.');
    return;
  }
  updateSession(owner, { pending: { kind: 'confirm_delete', docId: doc.id } });
  await sendText(send, `⚠️ Remove *${doc.id} — ${clip(doc.title, 60)}* from your library?\n\nThe file is kept in the archive, so \`undo\` will bring it back.\n\nReply *yes* to remove, or *no* to keep it.`);
}

async function runConfirmed({ owner, send, session }) {
  const pending = session.pending;
  if (!pending) {
    await sendText(send, 'Nothing is waiting for confirmation. Type *help* if you need the command list.');
    return;
  }
  if (pending.kind === 'confirm_delete') {
    const doc = getDocument(owner, pending.docId);
    if (!doc) {
      updateSession(owner, { pending: null });
      await sendText(send, 'That document is already gone.');
      return;
    }
    const snapshot = await archiveDelete(doc);
    pushUndo(owner, { type: 'delete', snapshot });
    updateSession(owner, { pending: null, lastDocId: null });
    await sendText(send, `🗑 Removed *${doc.id}*. Reply \`undo\` within this session if that was a mistake.`);
    return;
  }
  updateSession(owner, { pending: null });
  await sendText(send, 'Done.');
}

async function undoLast({ owner, send, session }) {
  const action = popUndo(owner);
  if (!action) {
    await sendText(send, 'There is nothing to undo.');
    return;
  }
  switch (action.type) {
    case 'delete': {
      const restored = await restoreArchived(action.snapshot);
      if (restored) {
        await purgeArchived(action.snapshot.id);
        await sendText(send, `↩️ Restored *${restored.id} — ${clip(restored.title, 60)}*.`);
      } else {
        await sendText(send, 'I could not restore that one.');
      }
      return;
    }
    case 'matter':
      updateDocument(action.docId, { matter_id: action.previous });
      await sendText(send, `↩️ *${action.docId}* moved back to ${action.previous || 'no case'}.`);
      return;
    case 'rename':
      updateDocument(action.docId, { title: action.previous.title });
      await sendText(send, `↩️ Title of *${action.docId}* restored.`);
      return;
    case 'tag':
      updateDocument(action.docId, { tags: action.previous });
      await sendText(send, `↩️ Tags on *${action.docId}* restored.`);
      return;
    case 'type':
      updateDocument(action.docId, action.previous);
      await sendText(send, `↩️ Type of *${action.docId}* restored.`);
      return;
    case 'date':
      updateDocument(action.docId, { doc_date: action.previous });
      await sendText(send, `↩️ Date of *${action.docId}* restored.`);
      return;
    default:
      await sendText(send, 'That action cannot be undone automatically.');
  }
}

async function bundleCase({ owner, target, send, session }) {
  let matter = null;
  if (target) matter = getMatter(target.toUpperCase()) || findMatterByName(owner, target);
  if (!matter && session.lastMatterId) matter = getMatter(session.lastMatterId);

  if (!matter) {
    const matters = ownerMatters(owner).filter((m) => m.status === 'active');
    if (!matters.length) {
      await sendText(send, 'You have no cases yet. Create one with `new case Sharma v Mehta`, then file documents into it.');
      return;
    }
    const lines = ['Which case should I compile? Reply with a number:', ''];
    matters.slice(0, 8).forEach((m, i) => lines.push(`${i + 1}. ${m.title} (${m.doc_count || docsForMatter(m.id).length} docs)`));
    updateSession(owner, { pending: { kind: 'bundle_pick', options: matters.slice(0, 8).map((m) => m.id) } });
    await sendText(send, lines.join('\n'));
    return;
  }

  const docs = docsForMatter(matter.id).filter((d) => absolutePathOf(d));
  if (!docs.length) {
    await sendText(send, `*${matter.title}* has no documents with files yet. Send some, then say \`bundle\`.`);
    return;
  }
  await sendText(send, `📦 Compiling *${matter.title}* — ${plural(docs.length, 'document')} with a printed index…`);
  const result = await buildBundle({ owner, matter, docs, title: matter.title });
  await send({
    document: {
      path: result.path,
      filename: `${slugify(matter.title, { max: 40 })}_bundle_${toIso(new Date())}.zip`,
      caption: `📦 ${matter.title} — ${plural(result.count, 'document')} · ${formatBytes(result.size)} · ${result.bundle.id}`,
      mime: 'application/zip',
    },
  });
  await sendText(send, `✅ Bundle *${result.bundle.id}* ready: ${plural(result.count, 'document')} + index (00_INDEX.pdf) + manifest.\n\n_Open the zip → read the index first → every file is numbered in date order._`);
}

async function sendCaseIndex({ owner, index, send, session }) {
  const matters = ownerMatters(owner).filter((m) => m.status === 'active');
  let matter = typeof index === 'number' ? matters[index] : null;
  if (!matter && session.lastMatterId) matter = getMatter(session.lastMatterId);
  if (!matter) {
    await sendText(send, 'Which case index do you want? Reply `index 1` after typing `cases`.');
    return;
  }
  const docs = docsForMatter(matter.id);
  if (!docs.length) {
    await sendText(send, `*${matter.title}* has no documents yet.`);
    return;
  }
  const blocks = pdfBlocksFromText(
    [
      `# FILE INDEX — ${matter.title}`,
      `${matter.client ? `Client: ${matter.client}` : ''}${matter.opposite ? `  |  Other side: ${matter.opposite}` : ''}`,
      `${matter.case_number ? `Case no.: ${matter.case_number}  |  ` : ''}${matter.court || ''}`,
      `Generated on ${formatDate(toIso(new Date()), { long: true })}`,
      '',
      '## Documents in chronological order',
      ...docs.flatMap((doc, i) => [
        `${i + 1}. ${doc.id} — ${doc.doc_date ? formatDate(doc.doc_date) : String(doc.created_at).slice(0, 10)} — ${doc.title}`,
        `${doc.type_label || ''}${doc.pages ? `, ${doc.pages} pages` : ''}${doc.parties?.length ? ` | ${doc.parties.slice(0, 2).map((p) => p.name).join(' v ')}` : ''}`,
        doc.summary ? `Summary: ${clip(doc.summary, 300)}` : '',
        '',
      ]),
    ].join('\n'),
  );
  const pdf = buildPdf({ blocks, title: `File index — ${matter.title}`, footer: `${matter.title} · page {page} of {total}` });
  const file = path.join(config.exportsDir, `index_${slugify(matter.title, { max: 40 })}_${toIso(new Date())}.pdf`);
  await fs.writeFile(file, pdf);
  await send({
    document: {
      path: file,
      filename: path.basename(file),
      caption: `📑 File index — ${matter.title} (${plural(docs.length, 'document')})`,
      mime: 'application/pdf',
    },
  });
}

async function sendBundleById({ owner, id, send }) {
  const bundle = getBundle(id);
  if (!bundle) {
    await sendText(send, `I could not find bundle ${id}.`);
    return;
  }
  const abs = bundle.path ? path.join(config.dataDir, bundle.path) : null;
  if (!abs || !(await exists(abs))) {
    await sendText(send, `Bundle ${id} was created earlier but the zip is no longer on disk. Say \`bundle\` to rebuild it.`);
    return;
  }
  await send({ document: { path: abs, filename: path.basename(abs), caption: `📦 ${bundle.title}`, mime: 'application/zip' } });
}


/** Questions that ask for one known fact are answered from the catalogue, not by guessing. */
function fieldAnswer(doc, question) {
  const q = normalize(question);
  // "who is the deponent / lessor / accused" — answered from the party roles.
  const whoIs = /\bwho\s+is\s+(?:the\s+)?([a-z]+)/.exec(q);
  if (whoIs) {
    const role = whoIs[1].replace(/s$/, '');
    if (role.length > 2) {
      const match = (doc.parties || []).find((p) => normalize(p.role || '').includes(role));
      if (match) return { label: '👤 Party', value: `${match.name}${match.role ? ` (${match.role})` : ''}` };
    }
  }
  const wantsDeposit = /deposit|advance|security/i.test(q);
  const wantsRent = /rent|kiraya|monthly/i.test(q);
  let amounts = doc.amounts || [];
  if (wantsDeposit) {
    const picked = amounts.filter((a) => /deposit|advance|security/i.test(a.label));
    if (picked.length) amounts = picked;
  } else if (wantsRent) {
    const picked = amounts.filter((a) => /rent/i.test(a.label));
    if (picked.length) amounts = picked;
  }
  const money = amounts.map((a) => `${a.label}: ${formatIndianCurrency(a.value)}`).join(' · ');
  const fields = [
    { re: /\bcase\s*(?:no|number)|\bfir\s*(?:no|number)|\bcr\s*(?:no|number)|case\s*number/, label: '🔢 Case number', value: doc.case_number },
    { re: /\bwhich\s+court|\bwhat\s+court|court\s*(?:name|is)|kis\s+court/, label: '🏛 Court', value: doc.court },
    { re: /\bpart(?:y|ies)\b|who\s+(?:is|are)\s+(?:the\s+)?(?:party|parties)|kis\s+ke\s+beech/, label: '👥 Parties', value: (doc.parties || []).map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(' · ') },
    { re: /\bhow\s+much|\bamount|\bkitna|\bkitne\s+(?:rupaye|paisa)/, label: '💰 Amount', value: money },
    { re: /\bwhat\s+(?:is|was)\s+(?:the\s+)?date|\bwhich\s+date|\bdate\s+of\s+(?:the\s+)?(?:document|order|notice|agreement)|\bdated\b/, label: '🗓 Date', value: doc.doc_date ? formatDate(doc.doc_date, { long: true }) : '' },
    { re: /\bwhat\s+(?:kind|type)\s+of|\bwhat\s+is\s+this\s+(?:document|paper)/, label: '🗂 Type', value: doc.type_label },
    { re: /\bsection|\bunder\s+which\s+(?:section|act)/, label: '⚖️ Sections', value: (doc.statutes || []).map((x) => (x.section ? `Section ${x.section} ${x.act}` : x.act)).slice(0, 3).join(' · ') },
  ];
  for (const field of fields) {
    if (!field.re.test(q)) continue;
    const value = String(field.value || '').trim();
    if (!value) return { label: field.label, value: '', missing: true };
    return { label: field.label, value };
  }
  return null;
}

async function answerQuestion({ owner, question, send, session }) {
  const wantsSummary = /summar|what\s+is\s+(?:in|inside)|explain|tell\s+me\s+about|overview|what\s+does\s+it\s+say/i.test(question);
  const plan = parseQuery(question, { matters: ownerMatters(owner) });

  let candidates = [];
  if (plan.docId && /^D\d+$/.test(plan.docId)) {
    const doc = getDocument(owner, plan.docId);
    if (doc) candidates = [doc];
  }
  const namesADocument = Boolean(plan.typeIds?.length || plan.matterId || plan.docId);
  if (!candidates.length && !namesADocument && session.lastDocId && plan.terms.length <= 2) {
    // Follow-up question ("and the deposit?", "what about notice?") about the
    // document we just opened. If the user names a paper or a case, search instead.
    const last = getDocument(owner, session.lastDocId);
    if (last && last.text) candidates = [last];
  }
  if (!candidates.length) {
    const result = searchDocuments(owner, { ...plan, limit: 5 });
    candidates = result.docs;
    // If the question named a paper ("the sale deed"), documents of that type come
    // first — the word search alone can drift to a document that only mentions it.
    if (plan.typeIds?.length) {
      const typedMatch = candidates.filter((d) => plan.typeIds.includes(d.doc_type));
      const typedExtra = plan.typeIds
        .flatMap((typeId) => listDocuments(owner, { docType: typeId, limit: 4 }))
        .filter((d) => !typedMatch.some((m) => m.id === d.id));
      candidates = [
        ...typedMatch,
        ...typedExtra,
        ...candidates.filter((d) => !plan.typeIds.includes(d.doc_type)),
      ];
    }
  }

  if (!candidates.length) {
    await sendText(send, `I could not find a document to answer that from.\n\nTry naming the paper (“rent agreement Sharma”) or send it to me first.`);
    return;
  }

  if (wantsSummary || !plan.terms.length) {
    await openDoc({ owner, docId: candidates[0].id, send, session });
    return;
  }

  // A question about one stored fact (case number, court, date, parties, amount…)
  const known = fieldAnswer(candidates[0], question);
  if (known && known.value) {
    updateSession(owner, { lastDocId: candidates[0].id });
    await sendText(send, [
      `${known.label} — *${clip(known.value, 220)}*`,
      '',
      `_From ${candidates[0].id} · ${clip(candidates[0].title, 70)}${candidates[0].doc_date ? ` · ${formatDate(candidates[0].doc_date)}` : ''}_`,
      '',
      `Reply *${candidates[0].id}* for the file. Check the original before relying on it.`,
    ].join('\n'));
    return;
  }

  // Ignore the words the user used to identify the document (its type, title, parties):
  // what is left is what they actually want to know.
  const identifiers = new Set(
    `${candidates[0].type_label || ''} ${candidates[0].title || ''}`
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2),
  );
  for (const party of candidates[0].parties || []) {
    for (const word of String(party.name || '').toLowerCase().split(/[^a-z]+/)) {
      if (word.length > 2) identifiers.add(word);
    }
  }
  const focus = plan.terms.filter((t) => !identifiers.has(t));
  const questionTerms = (focus.length ? focus : plan.terms).join(' ') || question;
  const passages = candidates.slice(0, 3).map((doc) => {
    const best = bestPassage(doc.text || '', questionTerms, { pagesMeta: doc.entities?.pageMeta });
    return { doc, ...best };
  }).filter((p) => p.passage && p.score > 0);

  if (!passages.length) {
    await sendText(send, `I could not find that in ${candidates.map((c) => c.id).join(', ')}.\n\nThe document may not mention it, or the text may not be readable. Reply with the document id to see the file itself.`);
    return;
  }

  let aiAnswer = null;
  if (llmConfigured() && candidates.length) {
    aiAnswer = await llmAnswerQuestion({ question, docs: candidates.slice(0, 2) });
  }

  const top = passages[0];
  const lines = [];
  lines.push(`📖 *Answer from ${top.doc.id}* — ${clip(top.doc.title, 60)}`);
  if (top.page) lines.push(`_Page ${top.page}_`);
  lines.push('');
  if (aiAnswer) {
    lines.push(aiAnswer);
    lines.push('', `_Source: ${top.doc.id}${top.page ? `, page ${top.page}` : ''}._`);
  } else {
    lines.push(`“${cleanSnippet(top.passage, 700)}”`);
    lines.push('');
    lines.push(`_From ${top.doc.id}${top.page ? `, page ${top.page}` : ''}._`);
  }
  if (passages[1] && !aiAnswer && passages[1].doc.id !== top.doc.id && passages[1].score >= Math.max(1.2, top.score * 0.7)) {
    lines.push('', `Also mentioned in ${passages[1].doc.id}: “${cleanSnippet(passages[1].passage, 200)}”`);
  }
  lines.push('', `Reply *${top.doc.id}* to get the file. This is a reading aid — check the original before relying on it.`);
  await sendText(send, lines.join('\n'));
  updateSession(owner, { lastDocId: top.doc.id, lastResults: passages.map((p) => p.doc.id) });
}

async function sendDeadlines({ owner, send, session }) {
  const open = listDeadlines(owner, { limit: 12 });
  const lines = [];
  if (!open.length) {
    lines.push('🗓 *No dates are pending.*', '', 'Add one like this:', '`remind me 3 days before 12/12/2026 hearing Mehta`');
    await sendText(send, lines.join('\n'));
    return;
  }
  const overdue = open.filter((d) => (daysBetween(d.due_date) ?? 0) < 0);
  const upcoming = open.filter((d) => (daysBetween(d.due_date) ?? 0) >= 0);
  if (overdue.length) {
    lines.push('🔴 *Overdue*');
    overdue.forEach((d, i) => lines.push(deadlineLine(d, i + 1)));
    lines.push('');
  }
  lines.push('🗓 *Coming up*');
  upcoming.forEach((d, i) => lines.push(deadlineLine(d, overdue.length + i + 1)));
  lines.push('', 'Reply `done 1` (with the number) when one is finished.');
  updateSession(owner, { pending: { kind: 'deadline_list', options: open.map((d) => d.id) } });
  await sendText(send, lines.join('\n'));
}

async function markDeadlineDone({ owner, index, send }) {
  const pending = getSession(owner).pending;
  if (pending?.kind !== 'deadline_list') {
    await sendText(send, 'Type `deadlines` first, then `done 1`.');
    return;
  }
  const id = pending.options[index];
  if (!id) {
    await sendText(send, 'That number is not in the list.');
    return;
  }
  completeDeadline(id);
  await sendText(send, '✅ Marked as done.');
}

async function createReminder({ owner, send, due, title, remindDays, raw, session }) {
  if (!due) {
    const parsedDate = /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s*\d{4})/.exec(raw || '');
    const guess = parsedDate ? null : null;
    updateSession(owner, { pending: { kind: 'remind', title: title || 'Reminder' } });
    await sendText(send, guess || `I need a date for that. Send it like:\n\n\`remind me 3 days before 12/12/2026 hearing Mehta\`\n\n(or any date such as 12 March 2027).`);
    return;
  }
  const cleanTitle = /^[a-z]/.test(title || '') ? title.charAt(0).toUpperCase() + title.slice(1) : title;
  const deadline = addDeadline(owner, {
    kind: /hearing|sunwai|court/i.test(title || '') ? 'hearing' : 'deadline',
    title: cleanTitle || 'Reminder',
    due_date: due,
    remind_days: remindDays ?? 1,
    detail: raw ? clip(raw, 300) : null,
  });
  updateSession(owner, { pending: null });
  const rel = relativeDay(due);
  await sendText(send, `⏰ Reminder set: *${clip(deadline.title, 70)}*\nDate: ${formatDate(due, { long: true })}${rel ? ` (${rel})` : ''}\nI will message you ${plural(deadline.remind_days, 'day')} before.\n\nType \`deadlines\` to see all dates.`);
}

async function makeDraft({ owner, templateId, instruction, send, session }) {
  const template = DRAFT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    await sendText(send, 'I could not tell which document to draft. Try:\n`draft legal notice for Rs 2,00,000 from Mehta`\n`draft rent agreement for flat in Jaipur rent 25000 deposit 100000`');
    return;
  }
  await sendText(send, `✍️ Drafting *${template.label}*…`);
  const result = await createDraftDocument({
    owner,
    instruction,
    templateId,
    authorName: config.ownerName,
    matterId: session.lastMatterId || null,
  });
  if (!result) {
    await sendText(send, 'I could not build that draft. Try again with a little more detail.');
    return;
  }
  const { doc, missing } = result;
  const lines = [`✅ Draft saved as *${doc.id}*`, '', `📄 *${doc.title}*`];
  if (missing.length) {
    lines.push('', '*Fill these in before use*');
    missing.slice(0, 8).forEach((field) => lines.push(`• ${field}`));
  } else {
    lines.push('', '_All fields were picked up from your message — still verify every detail before signing._');
  }
  lines.push('', 'Open the Word file to edit. The PDF and text copy are in your library.');
  await sendText(send, lines.join('\n'));

  const docxPath = doc.entities?.docx ? path.join(config.dataDir, doc.entities.docx) : null;
  if (docxPath && await exists(docxPath)) {
    await send({
      document: {
        path: docxPath,
        filename: path.basename(docxPath),
        caption: `${doc.id} · ${clip(doc.title, 60)} (editable)`,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
  } else {
    await sendDocFile(send, doc);
  }
  updateSession(owner, { lastDocId: doc.id });
}

async function pickDraftTemplate({ owner, instruction, send, session }) {
  const lines = ['What should I draft? Reply with a number:', ''];
  const options = DRAFT_TEMPLATES.slice(0, 12);
  options.forEach((t, i) => lines.push(`${i + 1}. ${t.label}`));
  updateSession(owner, { pending: { kind: 'draft_pick', options: options.map((t) => t.id), instruction } });
  await sendText(send, lines.join('\n'));
}

async function sendFileVersion({ owner, id, format, send, session }) {
  const docId = id || session.lastDocId;
  const doc = docId ? getDocument(owner, docId) : null;
  if (!doc) {
    await sendText(send, 'Which document? Reply like `send pdf D12`.');
    return;
  }
  const sent = await sendDocFile(send, doc, { format: format || null, caption: `${doc.id} · ${clip(doc.title, 60)}` });
  if (sent) await sendText(send, `📎 Sent ${doc.id}.`);
}

async function exportCsv({ owner, send }) {
  const docs = listDocuments(owner, { limit: 5000, order: 'created_at DESC' });
  const rows = [
    ['ID', 'Title', 'Type', 'Date', 'Case', 'Court', 'Case no.', 'Parties', 'Pages', 'Tags', 'File', 'Added'],
    ...docs.map((d) => [
      d.id, d.title || '', d.type_label || d.doc_type || '', d.doc_date || '',
      d.matter_id || '', d.court || '', d.case_number || '',
      (d.parties || []).map((p) => p.name).join('; '), d.pages || '',
      (d.tags || []).join('; '), d.rel_path || '', String(d.created_at).slice(0, 10),
    ]),
  ];
  const csv = rows.map((r) => r.map((cell) => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const file = path.join(config.exportsDir, `library_${toIso(new Date())}.csv`);
  await fs.writeFile(file, csv, 'utf8');
  await send({
    document: { path: file, filename: path.basename(file), caption: `📊 Library export — ${plural(docs.length, 'document')}`, mime: 'text/csv' },
  });
}
