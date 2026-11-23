/**
 * eCourts replies: the remembered case cards, the diary of next dates, and the
 * CNR lookup. Kept apart from handlers.js because the wording is reused by the
 * dashboard chat and the WhatsApp bot alike.
 */

import {
  listEcourtsCases, findEcourtsCase, upcomingHearings, ecourtsSummary,
} from '../store/ecourts.js';
import { formatDate, daysBetween, toIso } from '../util/dates.js';
import { plural, clip } from '../util/text.js';

export function ecourtsCard(record) {
  const lines = [];
  lines.push(`⚖️ *${clip(record.title || record.case_number || record.cnr || 'eCourts case', 90)}*`);
  const meta = [];
  if (record.cnr) meta.push(`CNR ${record.cnr}`);
  if (record.case_number) meta.push(`Case ${record.case_number}`);
  if (record.court) meta.push(record.court);
  if (meta.length) lines.push(meta.join(' · '));
  const status = [record.status, record.stage ? `stage: ${record.stage}` : null].filter(Boolean).join(' · ');
  if (status) lines.push(status);
  if (record.petitioner || record.respondent) {
    lines.push(`${record.petitioner || '—'}  v  ${record.respondent || '—'}`);
  }
  if (record.next_hearing) {
    const days = -daysBetween(toIso(new Date()), record.next_hearing); // positive = in the future
    const when = days === 0 ? 'today' : days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`;
    lines.push(`📅 Next hearing: *${formatDate(record.next_hearing, { long: true })}* (${when})`);
  }
  if (record.filing_date) lines.push(`Filed: ${formatDate(record.filing_date, { long: true })}`);
  if (record.acts) lines.push(`Acts: ${clip(record.acts, 120)}`);
  if (record.police_station || record.fir_number) {
    lines.push([record.police_station && `PS ${record.police_station}`, record.fir_number && `FIR ${record.fir_number}`]
      .filter(Boolean).join(' · '));
  }
  return lines.join('\n');
}

export function ecourtsList(records, { query = '' } = {}) {
  if (!records.length) {
    if (query) {
      return `No remembered eCourts case matches “${clip(query, 40)}”.\n\nSend the eCourts .txt file once and I keep every case in it for good.`;
    }
    return 'No eCourts data yet. Send me the .txt file from eCourts (Case Status → copy/save as text) once — '
      + 'I will remember every case in it permanently.';
  }
  const lines = [`⚖️ *Remembered eCourts cases* — ${plural(records.length, 'case')}${query ? ` matching “${clip(query, 30)}”` : ''}`, ''];
  for (const r of records) {
    const bits = [r.next_hearing ? `next ${formatDate(r.next_hearing)}` : null, r.status, r.court].filter(Boolean);
    lines.push(`• *${clip(r.title || r.case_number || r.cnr, 60)}*${r.cnr ? ` — ${r.cnr}` : ''}`);
    if (bits.length) lines.push(`   ${bits.join(' · ')}`);
  }
  return lines.join('\n');
}

export function hearingsList(records, { remembered = 0 } = {}) {
  if (!records.length) {
    if (remembered) {
      return `No *upcoming* hearings — every next-date in the ${remembered} remembered eCourts case(s) has already passed.\n\n`
        + 'Send a fresh eCourts .txt file and I will update the same cases in place.';
    }
    return 'No upcoming hearings in the remembered eCourts data.\n\n'
      + 'If you have a newer eCourts .txt file, send it and I will refresh the diary.';
  }
  const lines = [`📅 *Next hearings* — ${plural(records.length, 'case')}`, ''];
  const today = toIso(new Date());
  for (const r of records) {
    const days = -daysBetween(today, r.next_hearing); // positive = still to come
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`;
    lines.push(`• *${formatDate(r.next_hearing, { long: true })}* (${when}) — ${clip(r.title || r.case_number || r.cnr, 70)}`);
    if (r.court) lines.push(`   ${r.court}${r.case_number ? ` · Case ${r.case_number}` : ''}`);
  }
  return lines.join('\n');
}

/** Handle `ecourts`, `next hearing` and CNR/case lookups for one owner. */
export async function handleEcourts({ owner, intent, query = '', send }) {
  if (intent === 'hearings') {
    const upcoming = upcomingHearings(owner, { limit: 15 });
    await send({ text: hearingsList(upcoming, { remembered: ecourtsSummary(owner).total }) });
    return;
  }
  if (intent === 'ecourts_case' && query) {
    const record = findEcourtsCase(owner, query);
    if (record) {
      await send({ text: ecourtsCard(record) });
      return;
    }
    const rows = listEcourtsCases(owner, { query, limit: 6 });
    if (rows.length === 1) {
      await send({ text: ecourtsCard(rows[0]) });
      return;
    }
    await send({ text: rows.length ? ecourtsList(rows, { query }) : ecourtsList([], { query }) });
    return;
  }
  const summary = ecourtsSummary(owner);
  const rows = listEcourtsCases(owner, { query, limit: 25 });
  // "case status 123/2018" narrows to one remembered case — show it in full.
  if (query && rows.length === 1) {
    await send({ text: ecourtsCard(rows[0]) });
    return;
  }
  const text = ecourtsList(rows, { query });
  await send({
    text: summary.total
      ? `${text}\n\n_Say \`next hearing\` for the diary, or send a CNR number for the full case._`
      : text,
  });
}
