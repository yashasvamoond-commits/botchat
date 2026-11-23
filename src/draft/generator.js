import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { DRAFT_TEMPLATES, TEMPLATE_BY_ID, matchTemplate } from './templates.js';
import { analyzeDocument } from '../analysis/analyzer.js';
import { buildPdf, pdfFromText } from '../util/pdf-writer.js';
import { docxFromText } from '../util/docx-writer.js';
import { collapse, titleCase } from '../util/text.js';
import { formatDate, addDays, toIso } from '../util/dates.js';
import { formatIndianCurrency, rupeesInWords } from '../util/numberWords.js';
import { createDocument, updateDocument } from '../store/repo.js';
import { libraryFolder, ownerSlug, canonicalFileName } from '../ingest/naming.js';
import { TYPE_BY_ID } from '../analysis/taxonomy.js';
import { slugify } from '../util/text.js';

const INDIAN_CITIES = [
  'Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Bhilwara', 'Sikar', 'Pali',
  'Delhi', 'New Delhi', 'Mumbai', 'Pune', 'Nagpur', 'Thane', 'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot',
  'Lucknow', 'Kanpur', 'Noida', 'Varanasi', 'Agra', 'Meerut', 'Prayagraj', 'Ghaziabad',
  'Bengaluru', 'Bangalore', 'Mysuru', 'Mangaluru', 'Hubballi',
  'Hyderabad', 'Warangal', 'Vijayawada', 'Visakhapatnam', 'Guntur',
  'Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem',
  'Kolkata', 'Howrah', 'Siliguri', 'Durgapur', 'Patna', 'Ranchi', 'Bhopal', 'Indore', 'Gwalior', 'Jabalpur',
  'Raipur', 'Chandigarh', 'Ludhiana', 'Amritsar', 'Jalandhar', 'Dehradun', 'Haridwar', 'Shimla',
  'Guwahati', 'Bhubaneswar', 'Cuttack', 'Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Panaji', 'Gurugram',
  'Faridabad', 'Srinagar', 'Jammu', 'Imphal', 'Agartala', 'Shillong', 'Aizawl', 'Kohima', 'Itanagar', 'Gangtok',
];

function findCity(text, fallback) {
  const source = String(text || '');
  for (const city of INDIAN_CITIES) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(source)) return city;
  }
  const at = /\b(?:at|in)\s+([A-Z][a-z]{3,20})\b/.exec(source);
  if (at && !/^(?:india|the|this|that|my|our|his|her)$/i.test(at[1])) return at[1];
  return fallback;
}

const NAME = '((?:(?:Mr|Mrs|Ms|Dr|Shri|Smt|M/s|Messrs)\\.?[ \\t]+)?[A-Z][A-Za-z.&\'\\-]*(?:[ \\t]+[A-Z][A-Za-z.&\'\\-]*){0,3})';

/** The first capitalised name that follows one of these keywords. */
function nameAfter(text, keywords) {
  for (const keyword of keywords) {
    const re = new RegExp(`\\b(?:${keyword})\\b[ \\t]*[:,]?[ \\t]*`, 'i');
    const match = re.exec(text);
    if (!match) continue;
    const rest = text.slice(match.index + match[0].length);
    const name = new RegExp(`^${NAME}`).exec(rest);
    if (!name) continue;
    const candidate = collapse(name[1]);
    if (/^(?:Rs|INR|The|This|That|A|An)\\b/i.test(candidate)) continue;
    if (candidate.length < 3) continue;
    return candidate;
  }
  return null;
}

function extractRequestedNames(instruction) {
  const text = String(instruction || '');
  const out = { client: null, opposite: null, property: null, purpose: null };

  const betweenAt = /\bbetween\b/i.exec(text);
  if (betweenAt) {
    const rest = text.slice(betweenAt.index + betweenAt[0].length);
    const pair = new RegExp(`^[ \\t]*${NAME}[ \\t]+(?:and|&)[ \\t]+${NAME}`).exec(rest);
    if (pair) {
      out.client = collapse(pair[1]);
      out.opposite = collapse(pair[2]);
    }
  }

  out.client = out.client || nameAfter(text, ['on behalf of', 'for the client', 'client', 'in favour of', 'by']);
  out.opposite = out.opposite || nameAfter(text, ['notice to', 'against', 'addressed to', 'opposite party', 'from', 'to']);

  const property = /\b(?:property|premises|flat|plot|house|shop)\s+(?:at|in|situated\s+at|no\.?)\s+([^,.;]{5,120})/i.exec(text);
  if (property) out.property = collapse(property[1]);

  const purposeRe = /\b(?:for|regarding|about|on account of|towards)\s+([^.;]{4,140}?)(?=\s+(?:from|to|against|dated|at|for)\b|[.;]|$)/gi;
  let purposeMatch;
  while ((purposeMatch = purposeRe.exec(text))) {
    const rest = purposeMatch[1].trim();
    if (/^(?:rs\.?|inr|₹|\d)/i.test(rest)) continue;
    out.purpose = collapse(rest.split(/\s+(?:from|to|against|dated|at|for)\b/i)[0]);
    break;
  }
  return out;
}

function numberFrom(text, keywords) {
  const re = new RegExp(`(${keywords.join('|')})\\s*(?:of|is|@|:)?\\s*(?:rs\\.?|inr|₹)?\\s*([\\d][\\d,]*(?:\\.\\d{1,2})?)\\s*(lakh|lakhs|lac|crore|crores|thousand|k)?`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  let value = Number(m[2].replace(/,/g, ''));
  const unit = (m[3] || '').toLowerCase();
  if (unit.startsWith('lakh') || unit.startsWith('lac')) value *= 100000;
  else if (unit.startsWith('crore')) value *= 10000000;
  else if (unit.startsWith('thousand') || unit === 'k') value *= 1000;
  return value;
}

/**
 * Turn a one-line instruction into a filled draft.
 * @returns {Promise<{text:string, missing:string[], values:object, template:object}>}
 */
export async function fillDraft({ instruction, templateId, overrides = {}, authorName = '' }) {
  const template = templateId ? TEMPLATE_BY_ID.get(templateId) : matchTemplate(instruction);
  if (!template) return null;

  const text = String(instruction || '');
  const names = extractRequestedNames(text);
  const analysis = analyzeDocument({ text, filename: 'instruction.txt', caption: text });
  const named = analysis.parties.map((p) => p.name);
  const city = overrides.city || findCity(text, 'Jaipur');
  const todayIso = toIso(new Date());
  const amount = overrides.amount ?? (analysis.amounts[0]?.value || numberFrom(text, ['amount', 'loan', 'cheque', 'rent', 'salary', 'deposit', 'fee', 'sum']));
  const rent = overrides.rent ?? numberFrom(text, ['monthly rent', 'rent', 'per month', 'at']);
  // "between A and B at Jaipur for 11 months at Rs 15,000 deposit 60,000"
  const deposit = overrides.deposit ?? numberFrom(text, ['deposit', 'advance']);
  const tenure = overrides.tenureMonths ?? Number((/(\d{1,2})\s*(?:month|mahine)/i.exec(text) || [])[1] || template.defaults?.tenureMonths || 0);
  const noticeDays = overrides.noticeDays ?? Number((/(\d{1,3})\s*(?:days?|din)/i.exec(text) || [])[1] || template.defaults?.noticeDays || 15);

  const clientMaybe = names.client || overrides.clientName || named[0] || '______________________';
  const oppositeMaybe = names.opposite || overrides.oppositeName || named[1] || '______________________';

  const values = {
    today: formatDate(todayIso, { long: true }),
    year: todayIso.slice(0, 4),
    city,
    reference: `XDM/${todayIso.replace(/-/g, '')}/${Math.floor(Math.random() * 900 + 100)}`,
    clientName: cleanPartyName(clientMaybe),
    clientAddress: overrides.clientAddress || '____________________________________________',
    oppositeName: cleanPartyName(oppositeMaybe),
    oppositeAddress: overrides.oppositeAddress || '____________________________________________',
    advocateName: overrides.advocateName || authorName || '______________________',
    property: names.property || overrides.property || '____________________________________________',
    purpose: names.purpose || overrides.purpose || '____________________________________________',
    amountText: amount ? formatIndianCurrency(amount) : 'Rs. ______________',
    amountWords: amount ? rupeesInWords(amount) : '________________________________',
    rentText: rent ? formatIndianCurrency(rent) : 'Rs. ______________',
    rentWords: rent ? rupeesInWords(rent) : '________________________________',
    depositText: deposit ? formatIndianCurrency(deposit) : 'Rs. ______________',
    depositWords: deposit ? rupeesInWords(deposit) : '________________________________',
    tenureMonths: tenure || 11,
    noticeDays: noticeDays || 15,
    startDate: formatDate(todayIso, { long: true }),
    endDate: formatDate(tenure ? addDays(todayIso, Math.round(tenure * 30.44)) : addDays(todayIso, 335), { long: true }),
    chequeNo: (/(?:cheque\s*(?:no\.?|number)?\s*)(\d{4,12})/i.exec(text) || [])[1] || '______________',
    chequeDate: (/(?:cheque\s*(?:dated|date)\s*)([0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4})/i.exec(text) || [])[1] || '______________',
    bankName: (/(?:bank\s*(?:named|of)?\s*)([A-Z][A-Za-z ]{3,40}Bank)/i.exec(text) || [])[1] || '______________________',
    dueDate: (/(?:due|payable)\s*(?:on|by|date)?\s*([0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4})/i.exec(text)
      || /\bdated\s+([0-9]{1,2}[\/.-][0-9]{1,2}[\/.-][0-9]{2,4})/i.exec(text)
      || [])[1] || '__________________',
    court: overrides.court || (/(?:in\s+the\s+court\s+of|before)\s+([A-Za-z .]{4,60})/i.exec(text) || [])[1] || '______________________',
    caseNo: overrides.caseNo || (/(?:case\s*(?:no\.?)?\s*)([A-Z0-9\/\-]{3,20})/i.exec(text) || [])[1] || '__________ of ________',
    caseTitle: overrides.caseTitle || '______________________',
    partyRole: overrides.partyRole || 'Plaintiff / Defendant',
  };

  let output = template.build(values);
  const missing = [];
  output = output.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null || String(value).includes('____')) {
      if (!missing.includes(key)) missing.push(key);
      return value ?? '______________________';
    }
    return String(value);
  });
  // Highlight remaining fill-in blanks so they are easy to spot.
  output = output.replace(/_{6,}/g, '____________________');

  return { text: output, missing, values, template };
}

function cleanPartyName(name) {
  if (!name || name.includes('___')) return '______________________';
  return titleCase(collapse(name).replace(/\s+/g, ' ')).slice(0, 100);
}

const FIELD_LABELS = {
  clientName: 'your client / first party name',
  clientAddress: 'client address',
  oppositeName: 'other party name',
  oppositeAddress: 'other party address',
  advocateName: 'advocate name for signature',
  property: 'property description',
  purpose: 'purpose / facts',
  amountText: 'amount',
  amountWords: 'amount in words',
  rentText: 'monthly rent',
  rentWords: 'rent in words',
  depositText: 'security deposit',
  depositWords: 'deposit in words',
  chequeNo: 'cheque number',
  chequeDate: 'cheque date',
  bankName: 'bank name',
  dueDate: 'due date',
  court: 'court name',
  caseNo: 'case number',
  caseTitle: 'case title',
  partyRole: 'party role',
  city: 'city',
};

export function describeMissing(missing) {
  return missing.map((key) => FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').toLowerCase());
}

/**
 * Create a draft document, save PDF/DOCX/TXT to the library, and register it.
 */
export async function createDraftDocument({ owner, instruction, templateId, overrides = {}, authorName = '', matterId = null }) {
  const filled = await fillDraft({ instruction, templateId, overrides, authorName });
  if (!filled) return null;

  const { text, missing, template } = filled;
  const title = `${template.label}${filled.values.oppositeName.includes('___') ? '' : ` — ${filled.values.oppositeName}`}`;
  const docDate = toIso(new Date());

  const doc = createDocument({
    owner,
    matter_id: matterId,
    title: title.slice(0, 100),
    doc_type: 'draft',
    type_label: TYPE_BY_ID.get('draft')?.label || 'Draft',
    type_confidence: 0.99,
    doc_date: docDate,
    date_source: 'created',
    original_name: `${slugify(title)}.txt`,
    mime: 'text/plain',
    size: Buffer.byteLength(text, 'utf8'),
    status: 'filed',
    source: 'draft',
    text,
    text_source: 'generated',
    summary: `Draft ${template.label.toLowerCase()} prepared on ${formatDate(docDate, { long: true })}.${missing.length ? ` Needs: ${describeMissing(missing).slice(0, 4).join(', ')}.` : ''}`,
    key_points: missing.length ? [`Fill in: ${describeMissing(missing).join(', ')}`] : ['All fields filled automatically — please verify before use.'],
    parties: [
      ...(filled.values.clientName.includes('___') ? [] : [{ name: filled.values.clientName, role: 'First Party' }]),
      ...(filled.values.oppositeName.includes('___') ? [] : [{ name: filled.values.oppositeName, role: 'Other Party' }]),
    ],
    amounts: filled.values.amountText.includes('___') ? [] : [{ raw: filled.values.amountText, label: 'Amount', value: null, context: '' }],
    statutes: [],
    deadlines_json: [],
    clauses: [],
    tags: ['draft', template.id.replace(/_/g, ' ')],
    entities: { template: template.id, missing: describeMissing(missing), pageMeta: [] },
    confidence: 0.99,
    needs_review: missing.length > 0,
    language: 'en',
  });

  const relFolder = libraryFolder({ ownerSlug: ownerSlug(owner), matter: null, docType: 'draft' });
  const absFolder = path.join(config.libraryDir, relFolder);
  await fs.mkdir(absFolder, { recursive: true });
  const base = canonicalFileName({ docDate, title, id: doc.id, ext: '.pdf' }).replace(/\.pdf$/i, '');

  const pdfBuffer = buildPdf({ blocks: pdfBlocksFromText(text), title, footer: `${title}  ·  page {page} of {total}` });
  const docxBuffer = await docxFromText(text, { title });
  const pdfPath = path.join(absFolder, `${base}.pdf`);
  const docxPath = path.join(absFolder, `${base}.docx`);
  const txtPath = path.join(absFolder, `${base}.txt`);
  await Promise.all([
    fs.writeFile(pdfPath, pdfBuffer),
    fs.writeFile(docxPath, docxBuffer),
    fs.writeFile(txtPath, text, 'utf8'),
  ]);

  const updated = updateDocument(doc.id, {
    file_name: `${base}.pdf`,
    rel_path: path.relative(config.dataDir, pdfPath),
    mime: 'application/pdf',
    size: pdfBuffer.length,
    entities: {
      template: template.id,
      missing: describeMissing(missing),
      pageMeta: [],
      docx: path.relative(config.dataDir, docxPath),
      txt: path.relative(config.dataDir, txtPath),
    },
  });

  return { doc: updated, text, missing: describeMissing(missing), template, files: { pdf: pdfPath, docx: docxPath, txt: txtPath } };
}

export function pdfBlocksFromText(text) {
  const blocks = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { blocks.push({ text: '', style: 'spacer', size: 6 }); continue; }
    if (/^#\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^#\s+/, ''), style: 'title' }); continue; }
    if (/^##\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^##\s+/, ''), style: 'h2' }); continue; }
    if (/^[-*]\s+/.test(trimmed)) { blocks.push({ text: trimmed.replace(/^[-*]\s+/, ''), style: 'bullet' }); continue; }
    if (/^_{3,}$/.test(trimmed) || /^---$/.test(trimmed)) { blocks.push({ text: '', style: 'rule' }); continue; }
    const cleaned = trimmed
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1');
    if (/^_/.test(trimmed) || /^---/.test(trimmed)) { blocks.push({ text: cleaned, style: 'small' }); continue; }
    blocks.push({ text: cleaned, style: 'p' });
  }
  return blocks;
}

export { DRAFT_TEMPLATES, matchTemplate };
