import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { config } from '../config.js';
import { buildPdf } from '../util/pdf-writer.js';
import { formatDate, toIso } from '../util/dates.js';
import { slugify, clip } from '../util/text.js';
import { createBundle } from '../store/repo.js';
import { log } from '../util/logger.js';

export function absolutePathOf(doc) {
  if (!doc?.rel_path) return null;
  const abs = path.resolve(config.dataDir, doc.rel_path);
  return abs.startsWith(config.dataDir) ? abs : null;
}

function indexBlocks({ title, matter, docs, notes = '' }) {
  const blocks = [
    { text: title, style: 'title' },
    { text: `Compiled on ${formatDate(toIso(new Date()), { long: true })} with X Document Manager`, style: 'small' },
    { text: '', style: 'spacer' },
  ];
  if (matter) {
    blocks.push({ text: 'CASE', style: 'h1' });
    const rows = [
      ['Case', `${matter.id} — ${matter.title}`],
      ['Client', matter.client],
      ['Other side', matter.opposite],
      ['Case number', matter.case_number],
      ['Court', matter.court],
      ['Practice area', matter.practice_area],
    ].filter(([, v]) => v);
    for (const [label, value] of rows) blocks.push({ text: `${label}: ${value}`, style: 'p' });
    blocks.push({ text: '', style: 'spacer' });
  }
  blocks.push({ text: `INDEX OF DOCUMENTS (${docs.length})`, style: 'h1' });
  docs.forEach((doc, i) => {
    blocks.push({
      text: `${String(i + 1).padStart(2, '0')}.  ${doc.title || 'Untitled'}`,
      style: 'h2',
    });
    const meta = [
      doc.id,
      doc.type_label || doc.doc_type,
      doc.doc_date ? `dated ${formatDate(doc.doc_date)}` : `filed ${String(doc.created_at).slice(0, 10)}`,
      doc.pages ? `${doc.pages} page(s)` : null,
      doc.case_number ? `case ${doc.case_number}` : null,
      doc.court || null,
    ].filter(Boolean).join(' · ');
    blocks.push({ text: meta, style: 'small' });
    if (doc.parties?.length) {
      blocks.push({ text: `Parties: ${doc.parties.slice(0, 3).map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join('; ')}`, style: 'p' });
    }
    if (doc.summary) blocks.push({ text: `Summary: ${clip(doc.summary, 420)}`, style: 'p' });
    if (doc.key_points?.length) {
      for (const point of doc.key_points.slice(0, 3)) blocks.push({ text: point, style: 'bullet' });
    }
    if (doc.amounts?.length) {
      blocks.push({ text: `Amounts: ${doc.amounts.slice(0, 3).map((a) => `${a.label}: ${a.raw}`).join('; ')}`, style: 'p' });
    }
    const fileName = doc.bundle_name || '';
    if (fileName) blocks.push({ text: `File: ${fileName}`, style: 'small' });
    blocks.push({ text: '', style: 'spacer' });
  });
  if (notes) {
    blocks.push({ text: 'NOTES', style: 'h1' });
    blocks.push({ text: notes, style: 'p' });
  }
  blocks.push({ text: '', style: 'spacer' });
  blocks.push({ text: 'Prepared by X Document Manager. Verify all documents and details before filing or relying on this bundle.', style: 'small' });
  return blocks;
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Zip a matter (or a set of documents) into a shareable case bundle.
 */
export async function buildBundle({ owner, matter = null, docs, title, notes = '' }) {
  const usable = docs.filter((d) => absolutePathOf(d) && fs.existsSync(absolutePathOf(d)));
  if (!usable.length) throw new Error('No documents with files found for this bundle');

  await fsp.mkdir(config.exportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${slugify(title || matter?.title || 'case-bundle', { max: 50 })}_${stamp}`;
  let zipPath = path.join(config.exportsDir, `${baseName}.zip`);
  let counter = 2;
  while (fs.existsSync(zipPath)) {
    zipPath = path.join(config.exportsDir, `${baseName}-${counter}.zip`);
    counter += 1;
  }

  // Numbered copies keep the reading order fixed.
  const files = usable.map((doc, index) => {
    const abs = absolutePathOf(doc);
    const ext = path.extname(abs) || '.pdf';
    const number = String(index + 1).padStart(2, '0');
    const name = `${number}_${slugify(doc.title || doc.id, { max: 60 })}_${doc.id}${ext}`;
    return { doc: { ...doc, bundle_name: name }, abs, name };
  });

  const indexPdf = buildPdf({
    blocks: indexBlocks({ title: title || matter?.displayTitle || 'Case Bundle', matter, docs: files.map((f) => f.doc), notes }),
    title: title || 'Case Bundle',
    footer: 'X Document Manager  ·  page {page} of {total}',
  });

  const csvLines = [
    ['#', 'ID', 'Date', 'Type', 'Title', 'Parties', 'Court', 'Case no.', 'Pages', 'File'].map(csvEscape).join(','),
    ...files.map((f, i) => [
      i + 1, f.doc.id, f.doc.doc_date || String(f.doc.created_at).slice(0, 10), f.doc.type_label || f.doc.doc_type,
      f.doc.title, (f.doc.parties || []).map((p) => p.name).join('; '), f.doc.court || '', f.doc.case_number || '',
      f.doc.pages || '', f.name,
    ].map(csvEscape).join(',')),
  ].join('\n');

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(indexPdf, { name: '00_INDEX.pdf' });
    archive.append(csvLines, { name: '00_MANIFEST.csv' });
    for (const file of files) archive.file(file.abs, { name: file.name });
    archive.finalize();
  });

  const stat = await fsp.stat(zipPath);
  const bundle = createBundle(owner, {
    matter_id: matter?.id || null,
    title: title || matter?.title || 'Case Bundle',
    doc_ids: files.map((f) => f.doc.id),
    path: path.relative(config.dataDir, zipPath),
    size: stat.size,
  });

  log.info(`bundle ${bundle.id} built with ${files.length} documents (${Math.round(stat.size / 1024)} KB)`);
  return { bundle, path: zipPath, size: stat.size, count: files.length, documents: files.map((f) => f.doc) };
}
