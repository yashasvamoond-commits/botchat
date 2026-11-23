import { formatDate, relativeDay, daysBetween } from '../util/dates.js';
import { clip, plural } from '../util/text.js';
import { formatIndianCurrency } from '../util/numberWords.js';

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function partyLine(parties) {
  if (!parties?.length) return null;
  return parties
    .slice(0, 3)
    .map((p) => {
      if (typeof p === 'string') return p;
      return p.role ? `${p.name} (${p.role})` : p.name;
    })
    .filter(Boolean)
    .join(' · ');
}

function tagLine(tags) {
  if (!tags?.length) return null;
  return tags.slice(0, 6).map((t) => `#${String(t).replace(/\s+/g, '-')}`).join(' ');
}

function moneyLine(amounts) {
  if (!amounts?.length) return null;
  return amounts
    .slice(0, 3)
    .map((a) => (a.value ? `${a.label}: ${formatIndianCurrency(a.value)}` : `${a.label}: ${a.raw}`))
    .join(' · ');
}

export function cleanSnippet(snippet, limit = 260) {
  if (!snippet) return '';
  return clip(
    String(snippet)
      .replace(/\[\[([^\]]*)\]\]/g, '*$1*')
      .replace(/\s+/g, ' ')
      .trim(),
    limit,
  );
}

/** Full detail card for one document. */
export function docCard(doc, { matter = null, related = [], heading = null } = {}) {
  const lines = [];
  if (heading) lines.push(heading, '');
  lines.push(`📄 *${doc.title || doc.original_name || doc.id}*`);
  const meta = [doc.id];
  if (doc.doc_date) meta.push(`dated ${formatDate(doc.doc_date)}`);
  meta.push(doc.pages ? plural(doc.pages, 'page') : 'text file');
  if (doc.type_label) meta.push(doc.type_label);
  lines.push(`🗂 ${meta.join(' · ')}`);

  if (matter) lines.push(`📁 Case: *${matter.title}* (${matter.id})`);
  else if (doc.matter_id) lines.push(`📁 Case: ${doc.matter_id}`);

  const parties = partyLine(doc.parties);
  if (parties) lines.push(`👥 ${parties}`);
  if (doc.court) lines.push(`🏛 ${doc.court}`);
  if (doc.case_number) lines.push(`🔢 Case no.: ${doc.case_number}`);
  const money = moneyLine(doc.amounts);
  if (money) lines.push(`💰 ${money}`);
  const tags = tagLine(doc.tags);
  if (tags) lines.push(`🏷 ${tags}`);

  if (doc.summary) lines.push('', `_${clip(doc.summary, 420)}_`);

  if (doc.key_points?.length) {
    lines.push('', '*Key points*');
    for (const point of doc.key_points.slice(0, 3)) lines.push(`• ${clip(point, 180)}`);
  }
  if (doc.clauses?.length) {
    const shown = (doc.key_points || []).slice(0, 3).map((p) => String(p).toLowerCase().replace(/\s+/g, ' ').slice(0, 45));
    const important = doc.clauses
      .filter((c) => ['notice', 'jurisdiction', 'arbitration', 'rent', 'term', 'confidentiality'].includes(c.key))
      .filter((c) => {
        const body = String(c.text || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 45);
        return body.length > 20 && !shown.some((p) => p.startsWith(body.slice(0, 30)));
      })
      .slice(0, 2);
    for (const clause of important) {
      lines.push(`• ${clause.label}: ${clip(clause.text, 160)}`);
    }
  }
  if (doc.needs_review) {
    lines.push('', '⚠️ _Needs a quick check — smart filing was not fully confident about this one._');
  }
  if (related.length) {
    lines.push('', `🔗 Also in this file: ${related.slice(0, 3).map((d) => `${d.id} ${clip(d.title, 40)}`).join('; ')}`);
  }

  const flags = (doc.entities?.flags || []).filter((f) => f.level === 'warn').slice(0, 2);
  for (const flag of flags) lines.push(`⚠️ ${clip(flag.message, 200)}`);

  lines.push('', '_Reply with any word from this document to find it again._');
  return lines.join('\n').slice(0, 3800);
}

/** Short line used in lists. */
export function docListLine(doc, index) {
  const bits = [];
  if (doc.doc_date) bits.push(formatDate(doc.doc_date));
  else bits.push(String(doc.created_at).slice(0, 10));
  if (doc.type_label) bits.push(doc.type_label);
  return `${index}. *${doc.id}* · ${clip(doc.title || 'Untitled', 62)}\n    ${bits.join(' · ')}${doc.matter_id ? ` · ${doc.matter_id}` : ''}`;
}

export function filedCard(doc, { matter = null, matterAuto = false, suggestions = [], warnings = [] } = {}) {
  const lines = [];
  lines.push(`✅ *Saved as ${doc.id}*`);
  lines.push('');
  lines.push(`📄 *${doc.title}*`);
  const meta = [doc.doc_date ? formatDate(doc.doc_date) : 'no date found', doc.type_label, doc.pages ? plural(doc.pages, 'page') : null]
    .filter(Boolean);
  lines.push(meta.join(' · '));
  if (doc.parties?.length) lines.push(`👥 ${partyLine(doc.parties)}`);
  if (doc.court) lines.push(`🏛 ${doc.court}`);
  const money = moneyLine(doc.amounts);
  if (money) lines.push(`💰 ${money}`);
  if (doc.summary) lines.push('', `_${clip(doc.summary, 300)}_`);

  if (matter) {
    lines.push('', `📁 Filed in case *${matter.title}*${matterAuto ? ' _— matched automatically by the names on it_' : ''}`);
  }
  for (const warning of warnings.slice(0, 2)) lines.push(`⚠️ ${clip(warning, 200)}`);

  if (!matter) {
    if (suggestions.length) {
      lines.push('', '*Which case is this for?*');
      suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s.matter.title} (${s.matter.id})`));
      lines.push('_Reply with a number, or type_ `new case <name>` _to start one, or_ `skip` _to leave it unfiled._');
    } else {
      lines.push('', '_No case yet._ Reply `new case <client name>` _to open one, or_ `skip` _to leave it unfiled._');
    }
  } else {
    lines.push('', `Say *${doc.id}* anytime to see it again · *cases* for all your cases`);
  }
  return lines.join('\n').slice(0, 3800);
}

export function resultsMessage({ docs, total, plan, suggestion, page = 0, pageSize = 8, relaxations = [] }) {
  const start = page * pageSize;
  const slice = docs.slice(start, start + pageSize);
  const lines = []
  if (!docs.length) {
    lines.push('🔎 Nothing found.');
    return lines.join('\n');
  }
  const what = plan.cleaned ? `“${clip(plan.cleaned, 50)}”` : (plan.matterName || plan.dateRange?.label || 'your library');
  lines.push(`🔎 *${total} match${total === 1 ? '' : 'es'}* for ${what}`);
  if (suggestion) lines.push(`_Showing results for ${suggestion}._`);
  if (relaxations.includes('type') || relaxations.includes('date') || relaxations.includes('matter')) {
    lines.push('_I widened the search a little to find these._');
  }
  lines.push('');
  slice.forEach((doc, i) => lines.push(docListLine(doc, start + i + 1)));
  lines.push('');
  if (total > start + pageSize) lines.push(`Reply a number to open · *more* for the rest`);
  else lines.push('Reply a number to open the file.');
  return lines.join('\n').slice(0, 3800);
}

export function matterListMessage(matters, { totalDocs = null } = {}) {
  if (totalDocs === null) totalDocs = matters.reduce((sum, m) => sum + (m.doc_count || 0), 0);
  if (!matters.length) {
    return '📁 No cases yet.\n\nSend me a document and I will offer to create one, or type `new case Sharma v Mehta`.';
  }
  const lines = [`📁 *Your cases* (${matters.length})`, ''];
  matters.slice(0, 15).forEach((m, i) => {
    const bits = [m.id];
    if (m.case_number) bits.push(m.case_number);
    if (m.court) bits.push(clip(m.court, 40));
    lines.push(`${i + 1}. *${m.title}*`);
    lines.push(`    ${bits.join(' · ')} · ${plural(m.doc_count || 0, 'document')}`);
  });
  lines.push('');
  lines.push(`_${totalDocs} documents in total. Reply_ \`case 2\` _to open one, or_ \`index 2\` _for its file index._`);
  return lines.join('\n').slice(0, 3800);
}

export function deadlineLine(deadline, index) {
  const diff = daysBetween(deadline.due_date);
  let when = 'today';
  if (diff === 1) when = 'tomorrow';
  else if (diff > 1) when = `in ${diff} days`;
  else if (diff === 0) when = 'today';
  else if (diff === -1) when = '1 day overdue';
  else if (diff < -1) when = `${Math.abs(diff)} days overdue`;
  const icon = diff < 0 ? '🔴' : diff <= 2 ? '🟠' : '🟡';
  const bits = [deadline.due_date ? formatDate(deadline.due_date) : '', when, deadline.document_id || ''].filter(Boolean);
  return `${index}. ${icon} *${clip(deadline.title, 70)}*\n    ${bits.join(' · ')}`;
}

export function caseOverview(matter, docs) {
  const lines = [];
  lines.push(`📁 *${matter.title}* (${matter.id})`);
  const meta = [matter.client && `Client: ${matter.client}`, matter.opposite && `Other side: ${matter.opposite}`,
    matter.case_number && `Case no.: ${matter.case_number}`, matter.court].filter(Boolean);
  if (meta.length) lines.push(meta.join('\n'));
  lines.push('');
  if (!docs.length) {
    lines.push('No documents in this case yet. Send one and reply with this case number when I ask.');
    return lines.join('\n').slice(0, 3800);
  }
  const ordered = [...docs].sort((a, b) => String(a.doc_date || a.created_at).localeCompare(String(b.doc_date || b.created_at)));
  lines.push(`*File index* — ${plural(ordered.length, 'document')} in date order`);
  ordered.forEach((doc, i) => {
    const date = doc.doc_date ? formatDate(doc.doc_date) : String(doc.created_at).slice(0, 10);
    lines.push(`${i + 1}. *${doc.id}* · ${date} · ${clip(doc.title, 55)}`);
  });
  lines.push('');
  lines.push('Reply a number for details · `bundle` to compile the case file · `index` for the printable index.');
  return lines.join('\n').slice(0, 3800);
}

export function helpMessage({ ownerName = '' } = {}) {
  return `*X Document Manager* 📚
${ownerName ? `Hello ${ownerName}. ` : ''}I keep every document you send me, know what is inside it, and hand it back the moment you ask.

*1. Send me anything*
PDF, Word, photos of papers, scanned orders. I read it, name it properly, put it in the right folder and file it under a case.

*2. Search: just ask for it*
“rent agreement Sharma”
“notices from last month”
“cheque bounce D12”
“sale deed 2023”
“what is the notice period in the rent agreement”
“show me everything in the Mehta case”

*3. Open it*
Reply with the number I show, or the id like *D12*. I send the actual file back.

*4. Keep cases in order*
\`cases\` — all your cases
\`case 2\` — one case and its file index
\`bundle\` — zip the current case with a printed index
\`new case Sharma v Mehta\` — start a case
\`move D12 to 3\` — shift a document into a case

*5. Dates that matter*
\`deadlines\` — what is coming up
\`remind me 3 days before 12/12/2026 hearing Mehta\`

*6. Drafting*
\`draft legal notice for Rs 2,00,000 from Mehta\`
\`draft rent agreement for flat in Vaishali Nagar rent 25000 deposit 100000\`
\`draft NDA between Acme Pvt Ltd and Rakesh\`
Drafts come as Word + PDF, saved in your library.

*7. Fix anything*
\`rename D12 Sharma rent agreement 2024\`
\`tag D12 urgent\`
\`type D12 plaint\`
\`delete D12\` · \`undo\`

Everything stays on your own server. Nobody else can open it.`;
}

export function shortSummary(doc) {
  const bits = [doc.id, doc.type_label, doc.doc_date ? formatDate(doc.doc_date) : null].filter(Boolean);
  return `${bits.join(' · ')} — ${clip(doc.title, 60)}`;
}
