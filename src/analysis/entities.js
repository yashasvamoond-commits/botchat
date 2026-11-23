import { findDates, parseDate, addDays, toIso } from '../util/dates.js';
import { collapse, normalize, titleCase, clip } from '../util/text.js';
import { foldDigits, scriptLanguage, hasDevanagari, hasArabic } from '../util/script.js';
import {
  extractLocalParties, extractLocalCaseNumbers, extractLocalCourt, extractLocalStatutes, isLocalName,
} from './localized.js';

/** Prepare money text: ASCII digits, plain commas, and "रु"/"روپے" forms kept intact. */
function localizeAmountText(input) {
  return foldDigits(input)
    .replace(/[\u060C\u066B\u066C]/g, ',')
    .replace(/(\d)\s*\/\s*-/g, '$1/-');
}

const HONORIFIC = /(?:Mr|Mrs|Ms|Dr|Shri|Shrimati|Smt|Late|M\/s|Messrs)\.?/i;

const ACT_NAMES = {
  ipc: 'Indian Penal Code',
  bns: 'Bharatiya Nyaya Sanhita',
  crpc: 'Code of Criminal Procedure',
  bnss: 'Bharatiya Nagarik Suraksha Sanhita',
  cpc: 'Code of Civil Procedure',
  bsa: 'Bharatiya Sakshya Adhiniyam',
  'ni act': 'Negotiable Instruments Act',
  'negotiable instruments act': 'Negotiable Instruments Act',
  'transfer of property act': 'Transfer of Property Act',
  'registration act': 'Registration Act',
  'indian contract act': 'Indian Contract Act',
  'contract act': 'Indian Contract Act',
  'limitation act': 'Limitation Act',
  'companies act': 'Companies Act',
  'hindu marriage act': 'Hindu Marriage Act',
  hma: 'Hindu Marriage Act',
  'hindu succession act': 'Hindu Succession Act',
  'domestic violence act': 'Protection of Women from Domestic Violence Act',
  'dv act': 'Protection of Women from Domestic Violence Act',
  rera: 'Real Estate (Regulation and Development) Act',
  'motor vehicles act': 'Motor Vehicles Act',
  'consumer protection act': 'Consumer Protection Act',
  'arbitration and conciliation act': 'Arbitration and Conciliation Act',
  'arbitration act': 'Arbitration and Conciliation Act',
  'specific relief act': 'Specific Relief Act',
  'indian stamp act': 'Indian Stamp Act',
  'stamp act': 'Indian Stamp Act',
  'court fees act': 'Court Fees Act',
  'it act': 'Information Technology Act',
  'income tax act': 'Income Tax Act',
  'gst act': 'Central Goods and Services Tax Act',
  'motor accident claims': 'Motor Vehicles Act',
  'rent control act': 'Rent Control Act',
  'right to information act': 'Right to Information Act',
  rti: 'Right to Information Act',
  'pocso act': 'POCSO Act',
  'sc/st act': 'Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act',
  'family courts act': 'Family Courts Act',
  'maintenance act': 'Protection of Women from Domestic Violence Act',
  'advocates act': 'Advocates Act',
  'notaries act': 'Notaries Act',
};

const COURT_PATTERNS = [
  { re: /supreme\s+court\s+of\s+india/i, name: 'Supreme Court of India' },
  { re: /high\s+court\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, dynamic: true, suffix: 'High Court' },
  { re: /([A-Z][a-z]+)\s+high\s+court/i, dynamic: true, suffix: 'High Court' },
  { re: /district\s*(?:&|and)?\s*sessions?\s+court[,\s]+([A-Z][a-z]+)/i, dynamic: true, suffix: 'District & Sessions Court' },
  { re: /district\s*(?:&|and)\s*sessions?\s+judge[,\s]+([A-Z][a-z]+)/i, dynamic: true, suffix: 'District & Sessions Court' },
  { re: /in\s+the\s+court\s+of\s+(?:the\s+)?(?:learned\s+)?(?:additional\s+)?district\s*(?:&|and)\s*sessions?\s+judge[,\s]*([A-Z][a-z]+)/i, dynamic: true, suffix: 'District & Sessions Court' },
  { re: /family\s+court[,\s]+([A-Z][a-z]+)/i, dynamic: true, suffix: 'Family Court' },
  { re: /(?:judicial\s+)?magistrate[,\s]+([A-Z][a-z]+)/i, dynamic: true, suffix: 'Court of Judicial Magistrate' },
  { re: /motor\s+accident\s+claims\s+tribunal/i, name: 'Motor Accident Claims Tribunal' },
  { re: /\bNCLT\b/i, name: 'National Company Law Tribunal' },
  { re: /\bDRT\b/i, name: 'Debts Recovery Tribunal' },
  { re: /consumer\s+(?:disputes\s+)?(?:redressal\s+)?commission/i, name: 'Consumer Commission' },
  { re: /\bRERA\b/i, name: 'Real Estate Regulatory Authority' },
  { re: /rent\s+controller/i, name: 'Rent Controller' },
  { re: /sub[-\s]?registrar/i, name: 'Sub-Registrar Office' },
  { re: /tehsildar|sub[-\s]?divisional\s+magistrate|\bSDM\b/i, name: 'Revenue Office' },
  { re: /(?:in|before)\s+the\s+court\s+of\s+(?:the\s+)?([^\n,]{3,60})(?:,?\s*([A-Za-z][a-z]+))?/i, raw: true },
  { re: /lok\s+adalat/i, name: 'Lok Adalat' },
  { re: /tribunal/i, name: 'Tribunal' },
];

const ROLE_WORDS = [
  'Lessor', 'Lessee', 'Licensor', 'Licensee', 'Landlord', 'Tenant', 'Vendor', 'Vendee',
  'Seller', 'Purchaser', 'Plaintiff', 'Defendant', 'Petitioner', 'Respondent', 'Complainant',
  'Accused', 'First Party', 'Second Party', 'Third Party', 'Mortgagor', 'Mortgagee',
  'Borrower', 'Lender', 'Employer', 'Employee', 'Testator', 'Executor', 'Donor', 'Donee',
  'Principal', 'Attorney Holder', 'Purchaser', 'Guarantor', 'Partner', 'Client', 'Advocate',
  'Buyer', 'Owner', 'Assignor', 'Assignee',
];

const CONNECTORS = new Set(['of', 'and', '&', 'the', 'de', 'da', 'bin', 'binti', 'kumar', 'devi', 'singh', 'lal', 'chand']);

const NAME_STOP = new Set([
  'the', 'this', 'that', 'these', 'those', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so',
  'to', 'from', 'by', 'for', 'with', 'without', 'under', 'over', 'into', 'upon', 'herein',
  'shall', 'may', 'will', 'would', 'should', 'must', 'can', 'has', 'have', 'had', 'is', 'are',
  'was', 'were', 'been', 'being', 'do', 'does', 'did', 'not', 'no', 'any', 'all', 'such',
  'said', 'above', 'below', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'hereinafter', 'herein', 'called', 'referred', 'known', 'acting', 'through', 'behalf',
  'aged', 'about', 'years', 'year', 'son', 'daughter', 'wife', 'husband', 'resident',
  'residing', 'respectively', 'party', 'parties', 'first', 'second', 'third', 'fourth',
  'court', 'hon', 'honble', "hon'ble", 'learned', 'ld', 'counsel', 'advocate', 'public',
  'prosecutor', 'versus', 'vs', 'vide', 'dated', 'subject', 'sir', 'madam', 'dear',
  'witness', 'signature', 'signed', 'name', 'date', 'place', 'notice', 'legal', 'sale',
  'deed', 'rent', 'agreement', 'order', 'judgment', 'copy', 'page', 'number', 'gstin',
  'pan', 'aadhaar', 'ifsc', 'account', 'branch', 'invoice', 'total', 'amount', 'taxable',
  'payment', 'terms', 'description', 'quantity', 'rate', 'value', 'supply', 'units', 'per',
  'unit', 'authorised', 'authorized', 'signatory', 'for', 'our', 'your', 'their', 'its',
  'my', 'we', 'i', 'me', 'you', 'he', 'she', 'it', 'they', 'them', 'his', 'her', 'also',
  'may', 'kindly', 'request', 'requested', 'please', 'hereby', 'thereof', 'therein',
  'signature', 'verification', 'verified', 'proprietor', 'partner', 'director',
  'signatory', 'manager', 'client', 'deponent', 'executant', 'witnesses', 'enclosed',
]);

const ROLE_PATTERN = 'Lessor|Lessee|Licensor|Licensee|Landlord|Tenant|Vendor|Vendee|Seller|Purchaser|Plaintiff|Defendant|Petitioner|Respondent|Complainant|Accused|Applicant|Noticee|Opposite Party|First Party|Second Party|Third Party|Mortgagor|Mortgagee|Borrower|Lender|Employer|Employee|Testator|Executrix|Executor|Donor|Donee|Principal|Attorney Holder|Guarantor|Partner|Client|Advocate|Husband|Wife|Buyer|Owner|Assignor|Assignee|Deponent|Addressee';

function cleanName(raw) {
  let name = collapse(String(raw || ''))
    .replace(/^[,;:\-\u2013\u2014()"'\s]+/, '')
    .replace(/[,;:\-\u2013\u2014()"'\s]+$/, '')
    .replace(/\s*(?:\.{2,}|…)\s*$/, '')
    .replace(/\s+(?:hereinafter|herein\s+after)\s+(?:called|referred)[\s\S]*$/i, '')
    .replace(/\s*,?\s*(?:aged\s+about|aged|s\/o|d\/o|w\/o|r\/o|son\s+of|daughter\s+of|wife\s+of|resident\s+of|residing\s+at)\b[\s\S]*$/i, '')
    .replace(/,\s*(?:Proprietor|Partner|Director|Authorised\s+Signatory|Authorized\s+Signatory|Manager|Prop\.)\b[\s\S]*$/i, '')
    .replace(/^For\s+/i, '')
    .replace(/\s+(?:Proprietor|Partner|Director|Authorised\s+Signatory|Authorized\s+Signatory|Signatory|Manager|Holder)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (name.length > 90) name = name.slice(0, 90).trim();
  return name;
}

function hasHonorific(text) {
  return new RegExp(`^(?:${HONORIFIC.source})\\s`, 'i').test(text);
}

function looksLikeName(text) {
  const t = cleanName(text);
  if (!t || t.length < 3 || t.length > 80) return false;
  // Devanagari / Arabic-script names have no capital letters to check.
  if (!/[A-Za-z]/.test(t) && (hasDevanagari(t) || hasArabic(t))) return isLocalName(t);
  if (/\d{4}/.test(t)) return false;
  if (/[;:!?]$/.test(t)) return false;
  if (/\.\.\.|…/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;

  const honorific = hasHonorific(t);
  const significant = words.filter((w) => !/^(?:of|and|&|the|de|da|bin|binti)$/i.test(w.replace(/[.,]$/, '')));
  if (!significant.length) return false;

  // Every significant word must look like part of a name.
  let capitalised = 0;
  for (const word of significant) {
    const bare = word.replace(/[.'\-,]$/, '');
    if (/^[A-Z]/.test(bare)) { capitalised += 1; continue; }
    if (CONNECTORS.has(bare.toLowerCase())) continue;
    return false; // any ordinary lowercase word disqualifies it
  }
  if (capitalised === 0) return false;
  if (!honorific && capitalised < Math.ceil(significant.length * 0.6)) return false;

  if (/^(?:Tax|Invoice|Legal|Rent|Sale|Deed|Notice|Order|Judgment|Receipt|Affidavit|Court|Bank\s+Statement|Memorandum|Articles)\b/i.test(t)
    && !/(?:Pvt|Private|Limited|Ltd|LLP)$/i.test(t)) return false;
  if (/\b(?:Tax\s+Invoice|Legal\s+Notice|Sale\s+Deed|Rent\s+Agreement|FIR|Invoice\s+No)\b/i.test(t)) return false;

  // Reject anything that reads like a clause.
  if (/\b(?:shall|may|will|has|have|been|hereby|wherein|aforesaid)\b/i.test(t)) return false;
  if (/^(?:state|union|government)\s+of\s+[A-Z]/.test(t)) return true;
  return true;
}

function roleNear(text, index, radius = 140) {
  const window = String(text || '').slice(Math.max(0, index - radius), index + radius);
  for (const role of ROLE_WORDS) {
    const re = new RegExp(`\\b${role.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(window)) return titleCase(role);
  }
  return null;
}

const UNIQUE_ROLES = new Set(['Lessor', 'Lessee', 'Vendor', 'Vendee', 'Licensor', 'Licensee', 'Mortgagor', 'Mortgagee', 'Borrower', 'Lender', 'Testator', 'Donor', 'Donee', 'Employer', 'Employee', 'Landlord', 'Tenant', 'Principal', 'Attorney Holder']);

/** The best role word inside a specific slice of text. */
function roleInSegment(segment) {
  const haystack = String(segment || '');
  let best = null;
  let bestIndex = Infinity;
  for (const role of ROLE_WORDS) {
    const re = new RegExp(`\\b${role.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    const match = re.exec(haystack);
    if (match && match.index < bestIndex) {
      bestIndex = match.index;
      best = titleCase(role);
    }
  }
  return best;
}

function firstLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  return lines[0] || String(text || '').slice(0, 120);
}

/** Extract people, companies and their roles. */
export function extractParties(text) {
  const source = String(text || '');
  const head = source.slice(0, 30000);
  const found = new Map();

  const add = (raw, role, where, priority = 1, index = 0) => {
    const name = cleanName(raw);
    if (!looksLikeName(name)) return;
    // Banks, registrars and other institutions are context, not parties.
    if (/\b(?:bank|banking|branch|treasury|sub-?registrar|registrar)\b/i.test(name) && priority < 5) return;
    const key = normalize(name)
      .replace(/\b(?:mr|mrs|ms|dr|shri|smt|late|m\/s|messrs)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (key.length < 3) return;
    const existing = found.get(key);
    if (existing) {
      if (!existing.role && role) existing.role = role;
      if (priority > existing.wherePriority) {
        existing.where = where;
        existing.wherePriority = priority;
      }
      return;
    }
    found.set(key, { name, role: role || null, where, wherePriority: priority, index });
  };

  // 1. BETWEEN … AND … — authoritative for agreements, deeds and plaints.
  const betweenRe = /\bbetween\b([\s\S]{0,320}?)\n?\s*\band\b([\s\S]{0,320}?)(?=\n\s*\n|\n\s*(?:now|whereas|in\s+witness|the\s+terms)\b|\n\s*\d+[.)]|$)/i;
  const between = betweenRe.exec(source.slice(0, 9000));
  let authoritative = false;
  if (between) {
    authoritative = true;
    const seg1 = between[1];
    const seg2 = between[2];
    const name1 = firstLine(seg1);
    const name2 = firstLine(seg2);
    add(name1, roleInSegment(seg1) || roleInSegment(source.slice(between.index, between.index + 500)), 'between', 5, between.index);
    add(name2, roleInSegment(seg2) || roleInSegment(source.slice(between.index + 200, between.index + 900)), 'between', 5, between.index + 1);
  }

  // 2. VERSUS blocks — authoritative for court papers.
  if (!authoritative) {
    let leftLine = null;
    let rightLine = null;
    let versusIndex = 0;
    const lines = head.split('\n');
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!/^(?:versus|vs\.?|v\.?)$/i.test(line)) continue;
      const above = [...lines.slice(0, i)].reverse().find((l) => l.trim().length > 2);
      const below = lines.slice(i + 1).find((l) => l.trim().length > 2);
      if (!above || !below) continue;
      leftLine = above.trim();
      rightLine = below.trim();
      versusIndex = head.indexOf(above, 0);
      break;
    }
    if (!leftLine) {
      const inline = /([A-Z][^\n]{3,110}?)\s+versus\s+([A-Z][^\n]{3,110})/i.exec(head);
      if (inline) {
        leftLine = inline[1];
        rightLine = inline[2];
        versusIndex = inline.index;
      }
    }
    if (leftLine && rightLine) {
      authoritative = true;
      const left = leftLine.replace(/\s*(?:\.{2,}|…)[\s\S]*$/, '').replace(/\b(?:Prosecution|Petitioner|Plaintiff|Applicant|Complainant)\b\s*$/i, '').trim();
      const right = rightLine.replace(/\s*(?:\.{2,}|…)[\s\S]*$/, '').trim();
      add(left, roleInSegment(left) || roleNear(head, versusIndex, 60), 'versus', 5, versusIndex);
      add(right, roleInSegment(right) || roleNear(head, versusIndex + leftLine.length, 90), 'versus', 5, versusIndex + 1);
    }
  }

  // 3. Labelled roles: "Complainant: Mr Sunil Agarwal", "Accused - Rakesh Kumar"
  const labelledRe = new RegExp(
    `\\b(${ROLE_PATTERN})\\s*[:\\-\u2013]\\s*((?:(?:${HONORIFIC.source})[ \\t]+)?[A-Z][A-Za-z.'&\\-]*(?:[ \\t]+[A-Z][A-Za-z.'&\\-]*){0,4})(?=[ \\t]{2,}|\\s*(?:${ROLE_PATTERN})\\b|[\\n,;.]|$)`,
    'gi',
  );
  let match;
  while ((match = labelledRe.exec(head))) {
    add(match[2], titleCase(match[1]), 'labelled', 4, match.index);
  }

  // 4. Self-identification: "I, Mr Rajesh Sharma, aged …" (affidavits, POA, vakalatnama)
  const selfRe = new RegExp(`\\b(?:I|We)\\s*,\\s*((?:(?:${HONORIFIC.source})[ \\t]+)?[A-Z][A-Za-z.'\\-]+(?:[ \\t]+[A-Z][A-Za-z.'\\-]+){0,4})`, 'g');
  while ((match = selfRe.exec(head))) {
    add(match[1], 'Deponent', 'self', 4, match.index);
  }

  // 5. Notice addressee: "To,\nMrs Anita Mehta"
  const toRe = /\bTo,?\s*\n+\s*((?:(?:Mr|Mrs|Ms|Dr|Shri|Smt|M\/s|Messrs)\.?\s+)?[A-Z][^\n,;]{2,70})/;
  const to = toRe.exec(head);
  if (to) add(to[1], 'Addressee', 'addressee', 3.5, to.index);

  // 6. Names with an honorific (kept for context, ranked below the big three).
  if (!authoritative) {
    const honorificRe = new RegExp(`\\b(?:${HONORIFIC.source})[ \\t]+([A-Z][A-Za-z.'\\-]+(?:[ \\t]+[A-Z][A-Za-z.'\\-]+){0,3})`, 'g');
    while ((match = honorificRe.exec(head))) {
      const honorific = match[0].match(new RegExp(`^(?:${HONORIFIC.source})\\.?`, 'i'))?.[0] || '';
      add(`${honorific} ${match[1]}`, roleNear(head, match.index, 70), 'name', 2, match.index);
    }
  }

  // 7. Companies and firms.
  const companyRe = /\b([A-Z][A-Za-z&.'\-]*(?:\s+[A-Z][A-Za-z&.'\-]*){0,4}\s+(?:Private\s+Limited|Pvt\.?\s*Ltd\.?|Limited|Ltd\.?|LLP|Bank|Co-?operative\s+Society|Housing\s+Society|Trust|Enterprises|Industries|Constructions|Developers|Associates))\b/g;
  while ((match = companyRe.exec(head))) {
    add(match[1], roleInSegment(match[0]), 'company', 1.5, match.index);
  }

  // Hindi / Urdu drafting uses its own joins, headings and role words: merge them
  // in before the ranking so a "… के बीच …" party outranks a passing mention.
  for (const local of extractLocalParties(source)) {
    const key = normalize(local.name).replace(/[^\p{L}\p{N}]/gu, '');
    if (key.length < 3) continue;
    const existing = found.get(key);
    if (existing) {
      if (!existing.role && local.role) existing.role = local.role;
      if (local.priority > existing.wherePriority) {
        existing.where = local.where;
        existing.wherePriority = local.priority;
      }
      continue;
    }
    found.set(key, { name: local.name, role: local.role || null, where: local.where, wherePriority: local.priority, index: local.index });
  }

  const ordered = [...found.values()].sort((a, b) => (b.wherePriority - a.wherePriority) || (a.index - b.index));

  // Keep the list focused: when the document states parties clearly, ignore incidental names.
  const filtered = authoritative
    ? ordered.filter((p) => p.wherePriority >= 3.5 || p.where === 'labelled')
    : ordered;

  const usedRoles = new Set();
  const parties = [];
  for (const party of filtered) {
    if (parties.length >= 6) break;
    let role = party.role;
    if (role && UNIQUE_ROLES.has(role)) {
      if (usedRoles.has(role)) role = null;
      else usedRoles.add(role);
    }
    parties.push({ name: party.name, role, where: party.where, strength: party.wherePriority });
  }
  return parties;
}

const SENTENCE_ABBREV = /(?:^|\s)(?:no|nos|rs|inr|sec|sect|vs|mr|mrs|ms|dr|adv|hon|pvt|ltd|co|sl|dt|smt|shri|संख्य|क्र|दि|श्री|अनु)["')\]]?\.$/i;

/** Start of the sentence/clause that contains `from` (ignores "No." and "Rs." dots). */
function sentenceStartBefore(source, from, limit) {
  for (let i = from - 1; i >= limit; i--) {
    const ch = source[i];
    if (ch === '।' || ch === '۔' || ch === ';' || ch === '\n') return i + 1;
    if (ch !== '.') continue;
    const tail = source.slice(Math.max(0, i - 14), i + 1);
    if (SENTENCE_ABBREV.test(tail)) continue;
    if (/\d\.$/.test(tail)) continue;
    if (i > 0 && /\d/.test(source[i - 1]) && /\d/.test(source[i + 1] || '')) continue;
    return i + 1;
  }
  return limit;
}

function sentenceEndAfter(source, from, limit) {
  for (let i = from; i < limit; i++) {
    const ch = source[i];
    if (ch === '।' || ch === '۔' || ch === ';' || ch === '\n') return i;
    if (ch !== '.') continue;
    const tail = source.slice(Math.max(0, i - 14), i + 1);
    if (SENTENCE_ABBREV.test(tail)) continue;
    if (/\d\.$/.test(tail) && /\d/.test(source[i + 1] || '')) continue;
    return i;
  }
  return limit;
}

/** Money amounts with both raw text and numeric value. */
export function extractAmounts(text) {
  const source = localizeAmountText(String(text || ''));
  const out = [];
  const covered = [];
  const WINDOW = 120;

  const push = (match, digitsRaw, unitRaw) => {
    const start = match.index;
    const end = match.index + match[0].length;
    if (covered.some(([a, b]) => start < b && end > a)) return;
    covered.push([start, end]);
    const digits = Number(String(digitsRaw).replace(/,/g, ''));
    if (!Number.isFinite(digits) || digits <= 0) return;
    let value = digits;
    const unit = String(unitRaw || '').toLowerCase();
    if (/^(?:lakh|lac|लाख|لاکھ)/.test(unit)) value = digits * 100000;
    else if (/^(?:crore|करोड़|करोड|کروڑ)/.test(unit)) value = digits * 10000000;
    else if (/^(?:thousand|k$|हज़ार|ہزار)/.test(unit)) value = digits * 1000;

    // Look at the sentence around the figure only, so a label from the next
    // clause cannot claim it ("… deposit 1,00,000. Rent 25,000 …").
    const windowStart = Math.max(0, start - WINDOW);
    const sentStart = sentenceStartBefore(source, start, windowStart);
    const sentEnd = sentenceEndAfter(source, end, end + WINDOW);
    const context = collapse(source.slice(sentStart, sentEnd));
    const anchor = Math.min(context.length, start - sentStart + Math.floor(String(digitsRaw).length / 2));
    out.push({
      raw: collapse(match[0]).replace(/^(?:rs\.?|inr)/i, 'Rs.'),
      value,
      context,
      label: guessAmountLabel(context, anchor),
    });
  };

  // "Rs. 25,000", "₹1,00,000/-", "रु. 25,000", "روپے 50,000"
  const prefix = /(?<![A-Za-z\u0900-\u097F\u0600-\u06FF])(?:Rs\.?|INR|₹|रु\.?|रुपये|रुपए|روپے|روپیہ)\s*([\d][\d,]*(?:\.\d{1,2})?)\s*(lakh|lakhs|lac|lacs|crore|crores|thousand|k|लाख|लाखों|करोड़|करोड|करोड़ों|لاکھ|کروڑ|ہزار)?\s*(?:\/-)?/gi;
  let m;
  while ((m = prefix.exec(source))) push(m, m[1], m[2]);

  // "25,000 रुपये", "50,000 روپے", "18,000/-" — the Indian postfix style
  const postfix = /([\d][\d,]*(?:\.\d{1,2})?)\s*(?:\/-|रुपये|रु\.?|روپے|روپیہ)(?!\s*[\d])/g;
  while ((m = postfix.exec(source))) push(m, m[1], '');

  // Deduplicate: the same figure means the same thing once.
  const seen = new Set();
  return out.filter((a) => {
    const key = String(a.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

const AMOUNT_LABELS = [
  { re: /security\s+deposit|interest[- ]free\s+(?:refundable\s+)?(?:security\s+)?deposit|advance\s+deposit|जमा\s*राशि|अमानत|ضمانتی\s*رقم|امانت/i, label: 'Security deposit' },
  { re: /monthly\s+rent|rent\s+(?:of|is|payable)|\brent\b|मासिक\s*किराया|किराया|प्रतिमाह|ماہانہ\s*کرایہ|کرایہ/i, label: 'Rent' },
  { re: /sale\s+consideration|total\s+consideration|purchase\s+price|sale\s+price/i, label: 'Sale consideration' },
  { re: /damages|compensation|claim|मुआवजा|हर्जाना|ہرجانہ|معاوضہ/i, label: 'Claim amount' },
  { re: /cheque|dishonou?r|चेक|चैक|چیک/i, label: 'Cheque amount' },
  { re: /\bfee\b|honorarium|professional\s+fee|फीस|शुल्क|فیس/i, label: 'Fee' },
  { re: /penalty|interest|\bIGST\b|\bCGST\b|\bSGST\b|\bGST\b/i, label: 'Tax / penalty' },
  { re: /salary|wages|remuneration/i, label: 'Salary' },
  { re: /\bloan\b|principal\s+amount/i, label: 'Loan amount' },
  { re: /total\s+(?:amount\s+)?payable|invoice\s+(?:total|value)|taxable\s+value/i, label: 'Invoice total' },
  { re: /personal\s+bond|surety/i, label: 'Bond amount' },
  { re: /costs?\s+of|litigation\s+expenses/i, label: 'Costs' },
];

function guessAmountLabel(context, amountIndex = -1) {
  const text = String(context || '');
  const anchor = amountIndex >= 0 ? amountIndex : Math.floor(text.length / 2);
  let best = null;
  let bestDistance = Infinity;
  for (const entry of AMOUNT_LABELS) {
    const re = new RegExp(entry.re.source, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const distance = Math.abs(m.index - anchor);
      // A label written before the figure ("security deposit of Rs 1,00,000")
      // is a stronger signal than one that merely follows it.
      const weighted = m.index < anchor ? distance : distance * 2;
      if (weighted < bestDistance) {
        bestDistance = weighted;
        best = entry.label;
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return best || 'Amount';
}

/** Case, FIR, cheque and other reference numbers. */
export function extractReferences(text) {
  const source = String(text || '');
  const refs = { caseNumbers: [], fir: [], cheques: [], other: [] };

  const caseRe = /\b(?:O\.?\s?S\.?|C\.?\s?S\.?|R\.?\s?S\.?\s?A\.?|Crl\.?\s?A\.?|Crl\.?\s?M\.?P\.?|W\.?\s?P\.?|C\.?\s?M\.?\s?P\.?|I\.?\s?A\.?|R\.?\s?F\.?\s?A\.?|C\.?\s?M\.?\s?A\.?|S\.?\s?B\.?\s?C\.?|C\.?\s?C\.?|C\.?\s?O\.?\s?M\.?\s?P\.?|ARB\.?|A\.?\s?P\.?|L\.?\s?P\.?\s?A\.?)\s*(?:No\.?\s*)?(\d{1,6})\s*(?:of|\/)\s*(\d{4})/gi;
  let m;
  while ((m = caseRe.exec(source))) refs.caseNumbers.push(collapse(m[0]));
  for (const local of extractLocalCaseNumbers(source)) {
    if (!refs.caseNumbers.some((existing) => normalize(existing) === normalize(local))) refs.caseNumbers.push(local);
  }
  const caseNoRe = /\b(?:case|suit|appeal|petition|application|complaint|petitioner|misc\.?)\s+(?:no\.?\s*)?([A-Z0-9\/\-]{2,20})/gi;
  while ((m = caseNoRe.exec(source))) {
    const value = collapse(m[0]);
    if (/\d/.test(value)) refs.caseNumbers.push(value);
  }
  const genericNoRe = /\b((?:[A-Z][A-Za-z.]*[ \t]+){0,4}No\.?[ \t]*\d{1,6}[ \t]*(?:of|\/)[ \t]*\d{4})/g;
  while ((m = genericNoRe.exec(source))) {
    const value = collapse(m[1]);
    if (!refs.caseNumbers.some((c) => c.includes(value))) refs.caseNumbers.push(value);
  }
  const firRe = /\bFIR\s*(?:No\.?)?\s*([0-9]{1,5})\s*(?:of|\/)\s*(\d{4})/gi;
  while ((m = firRe.exec(source))) refs.fir.push(collapse(m[0]));
  const chequeRe = /\bcheque\s*(?:no\.?|number)?\s*([0-9]{4,12})/gi;
  while ((m = chequeRe.exec(source))) refs.cheques.push(collapse(m[0]));
  const otherRe = /\b(?:policy|account|a\/c|loan|invoice|bill|receipt|application|registration|deed|khasra|khata|survey|plot|gata)\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z0-9\/\-]{3,20})/gi;
  while ((m = otherRe.exec(source))) {
    const val = collapse(m[0]);
    if (!refs.other.includes(val)) refs.other.push(val);
  }

  for (const key of Object.keys(refs)) refs[key] = [...new Set(refs[key])].slice(0, 8);
  refs.caseNumbers = refs.caseNumbers
    .filter((value, _i, all) => !all.some((other) => other !== value && other.length > value.length && other.includes(value)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
  return refs;
}

/** Court name, if the document names one. */
export function extractCourt(text) {
  const source = String(text || '').slice(0, 30000);
  for (const pattern of COURT_PATTERNS) {
    const m = pattern.re.exec(source);
    if (!m) continue;
    if (pattern.dynamic && m[1]) {
      const place = titleCase(m[1].replace(/^(the|of)$/i, '').trim());
      if (/^(in|the|of|at|before)$/i.test(place)) continue;
      return `${place} ${pattern.suffix}`;
    }
    if (pattern.raw) {
      const core = titleCase(collapse(m[1] || ''));
      const place = m[2] ? titleCase(collapse(m[2])) : '';
      if (core.length >= 4 && !/^(?:the|of|at|in)$/i.test(core)) return clip(place ? `${core}, ${place}` : core, 70);
    }
    if (pattern.name) return pattern.name;
  }
  // Hindi / Urdu court names ("उच्च न्यायालय", "ضلع و سیشن عدالت").
  return extractLocalCourt(source);
}

/** Acts and sections cited. */
export function extractStatutes(text) {
  const source = String(text || '').slice(0, 200000);
  const out = [];
  const sectionRe = /\b(?:section|sec\.?|s\.)\s*(\d{1,4}[A-Z]?(?:\(\d{1,2}\))?(?:\([a-z]\))?)\s*(?:of\s+(?:the\s+)?)?((?:[A-Z][A-Za-z().,'-]*\s*){0,7}?(?:Act|Code|Sanhita|Adhiniyam|Rules|Regulations))\b/gi;
  let m;
  while ((m = sectionRe.exec(source))) {
    const actRaw = collapse(m[2]);
    out.push({ section: m[1], act: normalizeAct(actRaw), raw: collapse(m[0]) });
  }
  const bareActRe = /\b(Indian Penal Code|Bharatiya Nyaya Sanhita|Code of Criminal Procedure|Bharatiya Nagarik Suraksha Sanhita|Code of Civil Procedure|Negotiable Instruments Act|Transfer of Property Act|Registration Act|Indian Contract Act|Specific Relief Act|Hindu Marriage Act|Arbitration and Conciliation Act|Consumer Protection Act|Companies Act|Limitation Act|Information Technology Act|Motor Vehicles Act)\b/gi;
  while ((m = bareActRe.exec(source))) {
    const act = normalizeAct(m[1]);
    if (!out.some((s) => s.act === act && !s.section)) out.push({ section: null, act, raw: m[1] });
  }
  for (const local of extractLocalStatutes(source)) out.push(local);
  const seen = new Set();
  return out
    .filter((s) => {
      const key = `${s.section}|${s.act}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function normalizeAct(raw) {
  const key = normalize(raw).replace(/\s+/g, ' ').trim();
  for (const [alias, full] of Object.entries(ACT_NAMES)) {
    if (key === alias || key.includes(alias)) return full;
  }
  return titleCase(raw);
}

/** PAN, GSTIN, Aadhaar, phone, email, property identifiers. */
export function extractIdentifiers(text) {
  const source = String(text || '').slice(0, 200000);
  const ids = {};
  const pan = source.match(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  if (pan) ids.pan = pan[0];
  const gstin = source.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/);
  if (gstin) ids.gstin = gstin[0];
  const aadhaar = source.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
  if (aadhaar && /\baadhaar|aadhar|uidai\b/i.test(source)) ids.aadhaarMasked = `XXXX XXXX ${aadhaar[0].replace(/\s/g, '').slice(-4)}`;
  const emails = [...new Set(source.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) || [])].slice(0, 3);
  if (emails.length) ids.emails = emails;
  const phones = [...new Set(source.match(/\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g) || [])].slice(0, 4);
  if (phones.length) ids.phones = phones;
  const khasra = source.match(/\b(?:khasra|khata|gata|survey|plot)\s*(?:no\.?|number)?\s*[:\-]?\s*([0-9]{1,6}(?:\/\d{1,5})?)/gi);
  if (khasra) ids.propertyNumbers = [...new Set(khasra.map(collapse))].slice(0, 4);
  return ids;
}

/** Deadlines and hearing dates inside the document. */
export function extractDeadlines(text, { docDate = null, today = toIso(new Date()) } = {}) {
  const source = String(text || '');
  const out = [];
  const base = docDate || today;

  const withinRe = /\bwithin\s+(\d{1,3}|fifteen|thirty|sixty|ninety|seven|ten|fourteen|twenty[- ]one)\s+(days?|months?)\b([^.\n]{0,90})/gi;
  const numberWords = {
    seven: 7, ten: 10, fourteen: 14, fifteen: 15, thirty: 30, sixty: 60, ninety: 90, 'twenty-one': 21, 'twenty one': 21,
  };
  let m;
  while ((m = withinRe.exec(source))) {
    const n = numberWords[m[1].toLowerCase()] ?? Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const isMonths = /month/i.test(m[2]);
    const due = isMonths ? addMonths(base, n) : addDays(base, n);
    out.push({
      kind: 'compliance',
      title: `Comply within ${n} ${isMonths ? 'months' : 'days'}`,
      detail: collapse(m[3] || m[0]).slice(0, 180),
      due_date: due,
      basis: docDate ? 'counted from the document date' : 'counted from today (no document date found)',
      confidence: 0.6,
    });
  }

  const byDateRe = /\b(?:on\s+or\s+before|not\s+later\s+than|due\s+on|due\s+date|by)\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s*\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/gi;
  while ((m = byDateRe.exec(source))) {
    const parsed = parseDate(m[1]);
    if (!parsed) continue;
    out.push({
      kind: 'deadline',
      title: 'Due date mentioned in document',
      detail: collapse(m[0]),
      due_date: parsed.iso,
      basis: 'stated in the document',
      confidence: 0.75,
    });
  }

  const hearingRe = /\b(?:next\s+(?:date\s+of\s+)?hearing|hearing\s+(?:is\s+)?(?:fixed\s+)?on|listed\s+on)\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s*\d{4})/gi;
  while ((m = hearingRe.exec(source))) {
    const parsed = parseDate(m[1]);
    if (!parsed) continue;
    out.push({
      kind: 'hearing',
      title: 'Hearing date',
      detail: collapse(m[0]),
      due_date: parsed.iso,
      basis: 'stated in the document',
      confidence: 0.8,
    });
  }

  // Tenancy / agreement end date
  const tenure = extractTenure(source);
  if (tenure?.end) {
    out.push({
      kind: 'expiry',
      title: `${tenure.months}-month term ends`,
      detail: tenure.raw,
      due_date: tenure.end,
      basis: 'calculated from the commencement date',
      confidence: 0.7,
    });
  }

  const seen = new Set();
  return out
    .filter((d) => {
      const key = `${d.due_date}|${d.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(d.due_date);
    })
    .slice(0, 8);
}

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return toIso(d);
}

/** "for a period of 11 months commencing 1 June 2024" */
export function extractTenure(text) {
  const source = String(text || '');
  const m = /(?:for\s+(?:a\s+)?period\s+of\s+)?(\d{1,2})\s*(months?|years?)\s*(?:commencing|starting|beginning|w\.?e\.?f\.?|from|with\s+effect\s+from)\s*([0-9]{1,2}(?:st|nd|rd|th)?[\s\w,.-]{3,20}\d{4})/i.exec(source);
  if (!m) return null;
  const n = Number(m[1]);
  const months = /year/i.test(m[2]) ? n * 12 : n;
  const start = parseDate(collapse(m[3]));
  if (!start) return null;
  return {
    months,
    start: start.iso,
    end: addMonths(start.iso, months),
    raw: collapse(m[0]),
  };
}

/** Best guess at the date of the document itself. */
export function extractDocumentDate(text, { filename = '' } = {}) {
  const source = String(text || '');
  const head = source.slice(0, 5000);
  const candidates = [];

  const collect = (re, priority) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(head))) {
      const parsed = parseDate(collapse(m[1]));
      if (parsed?.iso) candidates.push({ iso: parsed.iso, index: m.index, priority, confident: parsed.confident });
    }
  };

  collect(/(?:^|\n)\s*(?:date|dated|दिनांक|तारीख|تاریخ)\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?[\s\w,.\-]{2,26}\d{4})/gi, 4);
  collect(/(?:दिनांकित|तारीख|تاریخ)\s*[:\-]?\s*([0-9]{1,2}[\s\w,.\-]{2,26}\d{4})/gi, 4);
  collect(/this\s+(\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+[A-Za-z]+[,\s]+\d{4})/gi, 4);
  collect(/(?:dated|executed\s+(?:at\s+\w+\s+)?on|made\s+(?:at\s+\w+\s+)?on|entered\s+into\s+on)\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?[\s\w,.\-]{2,26}\d{4})/gi, 2);

  const usable = candidates.filter((c) => {
    const y = Number(c.iso.slice(0, 4));
    return y >= 1950 && y <= new Date().getFullYear() + 2;
  });
  if (usable.length) {
    usable.sort((a, b) => (b.priority - a.priority) || (a.index - b.index));
    return { iso: usable[0].iso, source: 'text', confident: usable[0].confident };
  }

  const headerDates = findDates(head.slice(0, 1600)).filter((d) => {
    const y = Number(d.iso.slice(0, 4));
    return y >= 1950 && y <= new Date().getFullYear() + 2;
  });
  if (headerDates.length) return { iso: headerDates[0].iso, source: 'header', confident: false };

  const anywhere = findDates(source).filter((d) => {
    const y = Number(d.iso.slice(0, 4));
    return y >= 1950 && y <= new Date().getFullYear() + 2;
  });
  if (anywhere.length) return { iso: anywhere[0].iso, source: 'body', confident: false };

  const fromName = /(20\d{2}|19\d{2})[-_.](\d{2})[-_.](\d{2})/.exec(filename);
  if (fromName) return { iso: `${fromName[1]}-${fromName[2]}-${fromName[3]}`, source: 'filename', confident: false };
  return null;
}

export function detectLanguage(text) {
  return scriptLanguage(String(text || '').slice(0, 8000));
}

/** Blank fields that still need filling in — useful before sending a draft out. */
export function findBlanks(text) {
  const source = String(text || '');
  const blanks = new Set();
  const patterns = [
    /_{4,}/g,
    /\[(?:insert|fill|specify|mention)[^\]]{0,40}\]/gi,
    /\bTBD\b/g,
    /\bXX+\b/g,
  ];
  for (const re of patterns) {
    const matches = source.match(re);
    if (matches) for (const m of matches) blanks.add(m);
  }
  return [...blanks].slice(0, 8);
}

export { ACT_NAMES, ROLE_WORDS };
