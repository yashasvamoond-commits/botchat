/**
 * Hindi / Urdu understanding + eCourts permanent memory.
 * Own throwaway data folder comes from helpers.boot().
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const bot = await boot();
const ecourts = await import('../src/store/ecourts.js');
const ingestEcourts = await import('../src/ingest/ecourts.js');
const { interpret } = await import('../src/bot/interpreter.js');
const { analyzeDocument } = await import('../src/analysis/analyzer.js');
const { parseQuery } = await import('../src/search/queryParser.js');
const { relativeRange } = await import('../src/util/dates.js');

const RENT_HI = `किराया अनुबंध

यह किराया अनुबंध आज दिनांक 12 अप्रैल 2026 को जयपुर में श्री राजेश शर्मा पुत्र श्री मोहन शर्मा, निवासी 12 सिविल लाइन्स, जयपुर (मकान मालिक) तथा श्रीमती अनीता मेहता पत्नी श्री संजय मेहता, निवासी 88 वैशाली नगर, जयपुर (किरायेदार) के बीच किया गया।

1. अवधि। यह किरायेदारी 11 माह की अवधि के लिए 27 अप्रैल 2026 से प्रारंभ होगी।
2. किराया। किरायेदार मासिक किराया 25,000 रुपये प्रतिमाह अंग्रेजी माह की 5 तारीख तक अग्रिम भुगतान करेगा।
3. जमा राशि। किरायेदार ने 1,00,000 रुपये बिना ब्याज की जमा राशि मकान मालिक को दी है।
4. सूचना। किसी भी पक्षकार द्वारा 30 दिन की लिखित सूचना देकर यह अनुबंध समाप्त किया जा सकता है।
`;

const NOTICE_UR = `قانونی نوٹس

تاریخ: 16 اکتوبر 2026

بنام
جناب ونود پرکاش
14 جوہری بازار، جے پور

موضوع: دفعتہ 138 قابلِ تبادلہ دستاویزات ایکٹ 1881 کے تحت نوٹس

جناب،
از میسرز مہتا انڈسٹریز پرائیویٹ لمیٹڈ کی طرف سے یہ نوٹس دیا جاتا ہے کہ آپ نے چیک نمبر 445102 بمبلغ روپے 4,50,000 جاری کیا جو 20 ستمبر 2026 کو باؤنس ہو گیا۔ آپ کو 15 دن کے اندر روپے 4,50,000 ادا کرنے کی ہدایت کی جاتی ہے۔
`;

const ECOURTS_TXT = `eCourts Case Status
CNR Number: RJJP010012342018
Case Number: 123/2018
Petitioner(s): Rajesh Sharma
Respondent(s): Anita Mehta
Court: Civil Judge (Junior Division), Jaipur
Filing Date: 12-04-2018
Next Hearing Date: 05-05-2027
Case Status: Pending
Stage: Evidence

CNR Number: RJJP020011112023
Case Number: 789/2023
याचिकाकर्ता: सुरेश जैन
प्रतिवादी: नेहा अग्रवाल
न्यायालय: जिला एवं सत्र न्यायालय, जयपुर
दाखिल करने की तारीख: 15-06-2023
अगली सुनवाई की तारीख: 10-01-2027
स्थिति: लंबित
`;

test('a Hindi rent agreement is understood field by field', () => {
  const doc = analyzeDocument({ text: RENT_HI, filename: 'किराया अनुबंध.txt' });
  assert.equal(doc.docType, 'rent_agreement');
  assert.equal(doc.language, 'hi');
  assert.equal(doc.docDate, '2026-04-12');
  assert.match(doc.title, /किराया अनुबंध/);
  assert.deepEqual(doc.parties.map((p) => p.role).sort(), ['Lessee', 'Lessor']);
  const amounts = Object.fromEntries(doc.amounts.map((a) => [a.label, a.value]));
  assert.equal(amounts.Rent, 25000);
  assert.equal(amounts['Security deposit'], 100000);
  assert.ok(doc.clauses.some((c) => c.key === 'term'));
  assert.ok(doc.clauses.some((c) => c.key === 'notice'));
});

test('an Urdu legal notice finds the addressee, the cheque amount and section 138', () => {
  const doc = analyzeDocument({ text: NOTICE_UR, filename: 'قانونی نوٹس.txt' });
  assert.equal(doc.docType, 'legal_notice');
  assert.equal(doc.language, 'ur');
  assert.equal(doc.docDate, '2026-10-16');
  assert.equal(doc.parties[0].role, 'Addressee');
  assert.equal(doc.amounts[0].value, 450000);
  assert.ok(doc.statutes.some((s) => s.section === '138'));
});

test('Hindi and Urdu questions parse into the same plan as English', () => {
  const hi = parseQuery('पिछले महीने के किराया अनुबंध');
  assert.ok(hi.typeIds.includes('rent_agreement'));
  assert.equal(hi.dateRange.label, 'last month');
  const ur = parseQuery('گزشتہ ماہ کے قانونی نوٹس');
  assert.ok(ur.typeIds.includes('legal_notice'));
  assert.equal(ur.dateRange.label, 'last month');
  assert.equal(relativeRange('अप्रैल 2026').from, '2026-04-01');
});

test('Hindi and Urdu commands reach the right intent', () => {
  assert.equal(interpret('अगली सुनवाई').intent, 'hearings');
  assert.equal(interpret('اگلی سماعت').intent, 'hearings');
  assert.equal(interpret('ecourts').intent, 'ecourts');
  assert.equal(interpret('RJJP010012342018').intent, 'ecourts_case');
});

test('an eCourts .txt dump is parsed into one record per case', () => {
  const records = ecourts.parseEcourtsText(ECOURTS_TXT);
  assert.equal(records.length, 2);
  assert.equal(records[0].cnr, 'RJJP010012342018');
  assert.equal(records[0].title, 'Rajesh Sharma v Anita Mehta');
  assert.equal(records[0].next_hearing, '2027-05-05');
  assert.equal(records[1].petitioner, 'सुरेश जैन');
  assert.equal(records[0].court, 'Civil Judge (Junior Division), Jaipur');
});

test('an ordinary .txt document is not mistaken for eCourts data', () => {
  assert.equal(ecourts.looksLikeEcourts('rent agreement.txt', 'This Rent Agreement is made at Jaipur'), false);
  assert.equal(ecourts.looksLikeEcourts('dump.txt', ECOURTS_TXT), true);
});

test('eCourts data is remembered, updated in place, and survives a re-import', async () => {
  const owner = 'ecourts-owner';
  const first = ingestEcourts.importEcourtsUpload({
    owner, buffer: Buffer.from(ECOURTS_TXT, 'utf8'), filename: 'ecourts-status.txt',
  });
  assert.equal(first.handled, true);
  assert.equal(first.added, 2);
  assert.equal(first.updated, 0);
  assert.equal(ecourts.ecourtsSummary(owner).total, 2);

  const second = ingestEcourts.importEcourtsUpload({
    owner, buffer: Buffer.from(ECOURTS_TXT, 'utf8'), filename: 'ecourts-status.txt',
  });
  assert.equal(second.added, 0);
  assert.equal(second.updated, 2);
  assert.equal(ecourts.ecourtsSummary(owner).total, 2, 'no duplicates on re-import');

  const found = ecourts.findEcourtsCase(owner, 'RJJP010012342018');
  assert.equal(found.title, 'Rajesh Sharma v Anita Mehta');
  const upcoming = ecourts.upcomingHearings(owner, { from: '2027-01-01' });
  assert.ok(upcoming.length >= 1);
  assert.ok(upcoming.every((r) => r.next_hearing >= '2027-01-01'));
});

test('the case card counts days the right way round', async () => {
  const { ecourtsCard } = await import('../src/bot/ecourts.js');
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  assert.match(ecourtsCard({ title: 'A v B', next_hearing: future }), /in (9|10|11) days/);
  assert.match(ecourtsCard({ title: 'A v B', next_hearing: past }), /(9|10|11) days ago/);
});

test('a remembered case answers the chat and the hearing diary', async () => {
  const owner = 'local';
  ingestEcourts.importEcourtsUpload({
    owner, buffer: Buffer.from(ECOURTS_TXT, 'utf8'), filename: 'ecourts-status.txt',
  });
  const list = await bot.say('ecourts');
  assert.match(list, /Rajesh Sharma v Anita Mehta/);
  const card = await bot.say('RJJP010012342018');
  assert.match(card, /Next hearing/);
  assert.match(card, /2027/);
  const diary = await bot.say('next hearing');
  assert.match(diary, /Next hearings/);
});
