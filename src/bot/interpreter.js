import { normalize, collapse } from '../util/text.js';
import { parseDate, relativeRange, toIso, addDays } from '../util/dates.js';
import { matchTemplate } from '../draft/templates.js';

const ORDINALS = {
  first: 0, '1st': 0, pehla: 0, pehli: 0, one: 0,
  second: 1, '2nd': 1, dusra: 1, doosra: 1, two: 1,
  third: 2, '3rd': 2, teesra: 2, three: 2,
  fourth: 3, '4th': 3, four: 3,
  fifth: 4, '5th': 4, five: 4,
  sixth: 5, '6th': 5, seventh: 6, '7th': 6, eighth: 7, '8th': 7,
};

const DOC_TYPE_WORDS = /\b(plaint|written statement|petition|affidavit|vakalatnama|legal notice|cheque bounce|rent agreement|lease|sale deed|gift deed|power of attorney|will|fir|court order|judgment|invoice|receipt|noc|nda|bank statement|agreement|draft|other)\b/i;

/**
 * Work out what the user wants.
 * @param {string} raw message text
 * @param {{pending?: object, hasResults?: boolean}} context
 */
export function interpret(raw, { pending = null, hasResults = false } = {}) {
  const text = String(raw || '').trim();
  const lower = normalize(text);
  if (!text) return { intent: 'empty' };

  // ── yes / no ──────────────────────────────────────────────────────────────
  if (/^(?:y|yes|yeah|yep|haan|han|ha|ok|okay|sure|confirm|confirmed|theek|thik|bilkul|👍)$/.test(lower)) {
    return { intent: 'confirm' };
  }
  if (/^(?:n|no|nahi|nah|nope|cancel|stop|mat\s+karo|rehne\s+do|✖️?)$/.test(lower)) {
    return { intent: 'cancel' };
  }

  // ── numeric / ordinal selection ───────────────────────────────────────────
  const numeric = /^(?:no\.?\s*|number\s*|#)?(\d{1,2})$/.exec(text);
  if (numeric && (hasResults || pending)) return { intent: 'select', index: Number(numeric[1]) - 1 };
  const ordinal = /^(?:the\s+)?([a-z0-9]+)(?:\s+one|\s+wala|\s+wali)?$/i.exec(lower);
  if (ordinal && ORDINALS[ordinal[1]] !== undefined && (hasResults || pending)) {
    return { intent: 'select', index: ORDINALS[ordinal[1]] };
  }

  // ── direct document id ────────────────────────────────────────────────────
  const idOnly = /^(?:open|show|get|send|file|dekh(?:a|ao)?|bhej(?:o|do))?[ \t]*#?([dmb]\d{1,6})$/i.exec(text);
  if (idOnly) {
    const id = idOnly[1].toUpperCase();
    if (id.startsWith('D')) return { intent: 'open_doc', id };
    if (id.startsWith('M')) return { intent: 'open_case', query: id };
    if (id.startsWith('B')) return { intent: 'open_bundle', id };
  }

  // ── greetings & help ──────────────────────────────────────────────────────
  if (/^(?:hi|hello|hey|namaste|namaskar|hola|good\s+(?:morning|evening|afternoon))\b/i.test(text) && text.length < 40) {
    return { intent: 'greeting' };
  }
  if (/^(?:help|commands?|menu|madad|sahayata|kya\s+kar\s+sakte|what\s+can\s+you\s+do|guide|start)\b/i.test(text)) {
    return { intent: 'help' };
  }
  if (/^(?:thanks?|thank\s+you|shukriya|dhanyavad|great|awesome|nice|perfect|badhiya)\b/i.test(text)) {
    return { intent: 'thanks' };
  }
  if (/^(?:undo|revert|wapas|wapis|peeche)\b/i.test(text)) return { intent: 'undo' };

  // ── eCourts memory ────────────────────────────────────────────────────────
  const cnrOnly = /\b([A-Z]{2}[A-Z0-9]{2}\d{12,16})\b/i.exec(text);
  if (cnrOnly) return { intent: 'ecourts_case', query: cnrOnly[1].toUpperCase() };
  if (/^(?:e-?courts?|court\s*status|case\s*status|my\s+court\s+cases|ई-?कोर्ट|कोर्ट\s*स्टेटस|मेरे\s*कोर्ट\s*केस|ای-?کورٹ|کیس\s*اسٹیٹس|میرے\s*عدالتی\s*کیسز)\s*$/i.test(text)) {
    return { intent: 'ecourts' };
  }
  const ecourtsQuery = /^(?:e-?courts?|court\s*status|case\s*status|ई-?कोर्ट|کوٹ\s*سٹیٹس|ای-?کورٹ)\s+(.+)$/i.exec(text);
  if (ecourtsQuery) return { intent: 'ecourts', query: collapse(ecourtsQuery[1]) };
  if (/^(?:next\s+hearings?|upcoming\s+hearings?|hearing\s+(?:dates?|diary)|court\s+diary|अगली\s+सुनवाई|सुनवाई\s+की\s+तारीख(?:ें)?|اگلی\s+سماعت|سماعت\s+کی\s+تاریخیں?)\s*$/i.test(text)) {
    return { intent: 'hearings' };
  }
  const caseStatus = /^(?:case|cases?)\s+(?:no\.?|number|status)?\s*[:\-]?\s*(.+)$/i.exec(text);
  if (caseStatus && /\d/.test(caseStatus[1]) && /\//.test(caseStatus[1])) {
    return { intent: 'ecourts_case', query: collapse(caseStatus[1]) };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  if (/^(?:stats?|status|library|how\s+many\s+(?:documents?|files?)|kitne\s+(?:documents?|files?)|total)\b/i.test(text)
    || /what\s+(?:documents?|files?)\s+do\s+i\s+have/i.test(text)) {
    return { intent: 'stats' };
  }
  if (/^(?:export|backup|download\s+(?:index|everything)|csv)\b/i.test(text)) return { intent: 'export' };

  // ── cases ─────────────────────────────────────────────────────────────────
  if (/^(?:cases|matters?|my\s+cases|case\s+list|all\s+cases|saare\s+cases?|sab\s+cases?)\s*$/i.test(text)) {
    return { intent: 'list_cases' };
  }
  const newCase = /^(?:new|create|start|add|naya)\s+(?:case|matter)\s*[:\-]?\s*(.*)$/i.exec(text);
  if (newCase) return { intent: 'new_case', title: collapse(newCase[1]) };
  const caseNo = /^(?:case|matter)\s+(\d{1,3})$/i.exec(text);
  if (caseNo) return { intent: 'open_case', index: Number(caseNo[1]) - 1 };
  const caseDetail = /^(?:open\s+|show\s+|dekh(?:a|ao)?\s+)?(?:case|matter)\s+(?:of\s+|named\s+)?(.+)$/i.exec(text);
  if (caseDetail) return { intent: 'open_case', query: collapse(caseDetail[1]) };

  // ── bundles and indexes ───────────────────────────────────────────────────
  const bundleCmd = /\b(?:bundle|compile|case\s+file|zip|set\s+of\s+documents|file\s+ban(a|ao))\b\s*(?:for|of)?\s*(?:case\s+|matter\s+)?(.*)$/i.exec(text);
  if (bundleCmd) {
    return { intent: 'bundle', target: collapse(bundleCmd[1] || '') || null };
  }
  const indexCmd = /^(?:index|file\s+index|printable\s+index|list)\s*(\d{1,3})?$/i.exec(text);
  if (indexCmd) return { intent: 'index', index: indexCmd[1] ? Number(indexCmd[1]) - 1 : null };

  // ── deadlines ─────────────────────────────────────────────────────────────
  if (/^(?:deadlines?|reminders?|upcoming|calendar|due\s+dates?|sunwai|tarikhein)\s*$/i.test(text)) {
    return { intent: 'deadlines' };
  }
  if (/^(?:remind|reminder|yaad\s+dila)/i.test(text)) {
    return { intent: 'remind', ...parseReminder(text) };
  }
  if (/^(?:recent|latest|new(est)?\s+(?:documents?|files?)|show\s+recent|last\s+few|aaj\s+ke)\b/i.test(text)) {
    return { intent: 'recent' };
  }

  // ── document maintenance ──────────────────────────────────────────────────
  const deleteCmd = /^(?:delete|remove|hatao|hata\s*do|discard|bin)\s*#?([dmb]\d{1,6})?/i.exec(text);
  if (deleteCmd) return { intent: 'delete', id: deleteCmd[1]?.toUpperCase() || null };

  const renameCmd = /^(?:rename|retitle|title|name)\s+#?([dmb]\d{1,6})\s+(?:to\s+|as\s+)?(.+)$/i.exec(text);
  if (renameCmd) return { intent: 'rename', id: renameCmd[1].toUpperCase(), title: collapse(renameCmd[2]) };

  const tagCmd = /^(?:tag|label)\s+#?([dmb]\d{1,6})\s+(?:as\s+|with\s+)?(.+)$/i.exec(text);
  if (tagCmd) return { intent: 'tag', id: tagCmd[1].toUpperCase(), tags: tagCmd[2].split(/[,\s]+/).filter(Boolean) };

  const moveCmd = /^(?:move|file|put|shift)\s+#?([dmb]\d{1,6})\s+(?:to|in|into|under)\s+(?:case\s+|matter\s+)?(.+)$/i.exec(text);
  if (moveCmd) return { intent: 'move', id: moveCmd[1].toUpperCase(), target: collapse(moveCmd[2]) };

  const typeCmd = /^(?:type|set\s+type|it\s+is\s+a|this\s+is\s+a|category)\s+#?([dmb]\d{1,6})?\s*(?:as\s+|is\s+)?(.+)$/i.exec(text);
  if (typeCmd && DOC_TYPE_WORDS.test(typeCmd[2])) {
    return { intent: 'set_type', id: typeCmd[1]?.toUpperCase() || null, type: collapse(typeCmd[2]) };
  }

  const dateCmd = /^(?:date|dated)\s+#?([dmb]\d{1,6})\s+(.+)$/i.exec(text);
  if (dateCmd && parseDate(dateCmd[2])) {
    return { intent: 'set_date', id: dateCmd[1].toUpperCase(), date: parseDate(dateCmd[2]).iso };
  }

  const noteCmd = /^(?:note|add\s+note|text)\s+#?([dmb]\d{1,6})\s+([\s\S]+)$/i.exec(text);
  if (noteCmd) return { intent: 'add_note', id: noteCmd[1].toUpperCase(), note: collapse(noteCmd[2]) };

  if (/^(?:more|next|aur\s+dikhao|show\s+more|aage)\b/i.test(text)) return { intent: 'more' };
  if (/^(?:skip|leave\s+it|unfiled|baad\s+mein|chhodo)\b/i.test(text)) return { intent: 'skip' };
  const doneCmd = /^(?:done|complete|completed|finished|ho\s+gaya)\s*(\d{1,2})$/i.exec(text);
  if (doneCmd) return { intent: 'mark_done', index: Number(doneCmd[1]) - 1 };
  if (/^(?:send|bhejo|share)\s+(?:me\s+)?(?:the\s+)?(?:pdf|docx|word|original|file)\s*(?:of\s+)?#?([dmb]\d{1,6})?$/i.test(text)) {
    const m = /#?([dmb]\d{1,6})/i.exec(text);
    return { intent: 'send_file', id: m ? m[1].toUpperCase() : null, format: /pdf/i.test(text) ? 'pdf' : /docx|word/i.test(text) ? 'docx' : null };
  }

  // ── drafting ──────────────────────────────────────────────────────────────
  if (/^(?:draft|prepare|make|create|write|banao|bana\s+do)\b/i.test(text)) {
    const template = matchTemplate(text);
    if (template) return { intent: 'draft', templateId: template.id, instruction: text };
    if (/\b(?:draft|template|agreement|notice|affidavit|petition|deed|letter)/i.test(text)) {
      return { intent: 'draft_pick', instruction: text };
    }
  }

  // ── content questions ─────────────────────────────────────────────────────
  const looksLikeQuestion = /\?\s*$/.test(text)
    || /^(?:what|when|where|who|whom|whose|which|how|why|does|do|did|is|are|was|were|can|kya|kab|kaun|kahan|kitna|kitne)\b/i.test(text);
  if (looksLikeQuestion) {
    return { intent: 'question', question: text };
  }
  if (/\b(?:summar(?:y|ise|ize)|what\s+is\s+in|explain|tell\s+me\s+about)\b/i.test(text)) {
    return { intent: 'question', question: text };
  }

  return { intent: 'search', query: text };
}

function parseReminder(text) {
  const dateMatch = /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s*\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/.exec(text);
  let due = dateMatch ? parseDate(dateMatch[1])?.iso : null;
  const relative = relativeRange(text.replace(/^.*?(?:before|on|at)\s+/i, '').trim());
  if (!due && relative) due = relative.from;
  if (!due && /\btomorrow\b/i.test(text)) due = addDays(toIso(new Date()), 1);
  if (!due && /\btoday\b/i.test(text)) due = toIso(new Date());
  const daysBefore = /(\d{1,2})\s*(?:days?|din)\s*(?:before|pehle)/i.exec(text);
  const title = text
    .replace(/^(?:remind|reminder|yaad\s+dila(?:\s+do)?)\s*(?:me|mujhe)?\s*/i, '')
    .replace(/(\d{1,2})\s*(?:days?|din)\s*(?:before|pehle)/i, '')
    .replace(/(?:before|on|at|ko)\s+/i, ' ')
    .replace(dateMatch ? dateMatch[0] : '', '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    due,
    remindDays: daysBefore ? Number(daysBefore[1]) : 1,
    title: collapse(title) || 'Reminder',
  };
}
