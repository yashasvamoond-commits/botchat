/**
 * Minimal, dependency-free PDF writer.
 * Good enough for clean, printable legal drafts and case-bundle indexes.
 * Latin/WinAnsi text only (use DOCX output for Hindi or other scripts).
 */

const HELVETICA = 'Helvetica';
const HELVETICA_BOLD = 'Helvetica-Bold';

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

// Rough advance widths (1/1000 em) for the standard fonts. Enough for clean wrapping.
function charWidth(ch) {
  if (ch === ' ') return 278;
  if (/[0-9]/.test(ch)) return 556;
  if (/[A-Z]/.test(ch)) return 'IJLMT'.includes(ch) ? 300 : 'MW'.includes(ch) ? 900 : 680;
  if (/[a-z]/.test(ch)) return 'ijl'.includes(ch) ? 230 : 'mw'.includes(ch) ? 800 : 500;
  if (/[.,;:'!|]/.test(ch)) return 278;
  if (/[()\[\]]/.test(ch)) return 333;
  if (/[-–—/]/.test(ch)) return 333;
  return 500;
}

function textWidth(text, size, bold = false) {
  let units = 0;
  for (const ch of text) units += charWidth(ch);
  return (units / 1000) * size * (bold ? 1.02 : 1);
}

const UNICODE_MAP = new Map([
  ['₹', 'Rs.'], ['—', '-'], ['–', '-'], ['’', "'"], ['‘', "'"], ['“', '"'], ['”', '"'],
  ['•', '-'], ['…', '...'], ['✓', 'v'], ['×', 'x'], ['→', '->'], ['≤', '<='], ['≥', '>='],
  ['\u00a0', ' '], ['\u2011', '-'], ['\u2013', '-'], ['§', 'Sec.'], ['°', ' deg '],
]);

function sanitize(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (UNICODE_MAP.has(ch)) { out += UNICODE_MAP.get(ch); continue; }
    const code = ch.codePointAt(0);
    if (code === 10 || code === 13) { out += ' '; continue; }
    if (code === 9) { out += '    '; continue; }
    if (code >= 32 && code <= 255) { out += ch; continue; }
    out += '?';
  }
  return out;
}

function escapePdf(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, size, maxWidth, bold = false) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (textWidth(word, size, bold) > maxWidth) {
        // Break an over-long word (long URLs, case numbers).
        let chunk = '';
        for (const ch of word) {
          if (textWidth(chunk + ch, size, bold) > maxWidth) { lines.push(chunk); chunk = ch; }
          else chunk += ch;
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * @param {object} opts
 * @param {Array<{text:string, style?:string, size?:number, gap?:number}>} opts.blocks
 * @param {string} [opts.title]
 * @param {string} [opts.footer] Use {page} and {total} placeholders.
 * @param {[number,number]} [opts.margin]
 * @returns {Buffer}
 */
export function buildPdf({ blocks = [], title = '', footer = '', margin = [MARGIN, MARGIN] } = {}) {
  const [ml, mr] = margin;
  const maxWidth = PAGE_WIDTH - ml - mr;
  const pages = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  let pageNo = 1;

  const newPage = () => {
    pages.push([]);
    pageNo += 1;
    y = PAGE_HEIGHT - MARGIN;
  };

  const write = (text, { size, bold, color = '0 0 0', indent = 0, lineGap = 1.32 }) => {
    const lines = wrap(text, size, maxWidth - indent, bold);
    const lineHeight = size * lineGap;
    for (const line of lines) {
      if (y - lineHeight < MARGIN + 18) newPage();
      pages[pages.length - 1].push(
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${(ml + indent).toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(line)}) Tj ET`,
      );
      y -= lineHeight;
    }
  };

  const rule = () => {
    if (y - 10 < MARGIN) newPage();
    pages[pages.length - 1].push(
      `0.75 w 0.6 0.6 0.6 RG ${ml} ${y.toFixed(2)} m ${(PAGE_WIDTH - mr).toFixed(2)} ${y.toFixed(2)} l S`,
    );
    y -= 12;
  };

  for (const block of blocks) {
    const style = block.style || 'p';
    switch (style) {
      case 'title':
        y -= 4;
        write(block.text, { size: block.size || 19, bold: true });
        y -= 6;
        break;
      case 'h1':
        if (y < MARGIN + 90) newPage();
        y -= 10;
        write(block.text, { size: block.size || 14, bold: true });
        y -= 2;
        break;
      case 'h2':
        y -= 6;
        write(block.text, { size: block.size || 11.5, bold: true });
        y -= 1;
        break;
      case 'small':
        write(block.text, { size: block.size || 8.5, color: '0.35 0.35 0.35' });
        break;
      case 'bullet':
        write(`-  ${block.text}`, { size: block.size || 10.5, indent: 8 });
        break;
      case 'indent':
        write(block.text, { size: block.size || 10.5, indent: 22 });
        break;
      case 'rule':
        rule();
        break;
      case 'spacer':
        y -= block.size || 12;
        break;
      default:
        write(block.text, { size: block.size || 10.5 });
    }
    y -= block.gap ?? 5;
  }

  // Page footers
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const label = (footer || (title ? `${title}  ·  page {page} of {total}` : 'page {page} of {total}'))
      .replace(/\{page\}/g, String(i + 1))
      .replace(/\{total\}/g, String(total));
    pages[i].push(
      `BT /F1 8 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${ml} ${MARGIN - 18} Tm (${escapePdf(sanitize(label))}) Tj ET`,
    );
  }

  const objects = [];
  const addObject = (body) => { objects.push(body); return objects.length; };

  const fontRegular = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pagesObjIndex = objects.length + 1 + total * 2; // placeholder index computed below

  const contentRefs = [];
  const pageRefs = [];

  // Reserve ids deterministically: pages object, then for each page: page obj + content obj
  const pagesObjId = addObject('PLACEHOLDER_PAGES');
  const pageIds = [];
  for (let i = 0; i < total; i++) {
    const pageId = objects.length + 1;
    addObject('PLACEHOLDER_PAGE');
    pageIds.push(pageId);
    const content = pages[i].join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    contentRefs.push(contentId);
  }

  for (let i = 0; i < total; i++) {
    objects[pageIds[i] - 1] =
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentRefs[i]} 0 R >>`;
  }
  objects[pagesObjId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`;

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  const now = new Date();
  const pdfDate = `D:${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const infoId = addObject(
    `<< /Title (${escapePdf(sanitize(title || 'Document'))}) /Producer (X Document Manager) /Creator (X Document Manager) /CreationDate (${pdfDate}) >>`,
  );

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** Convenience: build a PDF from plain text (respects blank lines and #/## headings). */
export function pdfFromText(text, { title = '', footer = '' } = {}) {
  const blocks = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { blocks.push({ text: '', style: 'spacer', size: 8 }); continue; }
    if (trimmed.startsWith('# ')) { blocks.push({ text: trimmed.slice(2), style: 'h1' }); continue; }
    if (trimmed.startsWith('## ')) { blocks.push({ text: trimmed.slice(3), style: 'h2' }); continue; }
    if (/^[-*]\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^[-*]\s+/, ''), style: 'bullet' }); continue; }
    if (/^\s{2,}\S/.test(line)) { blocks.push({ text: trimmed, style: 'indent' }); continue; }
    blocks.push({ text: trimmed, style: 'p' });
  }
  return buildPdf({ blocks, title, footer });
}
