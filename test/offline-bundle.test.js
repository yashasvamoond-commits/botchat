/**
 * The downloadable single-file app must actually run.
 *
 * There is no browser here, so the generated page's two <script> blocks are
 * evaluated against a small DOM stub. That is enough to prove the bundle is not
 * broken, that the analysis engine is wired correctly and that documents and
 * eCourts cases are stored and searched the same way the server does it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

test('the offline page is built', () => {
  execFileSync(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts', 'build-offline.js')], { cwd: ROOT });
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(html.includes('X Document Manager'), 'page has a title');
  assert.ok(!/<script[^>]+src=/.test(html), 'no external scripts — one file only');
  assert.ok(!/https?:\/\//.test(html.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')), 'no network references');
});

function stubElement(selector) {
  const classes = new Set();
  return {
    selector,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    attributes: {},
    files: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    prepend() {},
    remove() {},
    focus() {},
    click() {},
    scrollIntoView() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeDom() {
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, stubElement(selector));
    return nodes.get(selector);
  };
  const storage = new Map();
  const document = {
    readyState: 'complete',
    documentElement: { lang: 'en', dir: 'ltr' },
    body: stubElement('body'),
    createElement: (tag) => stubElement(tag),
    querySelector: (selector) => get(selector),
    querySelectorAll: () => [],
    addEventListener() {},
    getElementById: (id) => get(`#${id}`),
  };
  const window = {
    document,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    confirm: () => true,
    addEventListener() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    setTimeout,
    clearTimeout,
    console,
    Blob: class { constructor(parts) { this.parts = parts; } },
    FileReader: class { readAsText() {} },
  };
  window.window = window;
  const context = vm.createContext({ ...window, document, window, console, setTimeout, clearTimeout });
  return { context, nodes, storage };
}

function loadPage() {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2, 'engine + app script');
  const dom = makeDom();
  for (const code of scripts) vm.runInContext(code, dom.context, { filename: 'offline-app.js' });
  return dom;
}

const RENT_HI = `किराया अनुबंध

यह किराया अनुबंध दिनांक 12 अप्रैल 2026 को श्री राजेश शर्मा (मकान मालिक) तथा श्रीमती अनीता मेहता (किरायेदार) के बीच किया गया।

1. अवधि। यह किरायेदारी 11 माह की अवधि के लिए 27 अप्रैल 2026 से प्रारंभ होगी।
2. किराया। किराएदार मासिक किराया 25,000 रुपये प्रतिमाह भुगतान करेगा।
3. जमा राशि। किराएदार ने 1,00,000 रुपये जमा राशि दी है।
`;

const NOTICE_EN = `LEGAL NOTICE
Dated: 16 October 2026
To, Mr. Vinod Prakash
Under Section 138 of the Negotiable Instruments Act, 1881 you issued cheque No. 445102 for Rs. 4,50,000 which was dishonoured. Pay within 15 days.
`;

const ECOURTS = `CNR Number: RJJP010012342018
Case Number: 123/2018
Petitioner(s): Rajesh Sharma
Respondent(s): Anita Mehta
Court: Civil Judge (Junior Division), Jaipur
Filing Date: 12-04-2018
Next Hearing Date: 05-05-2027
Case Status: Pending
Stage: Evidence
`;

test('the page boots and exposes its API', () => {
  const dom = loadPage();
  const api = dom.context.window.__XDM;
  assert.ok(api && typeof api.analyse === 'function');
  assert.equal(dom.nodes.get('#stats').innerHTML.includes('0'), true, 'stats render on boot');
});

test('a Hindi agreement is analysed inside the page', () => {
  const api = loadPage().context.window.__XDM;
  const result = api.analyse(RENT_HI, 'किराया अनुबंध.txt');
  assert.equal(result.docType, 'rent_agreement');
  assert.equal(result.language, 'hi');
  assert.equal(result.docDate, '2026-04-12');
  assert.equal(result.parties.map((p) => p.role).sort().join(','), 'Lessee,Lessor');
  const rent = result.amounts.find((a) => a.label === 'Rent');
  assert.equal(rent.value, 25000);
});

test('documents are saved, listed and found by an English or Hindi query', () => {
  const dom = loadPage();
  const api = dom.context.window.__XDM;

  const hindi = api.saveDoc(api.analyse(RENT_HI, 'rent.txt'), 'rent.txt', RENT_HI);
  const english = api.saveDoc(api.analyse(NOTICE_EN, 'notice.txt'), 'notice.txt', NOTICE_EN);
  assert.equal(hindi.id, 'D1');
  assert.equal(english.id, 'D2');
  api.render();

  assert.equal(api.loadStore().docs.length, 2);
  assert.match(dom.nodes.get('#stats').innerHTML, /2/);

  const hiSearch = api.searchDocs('किराया अनुबंध');
  assert.equal(hiSearch.docs[0].doc_type, 'rent_agreement');

  const enSearch = api.searchDocs('legal notice Prakash');
  assert.equal(enSearch.docs[0].doc_type, 'cheque_bounce_notice');

  const byId = api.searchDocs('D2');
  assert.equal(byId.docs[0].id, 'D2');
});

test('eCourts text is remembered in the page, with no duplicates on re-import', () => {
  const api = loadPage().context.window.__XDM;
  assert.equal(api.saveCases(ECOURTS), 1);
  assert.equal(api.saveCases(ECOURTS), 1);
  const cases = api.loadStore().cases;
  assert.equal(cases.length, 1);
  assert.equal(cases[0].cnr, 'RJJP010012342018');
  assert.equal(cases[0].next_hearing, '2027-05-05');
});

test('the ask box routes a CNR to the eCourts case', () => {
  const dom = loadPage();
  const api = dom.context.window.__XDM;
  api.saveCases(ECOURTS);
  api.answerQuery('RJJP010012342018');
  const list = dom.nodes.get('#ec-list').innerHTML;
  assert.match(list, /Rajesh Sharma v Anita Mehta/);
  assert.match(list, /2027/);
});

test('the page works in all three languages', () => {
  const dom = loadPage();
  const api = dom.context.window.__XDM;
  api.lang('ur');
  assert.equal(dom.context.document.documentElement.dir, 'rtl');
  api.lang('hi');
  assert.equal(dom.context.document.documentElement.dir, 'ltr');
  api.lang('en');
});
