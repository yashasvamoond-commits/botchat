import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot } from './helpers.js';

const bot = await boot();
const docs = await bot.seed();
const matter = bot.repo.createMatter(bot.OWNER, {
  title: 'Sharma v Mehta',
  client: 'Rajesh Sharma',
  opposite: 'Anita Mehta',
  court: 'Rajasthan High Court',
});
for (const doc of [docs.rent, docs.notice]) {
  bot.repo.updateDocument(doc.id, { matter_id: matter.id });
  bot.repo.reindexDoc(bot.repo.getDocument(bot.OWNER, doc.id));
}

test('help explains the bot in plain language', async () => {
  const reply = await bot.say('help');
  assert.match(reply, /X Document Manager/i);
  assert.match(reply, /bundle/i);
  assert.match(reply, /search/i);
});

test('asking for a document type returns the file itself', async () => {
  const reply = await bot.say('rent agreement');
  assert.match(reply, /Rent \/ Lease Agreement/i);
  const files = bot.lastOutput.filter((p) => p.document);
  assert.equal(files.length, 1);
  assert.ok(fs.existsSync(files[0].document.path));
  assert.match(files[0].document.caption, new RegExp(docs.rent.id));
});

test('an id opens that exact document', async () => {
  const reply = await bot.say(docs.invoice.id);
  assert.match(reply, /Invoice/i);
  assert.equal(bot.lastOutput.filter((p) => p.document).length, 1);
});

test('a question gets a quoted answer, not just a file', async () => {
  const reply = await bot.say('what is the notice period in the rent agreement');
  assert.match(reply, /Answer from D\d/i);
  assert.match(reply, /30 days written notice/i);
});

test('cases, one case, and its documents', async () => {
  const list = await bot.say('cases');
  assert.match(list, /Sharma v Mehta/);
  const one = await bot.say(`case ${matter.id}`);
  assert.match(one, new RegExp(matter.id));
  assert.match(one, /Legal Notice/i);
});

test('"bundle" compiles the current case into one zip', async () => {
  const reply = await bot.say(`case ${matter.id}`);
  assert.match(reply, /bundle/i);
  const bundleReply = await bot.say('bundle');
  assert.match(bundleReply, /bundle|zip/i);
  const files = bot.lastOutput.filter((p) => p.document);
  assert.equal(files.length, 1);
  assert.match(files[0].document.filename, /\.zip$/);
  assert.ok(fs.statSync(files[0].document.path).size > 2000);
});

test('drafting a document saves it and sends the Word file', async () => {
  const reply = await bot.say('draft a legal notice for Rs 2,50,000 from Rakesh Mehta for unpaid invoice dated 12/04/2025 at Jaipur');
  assert.match(reply, /Draft saved|draft is ready|saved as/i);
  const files = bot.lastOutput.filter((p) => p.document);
  assert.ok(files.length >= 1);
  assert.match(files[0].document.filename, /\.(docx|pdf)$/);
});

test('reminders and deadlines', async () => {
  const reply = await bot.say('remind me 3 days before 12/12/2026 hearing in the Mehta matter');
  assert.match(reply, /Reminder set/i);
  const list = await bot.say('deadlines');
  assert.match(list, /Coming up/i);
  assert.match(list, /12 Dec 2026/);
});

test('deleting asks first, and undo brings it back', async () => {
  const ask = await bot.say(`delete ${docs.invoice.id}`);
  assert.match(ask, /Remove/i);
  const done = await bot.say('yes');
  assert.match(done, /Removed/i);
  assert.equal(bot.repo.getDocument(bot.OWNER, docs.invoice.id), null);

  const undone = await bot.say('undo');
  assert.match(undone, /Restored/i);
  assert.ok(bot.repo.getDocument(bot.OWNER, docs.invoice.id));
});

test('renaming a document updates its title and its file name', async () => {
  const reply = await bot.say(`rename ${docs.rent.id} to Rent Agreement Sharma v Mehta final`);
  assert.match(reply, /Renamed|now called/i);
  const doc = bot.repo.getDocument(bot.OWNER, docs.rent.id);
  assert.match(doc.title, /final/i);
  assert.match(doc.file_name, /final/i);
});

test('a note becomes searchable text on the document', async () => {
  await bot.say(`note ${docs.rent.id} landlord will repaint before 15 May`);
  const found = await bot.say('repaint');
  assert.match(found, /Rent \/ Lease Agreement/i);
});

test('nonsense gets a friendly nudge, not a crash', async () => {
  const reply = await bot.say('zxcvbnm qwerty');
  assert.ok(reply.length > 20);
  assert.match(reply, /could not find|try|help/i);
});

test('a greeting is answered politely', async () => {
  const reply = await bot.say('hi');
  assert.match(reply, /X Document Manager|Ready|hello|namaste/i);
});
