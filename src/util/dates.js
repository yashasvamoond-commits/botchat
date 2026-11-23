/** Date parsing and formatting. Deliberately India-first (dd/mm/yyyy, IST). */

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTH_ALIASES = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export function toIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIso(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function today() {
  return toIso(new Date());
}

export function formatDate(iso, { long = false } = {}) {
  const d = fromIso(iso);
  if (!d) return '';
  if (long) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysBetween(aIso, bIso = today()) {
  const a = fromIso(aIso);
  const b = fromIso(bIso);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}

export function addDays(iso, days) {
  const d = fromIso(iso) || new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return toIso(d);
}

export function relativeDay(iso) {
  const diff = daysBetween(iso, today());
  if (diff === null) return '';
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff === -1) return 'tomorrow';
  if (diff > 1 && diff <= 14) return `${diff} days ago`;
  if (diff < -1 && diff >= -14) return `in ${Math.abs(diff)} days`;
  return '';
}

/** Parse one of many date writings. Returns { iso, confident }. */
export function parseDate(input, { now = new Date() } = {}) {
  const s = String(input || '').trim();
  if (!s) return null;

  // 2024-05-12
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return build(+m[1], +m[2] - 1, +m[3]);

  // 12/05/2024, 12-05-2024, 12.05.2024  (day first, Indian style)
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (m) {
    let [, a, b, y] = m;
    let day = +a;
    let month = +b;
    let year = +y;
    if (year < 100) year += year > 40 ? 1900 : 2000;
    // If the first number cannot be a day but the second can, it is US style.
    if (day > 31 || (month > 12 && day <= 12)) [day, month] = [month, day];
    return build(year, month - 1, day);
  }

  // 12th May 2024 / 12 May, 2024 / May 12, 2024 / 12th day of May 2024
  const monthName = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const re1 = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:day\\s+of\\s+)?[\\s.-]*${monthName}[\\s,.-]*(\\d{4})?$`, 'i');
  m = re1.exec(s);
  if (m) {
    const month = MONTH_ALIASES[m[2].toLowerCase()];
    const year = m[3] ? +m[3] : now.getFullYear();
    return build(year, month, +m[1]);
  }
  const re2 = new RegExp(`^${monthName}\\s*(\\d{1,2})(?:st|nd|rd|th)?[\\s,.-]*(\\d{4})?$`, 'i');
  m = re2.exec(s);
  if (m) {
    const month = MONTH_ALIASES[m[1].toLowerCase()];
    const year = m[3] ? +m[3] : now.getFullYear();
    return build(year, month, +m[2]);
  }

  // "May 2024" or "2024" → first day
  m = new RegExp(`^${monthName}[\\s,-]*(\\d{4})$`, 'i').exec(s);
  if (m) return { iso: toIso(new Date(+m[2], MONTH_ALIASES[m[1].toLowerCase()], 1)), confident: false };
  m = /^(\d{4})$/.exec(s);
  if (m) return { iso: `${m[1]}-01-01`, confident: false };

  return null;
}

function build(year, month, day) {
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getMonth() !== ((month % 12) + 12) % 12) return null;
  return { iso: toIso(d), confident: true };
}

/** Find all dates in a block of text, with surrounding context. */
export function findDates(text, { now = new Date() } = {}) {
  const found = [];
  const source = String(text || '');
  const patterns = [
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,.-]+(\d{4})\b/gi,
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(\d{4})\b/gi,
    /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g,
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) {
      let parsed;
      if (/^\d{4}-/.test(m[0]) && m.length === 4) parsed = parseDate(m[0]);
      else if (m.length === 4 && /^\d{1,2}$/.test(m[1]) && MONTH_ALIASES[(m[2] || '').toLowerCase()] !== undefined) {
        parsed = build(+m[3], MONTH_ALIASES[m[2].toLowerCase()], +m[1]);
      } else if (m.length === 4 && MONTH_ALIASES[(m[1] || '').toLowerCase()] !== undefined) {
        parsed = build(+m[3], MONTH_ALIASES[m[1].toLowerCase()], +m[2]);
      } else if (m.length === 4) {
        let day = +m[1]; let month = +m[2]; let year = +m[3];
        if (year < 100) year += year > 40 ? 1900 : 2000;
        if (day > 31 || (month > 12 && day <= 12)) [day, month] = [month, day];
        parsed = build(year, month - 1, day);
      }
      if (!parsed || !parsed.iso) continue;
      const yearNum = Number(parsed.iso.slice(0, 4));
      if (yearNum < 1900 || yearNum > 2100) continue;
      const key = `${parsed.iso}@${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        iso: parsed.iso,
        raw: m[0],
        index: m.index,
        context: source.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Human-friendly date range for a phrase like "last month". */
export function relativeRange(phrase, { now = new Date() } = {}) {
  const p = String(phrase || '').toLowerCase().trim();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const iso = (d) => toIso(d);
  const mk = (y2, m2, d2) => new Date(y2, m2, d2);
  if (/^(today|aaj)$/.test(p)) return { from: iso(now), to: iso(now), label: 'today' };
  if (/^yesterday$/.test(p)) return { from: iso(mk(y, mo, now.getDate() - 1)), to: iso(mk(y, mo, now.getDate() - 1)), label: 'yesterday' };
  if (/^(this week|is hafte)$/.test(p)) {
    const day = now.getDay();
    const start = mk(y, mo, now.getDate() - day);
    return { from: iso(start), to: iso(now), label: 'this week' };
  }
  if (/^(last week|previous week)$/.test(p)) {
    const day = now.getDay();
    const end = mk(y, mo, now.getDate() - day - 1);
    const start = mk(y, mo, end.getDate() - 6);
    return { from: iso(start), to: iso(end), label: 'last week' };
  }
  if (/^(this month|is mahine)$/.test(p)) return { from: iso(mk(y, mo, 1)), to: iso(now), label: 'this month' };
  if (/^(last month|previous month|pichle mahine)$/.test(p)) {
    const start = mk(y, mo - 1, 1);
    const end = mk(y, mo, 0);
    return { from: iso(start), to: iso(end), label: 'last month' };
  }
  if (/^(this year|is saal)$/.test(p)) return { from: `${y}-01-01`, to: iso(now), label: 'this year' };
  if (/^(last year|previous year|pichle saal)$/.test(p)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'last year' };
  const mm = /^(?:in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?$/.exec(p);
  if (mm) {
    const m2 = MONTH_ALIASES[mm[1].toLowerCase()];
    const y2 = mm[2] ? +mm[2] : y;
    const start = mk(y2, m2, 1);
    const end = mk(y2, m2 + 1, 0);
    return { from: iso(start), to: iso(end), label: `${MONTHS[m2]} ${y2}` };
  }
  const y4 = /^(?:in\s+)?(\d{4})$/.exec(p);
  if (y4) return { from: `${y4[1]}-01-01`, to: `${y4[1]}-12-31`, label: y4[1] };
  if (/^(last|previous)\s+(\d+)\s+(day|days|week|weeks|month|months)$/.test(p)) {
    const [, , n, unit] = /^(last|previous)\s+(\d+)\s+(day|days|week|weeks|month|months)$/.exec(p);
    const count = Number(n);
    const d = new Date(now);
    if (unit.startsWith('day')) d.setDate(d.getDate() - count);
    if (unit.startsWith('week')) d.setDate(d.getDate() - count * 7);
    if (unit.startsWith('month')) d.setMonth(d.getMonth() - count);
    return { from: iso(d), to: iso(now), label: `last ${count} ${unit}` };
  }
  return null;
}
