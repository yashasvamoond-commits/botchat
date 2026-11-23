import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, RENT, NOTICE, ORDER, INVOICE, AFFIDAVIT } from './helpers.js';

const bot = await boot();

test('rent agreement: type, parties, amounts, clauses', () => {
  const a = bot.analyzeDocument({ text: RENT, filename: 'rent agreement sharma mehta.txt' });
  assert.equal(a.docType, 'rent_agreement');
  assert.match(a.title, /Sharma/);
  assert.match(a.title, /Mehta/);

  const names = a.parties.map((p) => p.name).join(' | ');
  assert.match(names, /Rajesh Sharma/);
  assert.match(names, /Anita Mehta/);
  assert.ok(!/Husband|Wife/i.test(a.parties.map((p) => p.role || '').join(' ')), 'no family roles as party roles');

  const rent = a.amounts.find((x) => /rent/i.test(x.label) && x.value === 25000);
  assert.ok(rent, `rent 25,000 labelled as rent, got ${JSON.stringify(a.amounts)}`);
  const deposit = a.amounts.find((x) => /deposit/i.test(x.label));
  assert.equal(deposit?.value, 100000);

  const noticeClause = a.clauses.find((c) => /notice/i.test(c.heading));
  assert.ok(noticeClause, 'notice clause found');
  assert.match(noticeClause.text, /^Either party may terminate/);
  assert.ok(!/^NOTICE\b/.test(noticeClause.text), 'heading is not repeated in the body');

  assert.ok(!/Term:\s*TERM/i.test(a.summary || ''), 'summary does not echo the heading twice');
  assert.ok(a.keyPoints.length >= 1);
});

test('legal notice: addressee, one figure per amount, correct framing', () => {
  const a = bot.analyzeDocument({ text: NOTICE, filename: 'legal notice praksh.txt' });
  assert.equal(a.docType, 'legal_notice');
  assert.match(a.title, /^Legal Notice/i);
  assert.match(a.title, /Prakash/);

  const amounts = a.amounts.filter((x) => x.value === 450000);
  assert.equal(amounts.length, 1, 'the same figure is listed once');
  assert.ok(a.parties.some((p) => /Prakash/.test(p.name)));

  const summary = a.summary || '';
  assert.match(summary, /addressed to/i);
  assert.ok(!/Legal Notice[^.]*Legal Notice/i.test(summary));
  assert.match(a.docDate || '', /^2026-10-16$/);
});

test('court order: full case number, court, parties', () => {
  const a = bot.analyzeDocument({ text: ORDER, filename: 'court order bail.txt' });
  assert.equal(a.docType, 'court_order');
  assert.match(a.caseNumber || '', /Criminal Misc\. Bail Application No\. 1123 of 2026/);
  assert.match(a.court || '', /Sessions Judge/i);
  assert.match(a.title, /Rajasthan/);
  assert.match(a.title, /Kumar/);
});

test('invoice: number in title, bank is not a party', () => {
  const a = bot.analyzeDocument({ text: INVOICE, filename: 'invoice 114.txt' });
  assert.equal(a.docType, 'invoice');
  assert.match(a.title, /Invoice/i);
  assert.match(a.title, /114/);
  const names = a.parties.map((p) => p.name).join(' | ');
  assert.ok(!/State Bank/i.test(names), `bank must not be a party, got ${names}`);
  assert.ok(a.amounts.length >= 1);
});

test('affidavit: deponent, no heading fragment as a party', () => {
  const a = bot.analyzeDocument({ text: AFFIDAVIT, filename: 'affidavit anita.txt' });
  assert.equal(a.docType, 'affidavit');
  assert.match(a.title, /Affidavit/i);
  const names = a.parties.map((p) => p.name).join(' | ');
  assert.ok(!/Verification|ERIFICATION/i.test(names), `got ${names}`);
  assert.ok(!/^Verification/i.test(a.title));
});

test('key points are whole phrases, not half sentences', () => {
  const a = bot.analyzeDocument({ text: RENT, filename: 'rent.txt' });
  for (const point of a.keyPoints) {
    assert.ok(point.length > 25, `point too short: ${point}`);
    assert.ok(!/\bThe Les$|\bRs\.$|,$/.test(point), `point clipped: ${point}`);
  }
});

test('hindi text is detected and does not crash analysis', () => {
  const a = bot.analyzeDocument({
    text: 'विक्रय पत्र\nयह विक्रय पत्र श्री रमेश चंद्र एवं श्रीमती सुनीता देवी के बीच 12 जनवरी 2026 को जयपुर में किया गया।\n',
    filename: 'vikray patra.txt',
  });
  assert.equal(a.language, 'hi');
  assert.ok(a.title.length > 0);
});
