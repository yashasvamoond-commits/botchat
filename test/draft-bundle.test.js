import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './helpers.js';

const bot = await boot();

test('plain instructions pick the right document template', async () => {
  const { matchTemplate } = await import('../src/draft/templates.js');
  const cases = [
    ['draft a legal notice for recovery of Rs 2,50,000', 'legal_notice_money'],
    ['cheque bounce notice for 4,50,000', 'cheque_bounce_notice'],
    ['make a rent agreement for my flat', 'rent_agreement'],
    ['draft NDA for a software consultant', 'nda'],
    ['prepare an affidavit for name change', 'affidavit'],
    ['vakalatnama for the client', 'vakalatnama'],
    ['special power of attorney for property', 'power_of_attorney'],
    ['sale deed outline', 'sale_deed'],
    ['appointment letter for a junior associate', 'employment_letter'],
    ['police complaint for stolen phone', 'police_complaint'],
    ['consumer complaint against a builder', 'consumer_complaint'],
    ['hand loan agreement of 50,000', 'loan_agreement'],
  ];
  for (const [instruction, expected] of cases) {
    assert.equal(matchTemplate(instruction)?.id, expected, instruction);
  }
});

test('a draft fills in names, amount, city and date from the sentence', async () => {
  const filled = await (await import('../src/draft/generator.js')).fillDraft({
    instruction: 'draft legal notice for Rs 2,50,000 from Rakesh Mehta for unpaid invoice dated 12/04/2025 at Jaipur',
  });
  assert.equal(filled.values.amountText, 'Rs. 2,50,000');
  assert.match(filled.values.amountWords, /two lakh fifty thousand/i);
  assert.equal(filled.values.city, 'Jaipur');
  assert.equal(filled.values.dueDate, '12/04/2025');
  assert.match(filled.values.oppositeName, /Rakesh Mehta/);
  assert.match(filled.values.purpose, /invoice/i);
  assert.match(filled.text, /LEGAL NOTICE/);
  assert.ok(!/\{\{\w+\}\}/.test(filled.text), 'no unfilled placeholders like {{amount}}');
});

test('rent agreement draft uses the rent, deposit and dates given', async () => {
  const filled = await (await import('../src/draft/generator.js')).fillDraft({
    instruction: 'rent agreement between Mr. Arun Verma and Mrs. Kusum Gupta at Jaipur for 11 months at Rs 15,000 deposit 60,000',
  });
  assert.equal(filled.values.template?.id ?? filled.template.id, 'rent_agreement');
  assert.match(filled.values.rentText, /15,000/);
  assert.match(filled.values.depositText, /60,000/);
  assert.match(filled.values.clientName, /Arun Verma/);
  assert.match(filled.values.oppositeName, /Kusum Gupta/);
  assert.match(filled.text, /ELEVEN MONTHS|11 months|eleven months/i);
});

test('a generated draft is saved with a PDF, a Word file and a text copy', async () => {
  const draft = await bot.createDraftDocument({
    owner: bot.OWNER,
    instruction: 'draft a rent agreement between Mr. Arun Verma and Mrs. Kusum Gupta at Jaipur for 11 months at Rs 15,000',
    authorName: 'Adv. Kavita Rao',
  });
  assert.ok(draft?.doc?.id, 'document created');
  for (const key of ['pdf', 'docx', 'txt']) {
    assert.ok(fs.existsSync(draft.files[key]), `${key} written`);
  }
  assert.equal(fs.readFileSync(draft.files.pdf).subarray(0, 4).toString(), '%PDF');
  assert.ok(fs.statSync(draft.files.pdf).size > 1000);
  const doc = bot.repo.getDocument(bot.OWNER, draft.doc.id);
  assert.equal(doc.doc_type, 'draft');
  assert.match(doc.rel_path, /library\//);
});

test('a case bundle is a real zip with an index inside', async () => {
  const docs = await bot.seed();
  const matter = bot.repo.createMatter(bot.OWNER, { title: 'Sharma v Mehta', client: 'Rajesh Sharma', opposite: 'Anita Mehta' });
  for (const doc of [docs.rent, docs.notice]) bot.repo.updateDocument(doc.id, { matter_id: matter.id });

  const bundle = await bot.buildBundle({
    owner: bot.OWNER,
    matter,
    docs: bot.repo.docsForMatter(matter.id),
    title: matter.title,
  });
  const zipPath = bundle.path;
  assert.ok(fs.existsSync(zipPath), 'zip file exists');
  const buffer = fs.readFileSync(zipPath);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const names = buffer.toString('latin1');
  assert.match(names, /00_INDEX\.pdf/);
  assert.match(names, /00_MANIFEST\.csv/);
  assert.match(names, /01_Rent-Lease-Agreement/);
  assert.match(names, /02_Legal-Notice/);
  assert.equal(bundle.count, 2);
  assert.ok(bundle.size > 2000);
  const saved = bot.repo.getBundle(bundle.bundle.id);
  assert.ok(saved, 'bundle recorded in the library');
});
