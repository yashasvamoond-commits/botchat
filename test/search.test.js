import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const bot = await boot();
const docs = await bot.seed();
const matters = bot.repo.listMatters(bot.OWNER, { status: null, limit: 50 });

const plan = (q) => bot.parseQuery(q, { matters });

test('a bare document id is understood', () => {
  assert.equal(plan(docs.rent.id).docId, docs.rent.id);
  assert.equal(plan('d4').docId, docs.invoice.id);
});

test('"rent agreement" is treated as a document type', () => {
  const p = plan('rent agreement');
  assert.ok(p.typeIds.includes('rent_agreement'), `got ${p.typeIds}`);
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.equal(result.docs[0].id, docs.rent.id);
});

test('a question about the notice period quotes the notice clause', () => {
  const p = plan('what is the notice period in the rent agreement');
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.equal(result.docs[0].id, docs.rent.id);

  const passage = bot.bestPassage(result.docs[0].text, p.terms.join(' '));
  assert.match(passage.passage, /30 days written notice/i);
  assert.ok(passage.page >= 1, 'page number is filled in');
});

test('"notices from last month" filters by type and by date', () => {
  const p = plan('notices from last month');
  assert.equal(p.dateRange?.label, 'last month');
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.equal(result.docs.length, 1, result.docs.map((d) => d.id).join(','));
  assert.equal(result.docs[0].id, docs.notice.id);
});

test('a misspelling still finds the document', () => {
  const p = plan('agreemnt');
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.ok(result.suggestion, 'offers a corrected word');
  assert.ok(result.docs.some((d) => d.id === docs.rent.id), 'finds the rent agreement');
});

test('a chosen case is never widened to other cases', () => {
  const matter = bot.repo.createMatter(bot.OWNER, {
    title: 'Sharma v Mehta',
    client: 'Rajesh Sharma',
    opposite: 'Anita Mehta',
  });
  bot.repo.updateDocument(docs.rent.id, { matter_id: matter.id });
  bot.repo.reindexDoc(bot.repo.getDocument(bot.OWNER, docs.rent.id));

  const p = plan('zzz nothing here');
  p.matterId = matter.id;
  p.lockMatter = true;
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.ok(result.docs.length >= 1);
  assert.ok(result.docs.every((d) => d.matter_id === matter.id));
});

test('searching everything finds all four documents', () => {
  const p = plan('everything');
  p.terms = [];
  p.typeIds = [];
  p.tags = [];
  p.limit = 50;
  const result = bot.searchDocuments(bot.OWNER, p);
  assert.equal(result.total, 4);
});
