/**
 * Minimal DOCX writer (Office Open XML) built with archiver.
 * Produces a real .docx that opens in Word, Google Docs, LibreOffice.
 * Unicode (including Hindi) is preserved.
 */
import archiver from 'archiver';
import { PassThrough } from 'node:stream';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="180" w:after="80"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>`;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function run(text, { bold = false, italic = false, size = 22, underline = false } = {}) {
  return `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(content, { style, align, indent, spaceAfter, keepNext } = {}) {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
    indent ? `<w:ind w:left="${indent}" w:hanging="${Math.min(indent, 360)}"/>` : '',
    spaceAfter !== undefined ? `<w:spacing w:after="${spaceAfter}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
  ].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
}

/**
 * @param {Array<{text:string, style?:'title'|'h1'|'h2'|'p'|'bullet'|'indent'|'small'|'spacer'}>} blocks
 */
export function buildDocxBody(blocks) {
  const parts = [];
  for (const block of blocks) {
    const text = String(block.text ?? '');
    switch (block.style) {
      case 'title':
        parts.push(para(run(text, { bold: true, size: 32 }), { style: 'Title' }));
        break;
      case 'h1':
        parts.push(para(run(text, { bold: true, size: 26 }), { style: 'Heading1' }));
        break;
      case 'h2':
        parts.push(para(run(text, { bold: true, size: 23 }), { style: 'Heading2' }));
        break;
      case 'bullet':
        parts.push(para(run(`•\u00a0\u00a0${text}`), { indent: 360, spaceAfter: 80 }));
        break;
      case 'indent':
        parts.push(para(run(text), { indent: 720, align: 'both' }));
        break;
      case 'center':
        parts.push(para(run(text), { align: 'center' }));
        break;
      case 'right':
        parts.push(para(run(text), { align: 'right' }));
        break;
      case 'small':
        parts.push(para(run(text, { size: 18 }), {}));
        break;
      case 'spacer':
        parts.push(para('', { spaceAfter: 0 }));
        break;
      default:
        parts.push(para(run(text), { align: 'justify' }));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

/** Render plain text (with #/## headings and - bullets) to DOCX blocks. */
export function textToBlocks(text) {
  const blocks = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { blocks.push({ text: '', style: 'spacer' }); continue; }
    if (trimmed.startsWith('# ')) { blocks.push({ text: trimmed.slice(2), style: 'h1' }); continue; }
    if (trimmed.startsWith('## ')) { blocks.push({ text: trimmed.slice(3), style: 'h2' }); continue; }
    if (/^[-*]\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^[-*]\s+/, ''), style: 'bullet' }); continue; }
    if (/^>\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^>\s+/, ''), style: 'indent' }); continue; }
    if (/^\s{2,}\S/.test(line)) { blocks.push({ text: trimmed, style: 'indent' }); continue; }
    blocks.push({ text: trimmed, style: 'p' });
  }
  return blocks;
}

function zipFiles(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    archive.finalize();
  });
}

/** Build a complete .docx buffer from text. */
export async function docxFromText(text, { title = '' } = {}) {
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(title)}</dc:title>
  <dc:creator>X Document Manager</dc:creator>
  <cp:lastModifiedBy>X Document Manager</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>X Document Manager</Application>
</Properties>`;

  return zipFiles({
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/_rels/document.xml.rels': DOC_RELS,
    'word/styles.xml': STYLES,
    'word/document.xml': buildDocxBody(textToBlocks(text)),
    'docProps/core.xml': core,
    'docProps/app.xml': app,
  });
}
