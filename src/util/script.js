/**
 * Script and language helpers for English, Hindi (Devanagari) and Urdu (Arabic script).
 *
 * Indian legal papers arrive in all three, often mixed in one file: an English
 * heading with a Hindi body, an Urdu notice with a Latin case number. Everything
 * downstream (search, dates, amounts, parties) runs through here first.
 */

export const LANG_LABEL = { en: 'English', hi: 'Hindi', ur: 'Urdu', mixed: 'Mixed' };

export const MISSING_TEXT = {
  en: 'no readable text inside this file',
  hi: 'इस फ़ाइल में पढ़ने योग्य पाठ नहीं मिला',
  ur: 'اس فائل میں پڑھنے کے قابل متن نہیں ملا',
};

export const MONTHS_LOCAL = {
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
  ur: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
};

const DEVANAGARI = /[\u0900-\u097F]/;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const DEV_RANGE = [0x0966, 0x096f];
const AR_INDIC = [0x0660, 0x0669];
const AR_EASTERN = [0x06f0, 0x06f9];

/** ० ١ ۱ → 0 1 */
export function foldDigits(text) {
  return String(text || '').replace(/[\u0966-\u096F\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.codePointAt(0);
    if (code >= DEV_RANGE[0] && code <= DEV_RANGE[1]) return String(code - DEV_RANGE[0]);
    if (code >= AR_INDIC[0] && code <= AR_INDIC[1]) return String(code - AR_INDIC[0]);
    if (code >= AR_EASTERN[0] && code <= AR_EASTERN[1]) return String(code - AR_EASTERN[0]);
    return ch;
  });
}

/** Count characters per script — used for language detection and mixed-document notes. */
export function scriptCounts(text) {
  const sample = String(text || '').slice(0, 8000);
  const devanagari = (sample.match(/[\u0900-\u097F]/g) || []).length;
  const arabic = (sample.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return { devanagari, arabic, latin };
}

/** 'hi' | 'ur' | 'en' | 'mixed' */
export function scriptLanguage(text) {
  const { devanagari, arabic, latin } = scriptCounts(text);
  const local = devanagari + arabic;
  if (local < 15) return 'en';
  if (latin > local * 1.6) return 'mixed';
  if (arabic > devanagari * 1.5) return 'ur';
  if (devanagari > arabic * 1.5) return 'hi';
  return 'mixed';
}

export const hasDevanagari = (text) => DEVANAGARI.test(String(text || ''));
export const hasArabic = (text) => ARABIC.test(String(text || ''));
export const isRtl = (lang) => lang === 'ur';

/** 17 April 2026 → 17 अप्रैल 2026 / 17 اپریل 2026 */
export function formatDateLocal(iso, lang, { long = true } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  const [, year, month, day] = match;
  const names = MONTHS_LOCAL[lang];
  if (!names) return '';
  const monthName = names[Number(month) - 1];
  if (!monthName) return '';
  return long ? `${Number(day)} ${monthName} ${year}` : `${Number(day)}/${Number(month)}/${year}`;
}

/** "Rs. 25,000" → "रु. 25,000" / "روپے 25,000" */
export function currencyLocal(amount, lang) {
  if (lang === 'hi') return `रु. ${amount}`;
  if (lang === 'ur') return `روپے ${amount}`;
  return `Rs. ${amount}`;
}

/**
 * Latin spelling of the language, for the English line of a card
 * ("Hindi document, English summary").
 */
export function languageLine(lang) {
  if (lang === 'hi') return 'Hindi';
  if (lang === 'ur') return 'Urdu';
  if (lang === 'mixed') return 'Hindi/Urdu + English';
  return null;
}

/* ── transliteration (for readable ASCII file names) ─────────────────────── */

const DEV_MAP = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh',
  'फ़': 'f', 'य़': 'y',
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const AR_MAP = {
  'ا': 'a', 'آ': 'aa', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h',
  'خ': 'kh', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ک': 'k', 'ك': 'k',
  'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o', 'ؤ': 'o', 'ہ': 'h', 'ھ': 'h', 'ة': 'h',
  'ی': 'i', 'ي': 'i', 'ئ': 'i', 'ے': 'e', 'ۓ': 'e', 'ء': '', '٠': '0', '١': '1', '٢': '2', '٣': '3',
  '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3',
  '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

const DEV_CONSONANTS = new Set([...'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळक़ख़ग़ज़ड़ढ़फ़य़']);
const DEV_MATRAS = /[\u093E-\u094C\u0962\u0963]/;

/**
 * किराया अनुबंध → kiraya anubandh, قانونی نوٹس → qanoni nots
 * Good enough to read as a file name, never used for matching.
 */
export function transliterate(input) {
  const text = String(input || '');
  if (!/[\u0900-\u097F\u0600-\u06FF]/.test(text)) return text;

  const out = []; // { ch, inherent }
  const chars = [...text.normalize('NFC')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (DEV_MAP[ch] !== undefined) {
      out.push({ ch: DEV_MAP[ch], inherent: false });
      if (DEV_CONSONANTS.has(ch)) {
        const next = chars[i + 1] || '';
        if (!DEV_MATRAS.test(next) && next !== '्' && next !== '़' && next !== 'ं') {
          out.push({ ch: 'a', inherent: true });
        }
      }
      continue;
    }
    if (/[\u064B-\u065F\u0670\u200c\u200d]/.test(ch)) continue;
    if (AR_MAP[ch] !== undefined) { out.push({ ch: AR_MAP[ch], inherent: false }); continue; }
    out.push({ ch, inherent: false });
  }

  // A devanagari inherent "a" is silent at the end of a word ("राम" → "ram"),
  // but a written matra is not ("शर्मा" → "sharma").
  let result = '';
  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    const next = out[i + 1];
    const atWordEnd = !next || /[\s.,;:!?)\]]/.test(next.ch);
    if (item.inherent && atWordEnd) continue;
    result += item.ch;
  }
  return result;
}

