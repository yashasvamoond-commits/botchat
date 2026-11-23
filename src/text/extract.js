import path from 'node:path';
import mammoth from 'mammoth';
import { log } from '../util/logger.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.log', '.xml', '.html', '.htm', '.rtf', '.srt', '.vtt']);

export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.rtf', '.html', '.htm',
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff', '.bmp',
  '.xlsx', '.xls', '.pptx', '.odt', '.zip',
]);

export function extensionOf(name, mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext) return ext;
  const map = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/tiff': '.tiff',
    'text/plain': '.txt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return map[mime] || '';
}

export function kindOf(ext, mime = '') {
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc';
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff', '.bmp'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['.xlsx', '.xls'].includes(ext)) return 'spreadsheet';
  if (['.pptx'].includes(ext)) return 'slides';
  if (['.odt', '.rtf'].includes(ext)) return 'richtext';
  if (ext === '.zip') return 'zip';
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) return 'text';
  return 'unknown';
}

async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: item.transform[4], str: item.str });
    }
    const ordered = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push({ page: i, text: ordered.join('\n') });
    page.cleanup();
  }
  await doc.destroy().catch(() => {});
  const text = pages.map((p) => p.text).join('\n\n');
  return { pages, text, pageCount: pages.length };
}

function stripRtf(input) {
  return String(input)
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*?[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(input) {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract readable text from a file.
 * @returns {Promise<{text:string, pageCount:number|null, method:string, pageTexts:Array<{page:number,text:string}>, warnings:string[]}>}
 */
export async function extractText({ buffer, filename = 'file', mime = '' }) {
  const ext = extensionOf(filename, mime);
  const kind = kindOf(ext, mime);
  const warnings = [];

  try {
    if (kind === 'pdf') {
      const result = await extractPdf(buffer);
      const chars = result.text.replace(/\s/g, '').length;
      if (chars < 24) {
        return {
          text: '',
          pageCount: result.pageCount,
          method: 'pdf-none',
          pageTexts: [],
          warnings: ['This PDF has no selectable text — it is probably a scan or a photo saved as PDF.'],
          scanned: true,
        };
      }
      return { text: result.text, pageCount: result.pageCount, method: 'pdf-text', pageTexts: result.pages, warnings };
    }

    if (kind === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer });
      const text = String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      return { text, pageCount: null, method: 'docx', pageTexts: [], warnings };
    }

    if (kind === 'doc') {
      // Old binary .doc: pull out readable Latin text as a best effort.
      const raw = buffer.toString('latin1');
      const text = raw
        .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const usable = text.length > 200;
      if (!usable) warnings.push('Old .doc format — text could not be read reliably. Re-save as PDF or DOCX for better results.');
      return { text: usable ? text : '', pageCount: null, method: usable ? 'doc-raw' : 'none', pageTexts: [], warnings, scanned: !usable };
    }

    if (kind === 'text') {
      const raw = buffer.toString('utf8');
      const text = ext === '.html' || ext === '.htm' ? stripHtml(raw) : ext === '.rtf' ? stripRtf(raw) : raw;
      return { text: text.trim(), pageCount: null, method: 'text', pageTexts: [], warnings };
    }

    if (kind === 'image') {
      return {
        text: '',
        pageCount: 1,
        method: 'image',
        pageTexts: [],
        warnings: ['This is a photo or image. Text inside it needs OCR.'],
        scanned: true,
      };
    }

    if (kind === 'spreadsheet' || kind === 'slides' || kind === 'zip') {
      return {
        text: '',
        pageCount: null,
        method: 'none',
        pageTexts: [],
        warnings: [`${ext.toUpperCase().slice(1)} files are stored and indexed by name and caption only.`],
        scanned: true,
      };
    }

    // Unknown binary: try UTF-8, fall back to printable ASCII scan.
    const utf8 = buffer.toString('utf8');
    const printable = utf8.replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, ' ');
    const looksText = utf8.length && printable.length / utf8.length > 0.85;
    if (looksText) {
      return { text: utf8.trim(), pageCount: null, method: 'raw', pageTexts: [], warnings };
    }
    return { text: '', pageCount: null, method: 'none', pageTexts: [], warnings: ['Unrecognised file type — stored safely, but text could not be read.'], scanned: true };
  } catch (err) {
    log.warn('extractText failed for', filename, err.message);
    return {
      text: '',
      pageCount: null,
      method: 'error',
      pageTexts: [],
      warnings: [`Could not read this file automatically (${err.message}). It is stored safely.`],
      scanned: true,
    };
  }
}
