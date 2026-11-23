/**
 * Hindi (Devanagari) and Urdu (Arabic script) reading of Indian legal papers.
 *
 * English papers are handled in entities.js. This module adds the pieces that
 * only appear in Hindi/Urdu drafting: parties joined by "के बीच" / "کے درمیان",
 * "बनाम" / "بنام" court headings, "प्रति" / "بنام" addressees, case numbers in
 * Devanagari, amounts in lakh/crore words, and court names.
 */
import { collapse, titleCase, normalize } from '../util/text.js';
import { foldDigits, transliterate, hasDevanagari, hasArabic } from '../util/script.js';

/* ── roles ─────────────────────────────────────────────────────────────────── */

const LOCAL_ROLES = [
  [/(?:मकान\s*मालिक|भवन\s*स्वामी|मालिक)/, 'Lessor'],
  [/(?:किरायेदार|किराया\s*दार)/, 'Lessee'],
  [/(?:विक्रेता|विक्रयकर्ता)/, 'Vendor'],
  [/(?:क्रेता|खरीदार)/, 'Vendee'],
  [/(?:प्रतिवादी)/, 'Defendant'],
  [/(?:वादी|वादकारी)/, 'Plaintiff'],
  [/(?:याचिकाकर्ता)/, 'Petitioner'],
  [/(?:आवेदक|प्रार्थी)/, 'Applicant'],
  [/(?:अभियुक्त|आरोपी)/, 'Accused'],
  [/(?:प्रथम\s*पक्ष|पहला\s*पक्ष)/, 'First Party'],
  [/(?:द्वितीय\s*पक्ष|दूसरा\s*पक्ष)/, 'Second Party'],
  [/(?:गवाह|साक्षी)/, 'Witness'],
  [/(?:शपथकर्ता|शपथ\s*कर्ता)/, 'Deponent'],
  [/(?:مالک\s*مکان|مالک)/, 'Lessor'],
  [/(?:کرایہ\s*دار|کرایہ\s*گیر)/, 'Lessee'],
  [/(?:بائع|فروخت\s*کرنے\s*والا)/, 'Vendor'],
  [/(?:خریدار)/, 'Vendee'],
  [/(?:مدعا\s*علیہ)/, 'Defendant'],
  [/(?:مدعی)/, 'Plaintiff'],
  [/(?:درخواست\s*گزار)/, 'Applicant'],
  [/(?:ملزم)/, 'Accused'],
  [/(?:فریق\s*اول)/, 'First Party'],
  [/(?:فریق\s*دوم|دوسرا\s*فریق)/, 'Second Party'],
  [/(?:گواہ)/, 'Witness'],
];

export function localRole(segment) {
  const text = String(segment || '');
  for (const [re, label] of LOCAL_ROLES) if (re.test(text)) return label;
  return null;
}

/* ── names ─────────────────────────────────────────────────────────────────── */

const PLACE_OR_RELATION = /(?:\s*(?:पुत्र|पुत्री|पत्नी|पति|निवासी|साकिन|निवासिनी|उम्र|आयु|पिता|माता|पत्नी\s*के|पुत्र\s*के)[\s\S]*$)|(?:\s*(?:ولد|زوجہ|ساکن|ساکنہ|عمر|پتہ|مکاں)[\s\S]*$)/i;

const NAME_STOP_LOCAL = new Set([
  'प्रति', 'महोदय', 'महोदया', 'न्यायालय', 'अधिवक्ता', 'दिनांक', 'विषय', 'विषय-',
  'धारा', 'अधिनियम', 'जिला', 'न्यायाधीश', 'पक्ष', 'आदि', 'यह', 'वह', 'मैं', 'हम',
  'بنام', 'عدالت', 'تاریخ', 'دفعہ', 'قانون', 'ضلع', 'جج', 'فریق', 'میں', 'ہم',
]);

// "تاریخ: 16 اکتوبر 2026" is a date line, not a party.
const DATE_OR_MONTH = new Set([
  'जनवरी', 'फरवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'सितम्बर',
  'अक्टूबर', 'अक्तूबर', 'नवंबर', 'नवम्बर', 'दिसंबर', 'दिसम्बर',
  'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
  'तारीख', 'दिनांक', 'तिथि', 'تاریخ', 'ईस्वी', 'ईसवी', 'سن',
]);

export function isLocalName(raw) {
  const name = collapse(String(raw || ''))
    .replace(/^[,;:\-\u2013\u2014()"'।\s]+/, '')
    .replace(/[,;:\-\u2013\u2014()"'।۔\s]+$/, '')
    .trim();
  if (!name || name.length < 3 || name.length > 70) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  if (NAME_STOP_LOCAL.has(words[0])) return false;
  if (/\d{3,}/.test(name)) return false;
  if (/[:：]/.test(name)) return false;
  if (words.every((w) => DATE_OR_MONTH.has(w.replace(/[।۔,]/g, '')))) return false;
  if (/[।۔]/.test(name)) return false;
  if (/(?:है|हैं|किया|करना|ہے|ہیں|کیا|کرنا)$/.test(name)) return false;
  return true;
}

/** Drop "पुत्र श्री …", "साकिन …", "(किरायेदार)" and similar from a captured name. */
const ROLE_TAIL = /\s*(?:\.{2,}|…)?\s*(?:वादी|प्रतिवादी|अभियुक्त|आरोपी|याचिकाकर्ता|आवेदक|गवाह|साक्षी|पक्ष|مدعی|مدعا\s*علیہ|ملزم|گواہ|فریق)\s*$/i;

export function cleanLocalName(raw) {
  return collapse(String(raw || ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(ROLE_TAIL, '')
    .replace(/\s*(?:\.{2,}|…)\s*$/, '')
    .replace(PLACE_OR_RELATION, '')
    .replace(/^(?:श्री|श्रीमती|सुश्री|डॉ॰|डॉ\.|جناب|محترمہ|محترم|مسٹر)\s*/i, (m) => m)
    .replace(/\s*[-–—,]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ── parties ───────────────────────────────────────────────────────────────── */

const HEADING_LINE = /^(?:किराया|विक्रय|शपथ|वकालतनामा|नोटिस|सूचना|वाद|अनुबंध|समझौता|प्रार्थना|आवेदन|अधिकार\s*पत्र|اقرار|معاہدہ|نوٹس|قانونی|درخواست|مقدمہ|بیع|حلف)/i;

/**
 * The name at the end of a drafting chunk: "… जयपुर में श्री राजेश शर्मा पुत्र श्री … (मकान मालिक)"
 * → "श्री राजेश शर्मा".
 */
function nameFromChunk(chunk) {
  let s = collapse(String(chunk || ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;:।۔]+\s*$/, ' ');
  s = s.replace(PLACE_OR_RELATION, ' ');
  const parts = s.split(/(?:[,;।۔]|\s(?:में|کو|نے|میں)\s)/).filter((part) => part.trim());
  const tail = parts.pop() || '';
  const words = tail.trim().split(/\s+/).filter((w) => w && !/\d/.test(w));
  return words.slice(-4).join(' ');
}

/**
 * Pull parties out of Hindi/Urdu drafting.
 * @returns {Array<{name:string, role:string|null, where:string, priority:number, index:number}>}
 */
export function extractLocalParties(text) {
  const source = String(text || '');
  if (!hasDevanagari(source) && !hasArabic(source)) return [];
  const head = source.slice(0, 12000);
  const found = [];
  const seen = new Set();

  const push = (raw, role, where, priority, index) => {
    const name = cleanLocalName(raw);
    if (!isLocalName(name)) return;
    const key = normalize(name).replace(/[^\p{L}\p{N}]/gu, '');
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key);
    found.push({ name, role: role || null, where, priority, index });
  };

  // 1. "… A तथा B के बीच …" / "A اور B کے درمیان"
  const between = /(?:के\s*बीच|के\s*मध्ये|کے\s*درمیان)/i.exec(head);
  if (between) {
    const before = head.slice(Math.max(0, between.index - 400), between.index);
    const line = before.split(/[\n।۔]/).filter((part) => part.trim()).pop() || before;
    const chunks = line.split(/\s*(?:तथा|एवं|और|اور)\s*/i).filter((c) => c.trim().length > 2);
    const names = chunks.slice(-2);
    if (names.length === 2) {
      names.forEach((chunk, i) => push(nameFromChunk(chunk), localRole(chunk), 'between', 5, Math.max(0, between.index - 300 + i)));
    }
  }

  // 2. "… (विक्रेता)" — the role is written in brackets after the name
  const roleMentions = /[\u0900-\u097F\u0600-\u06FF][^\n()।]{0,80}?\(\s*([^)]{2,25})\s*\)/g;
  let rm;
  while ((rm = roleMentions.exec(head))) {
    const role = localRole(rm[1]);
    if (!role) continue;
    const before = head.slice(Math.max(0, rm.index - 120), rm.index + 1);
    push(nameFromChunk(before), role, 'role', 4, rm.index);
  }

  // 3. Court heading "… बनाम …" / notice addressee "بنام …"
  const lines = head.split('\n').map((l) => l.trim());
  for (let i = 1; i < lines.length; i++) {
    const word = /^(बनाम|विरुद्ध|بنام|مخالف)$/i.exec(lines[i]);
    if (!word) continue;
    const isNoticeStyle = /بنام|مخالف|प्रति/i.test(word[1]);
    const below = lines.slice(i + 1).find((l) => l.length > 3);
    const above = [...lines.slice(0, i)].reverse().find((l) => l.length > 3);
    if (below) push(nameFromChunk(below), isNoticeStyle ? 'Addressee' : (localRole(below) || 'Defendant'), isNoticeStyle ? 'addressed' : 'versus', 4, head.indexOf(below));
    // In a notice the line over "بنام" is the date or the subject — never a party.
    if (!isNoticeStyle && above && !HEADING_LINE.test(above)) {
      push(nameFromChunk(above), localRole(above) || 'Plaintiff', 'versus', 5, head.indexOf(above));
    }
    if (below || above) break;
  }

  // 4. "प्रति, …" addressee block
  const to = /(?:^|\n)\s*(?:प्रति)\s*[,:\-]?\s*\n?\s*([^\n]{3,70})/i.exec(head);
  if (to) push(nameFromChunk(to[1]), 'Addressee', 'addressed', 4, to.index);

  return found.sort((a, b) => a.index - b.index).slice(0, 6);
}

/* ── case numbers ──────────────────────────────────────────────────────────── */

const CASE_LOCAL = [
  { re: /((?:वाद|मुकदमा|प्रकरण|अपील|याचिका|आवेदन|प्राथमिकी|एफ\.?\s?आई\.?\s?आर\.?)\s*(?:संख्या|नंबर|नं\.?)\s*[:\-]?\s*(\d{1,6})\s*(?:\/|of|के)\s*(\d{4}))/i, label: 'case' },
  { re: /((?:مقدمہ|کیس|اپیل|درخواست|ایف\s*آئی\s*آر)\s*(?:نمبر|نمبر۔|نمبر:)\s*[:\-]?\s*(\d{1,6})\s*(?:\/|of)\s*(\d{4}))/i, label: 'case' },
];

export function extractLocalCaseNumbers(text) {
  const source = foldDigits(String(text || '').slice(0, 40000));
  const out = [];
  for (const { re } of CASE_LOCAL) {
    let m;
    const global = new RegExp(re.source, 'gi');
    while ((m = global.exec(source))) out.push(collapse(m[1]));
  }
  return out;
}

/* ── courts ────────────────────────────────────────────────────────────────── */

const COURTS_LOCAL = [
  [/सर्वोच्च\s*न्यायालय|उच्चतम\s*न्यायालय|سپریم\s*کورٹ/i, 'Supreme Court of India'],
  [/((?:[\u0900-\u097F]+\s+){0,2})उच्च\s*न्यायालय|ہائی\s*کورٹ/i, 'High Court'],
  [/जिला\s*(?:एवं|व\s*)?(?:सत्र|सेशन)\s*(?:न्यायालय|न्यायाधीश)|ضلع\s*(?:و\s*)?سیشن\s*(?:عدالت|جج)/i, 'District & Sessions Court'],
  [/न्यायिक\s*मजिस्ट्रेट|ज्यूडिशियल\s*मजिस्ट्रेट|جوڈیشل\s*مجسٹریٹ/i, 'Court of Judicial Magistrate'],
  [/पारिवारिक\s*न्यायालय|फैमिली\s*कोर्ट|خاندانی\s*عدالت/i, 'Family Court'],
  [/उप\s*निबंधक|सब\s*रजिस्ट्रार|سب\s*رجسٹرار/i, 'Sub-Registrar Office'],
  [/तहसीलदार|उप\s*मंडल\s*मजिस्ट्रेट/i, 'Revenue Office'],
  [/(?:जिला\s*)?उपभोक्ता\s*(?:आयोग|फोरम)|کنزیومر\s*کورٹ/i, 'Consumer Commission'],
  [/\[?\s*लोक\s*अदालत|لوک\s*عدالت/i, 'Lok Adalat'],
  [/किराया\s*नियंत्रक|رینٹ\s*کنٹرولر/i, 'Rent Controller'],
  [/माननीय\s*न्यायालय|न्यायालय|عدالت/i, 'Court'],
];

export function extractLocalCourt(text) {
  const source = String(text || '').slice(0, 20000);
  // A bare "न्यायालय / عدالت" only counts as the forum when the paper is actually
  // a court paper — in a rent agreement it is just the jurisdiction clause.
  const courtPaper = /(?:आदेश|फैसला|निर्णय|याचिका|वाद\s*संख्या|प्रकरण\s*संख्या|दायर|प्रस्तुत|अपील|حکم|فیصلہ|درخواست|دائر|اپیل|مقدمہ)/.test(source);
  for (const [re, name] of COURTS_LOCAL) {
    if (name === 'Court' && !courtPaper) continue;
    const m = re.exec(source);
    if (!m) continue;
    if (name === 'High Court' && m[1]) {
      const state = collapse(m[1]).split(/\s+/).pop();
      if (state && state.length > 2) return `${titleCase(transliterate(state))} High Court`;
    }
    return name;
  }
  return null;
}

/* ── statutes ──────────────────────────────────────────────────────────────── */

export function extractLocalStatutes(text) {
  const source = foldDigits(String(text || ''));
  const out = [];
  const re = /(?:धारा|دفعتہ|دفعہ)\s*(\d{1,4}[A-Z]?)\s*(?:के\s*अंतर्गत\s*)?((?:[\u0900-\u097F\u0600-\u06FF]+\s*){1,5}(?:अधिनियम|संहिता|ایکٹ|قانون))/g;
  let m;
  while ((m = re.exec(source))) {
    out.push({ section: m[1], act: collapse(m[2]), raw: collapse(m[0]) });
  }
  return out;
}
