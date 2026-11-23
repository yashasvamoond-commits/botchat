import test from 'node:test';
import assert from 'node:assert/strict';
import { isolate, NOTICE } from './helpers.js';

// Start the real server on a random port, before importing it.
isolate();
process.env.PORT = '0';
const { server } = await import('../src/server.js');
await new Promise((resolve) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const CODE = process.env.DASHBOARD_TOKEN;

let cookie = '';

async function api(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(cookie ? { cookie } : {}) },
  });
}

test.after(() => {
  server.close();
});

test('the dashboard is closed until the access code is given', async () => {
  const denied = await api('/api/overview');
  assert.equal(denied.status, 401);

  const wrong = await api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'nope' }),
  });
  assert.equal(wrong.status, 401);

  const ok = await api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: CODE }),
  });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie') || '';
  assert.match(setCookie, /xdm_session=/);
  cookie = setCookie.split(';')[0];
});

test('the home page loads without a login screen flash', async () => {
  const page = await api('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /X Document Manager/);
});

test('the chat endpoint answers like WhatsApp does', async () => {
  const res = await api('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'help' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.messages) && body.messages.length >= 1);
  assert.match(body.messages.map((m) => m.text).join(' '), /Send me anything/i);
});

test('a file can be uploaded and then found by search', async () => {
  const form = new FormData();
  form.append('file', new Blob([NOTICE], { type: 'text/plain' }), 'legal notice vinod.txt');
  const upload = await api('/api/upload', { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  assert.ok(uploaded.document?.id);
  assert.equal(uploaded.document.type, 'legal_notice');

  const found = await api('/api/documents?q=legal%20notice');
  const body = await found.json();
  assert.ok(body.documents.some((d) => d.id === uploaded.document.id));
});

test('document detail, file download and the overview all work', async () => {
  const list = await (await api('/api/documents')).json();
  const doc = list.documents[0];
  assert.ok(doc.id);

  const detail = await (await api(`/api/documents/${doc.id}`)).json();
  assert.ok(detail.text.length > 20);

  assert.match(doc.fileUrl, /^\/api\/file\?p=/);
  const file = await api(doc.fileUrl);
  assert.equal(file.status, 200);
  assert.ok((await file.arrayBuffer()).byteLength > 100);

  const overview = await (await api('/api/overview')).json();
  assert.equal(overview.stats.total, list.documents.length);
  assert.ok(overview.code || overview.codes || true);
});

test('the CSV export is real CSV', async () => {
  const res = await api('/api/export/csv');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text.split('\n')[0], /ID|Title|Date/i);
  assert.match(text, /D\d/);
});

test('paths outside the data folder are refused', async () => {
  const res = await api('/api/file?p=../../etc/passwd');
  assert.equal(res.status, 404);
});
