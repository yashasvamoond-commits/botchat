const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  tab: 'chat',
  docs: [],
  selected: null,
  matters: [],
  overview: null,
  type: '',
  query: '',
  pendingFile: null,
};

/* ─────────────────────────── helpers ─────────────────────────── */

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    showGate();
    throw new Error('Please unlock again.');
  }
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** WhatsApp-style *bold* / _italic_ / `code` → safe HTML. */
function waHtml(text) {
  let out = escapeHtml(text);
  out = out.replace(/```([\s\S]*?)```/g, (_, code) => `<span class="mono">${code.trim()}</span>`);
  out = out.replace(/`([^`\n]+)`/g, '<span class="mono">$1</span>');
  out = out.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  out = out.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
  return out;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fileTag(name = '') {
  const ext = (name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
  return ext;
}

function confirmDialog(title, body, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.innerHTML = `<div class="gate-card">
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(body)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn primary" data-yes>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-no]').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('[data-yes]').onclick = () => { overlay.remove(); resolve(true); };
  });
}

function promptDialog(title, fields) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.innerHTML = `<form class="gate-card">
      <h2>${escapeHtml(title)}</h2>
      ${fields.map((f, i) => `<label>${escapeHtml(f.label)}${f.type === 'textarea'
        ? `<textarea name="${f.name}" rows="3" placeholder="${escapeHtml(f.placeholder || '')}"></textarea>`
        : `<input name="${f.name}" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} />`}</label>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn ghost" data-no>Cancel</button>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-no]').onclick = () => { overlay.remove(); resolve(null); };
    overlay.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      overlay.remove();
      resolve(data);
    };
  });
}

/* ─────────────────────────── auth ─────────────────────────── */

function showGate() {
  $('#shell').classList.add('hidden');
  $('#gate').classList.remove('hidden');
}

async function boot() {
  try {
    const session = await api('/api/session');
    if (!session.ok) return showGate();
    await enterApp();
  } catch {
    showGate();
  }
}

$('#gate-btn').onclick = async () => {
  const token = $('#token').value.trim();
  $('#gate-error').textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    await enterApp();
  } catch (err) {
    $('#gate-error').textContent = err.message || 'Wrong code.';
  }
};
$('#token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-btn').click(); });

async function enterApp() {
  $('#gate').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  await refreshOverview();
  await loadChatHistory();
  await loadCases();
  await loadDeadlines();
  await loadTemplates();
  if (state.tab === 'library') await loadDocs();
}

/* ─────────────────────────── tabs ─────────────────────────── */

$$('.rail-item').forEach((button) => {
  button.onclick = () => switchTab(button.dataset.tab);
});

function switchTab(tab) {
  state.tab = tab;
  $$('.rail-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((section) => section.classList.toggle('active', section.id === `tab-${tab}`));
  if (tab === 'library' && !state.docs.length) loadDocs();
  if (tab === 'cases') loadCases();
  if (tab === 'dates') loadDeadlines();
  if (tab === 'settings') renderSettings();
  if (tab === 'chat') setTimeout(scrollChat, 50);
}

/* ─────────────────────────── overview ─────────────────────────── */

async function refreshOverview() {
  const data = await api('/api/overview');
  state.overview = data;
  state.matters = data.matters || [];
  $('#wa-dot').classList.toggle('on', Boolean(data.whatsapp));
  $('#wa-label').textContent = data.whatsapp ? 'live' : 'demo';
  $('#chat-count').textContent = `${data.stats.total} documents · ${data.stats.matters} cases`;
  $('#library-count').textContent = `${data.stats.total} documents · ${data.stats.needsReview} to check · ${data.stats.matters} active cases`;
  renderTypeChips();
  renderSettings();
  fillMatterSelects();
}

function renderTypeChips() {
  const chips = $('#type-chips');
  if (!chips || !state.overview) return;
  const types = state.overview.typeCounts.filter((t) => t.doc_type).slice(0, 9);
  chips.innerHTML = [
    `<button class="chip ${state.type === '' ? 'active' : ''}" data-type="">All</button>`,
    ...types.map((t) => `<button class="chip ${state.type === t.doc_type ? 'active' : ''}" data-type="${escapeHtml(t.doc_type)}">${escapeHtml(t.type_label || t.doc_type)} <b>${t.n}</b></button>`),
  ].join('');
  $$('.chip', chips).forEach((chip) => {
    chip.onclick = () => {
      state.type = chip.dataset.type;
      renderTypeChips();
      loadDocs();
    };
  });
}

function fillMatterSelects() {
  const select = $('#dl-matter');
  if (!select) return;
  select.innerHTML = `<option value="">— none —</option>${state.matters
    .map((m) => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('')}`;
}

/* ─────────────────────────── chat ─────────────────────────── */

function appendMessage({ direction = 'in', html, kind = 'text', file = null, time = new Date() }) {
  const chat = $('#chat');
  const wrap = document.createElement('div');
  wrap.className = `msg ${direction}`;
  if (kind === 'document' && file) {
    wrap.innerHTML = `<div class="file-bubble">
      <div class="f-ico">${escapeHtml(fileTag(file.filename))}</div>
      <div>
        <div class="f-name">${escapeHtml(file.filename)}</div>
        <div class="f-meta">${escapeHtml(file.caption || 'Document')}</div>
        <a href="${file.url}" target="_blank" rel="noopener">Open / download</a>
      </div>
    </div><div class="time">${relTime(time)}</div>`;
  } else {
    wrap.innerHTML = `<div class="bubble">${html}</div><div class="time">${relTime(time)}</div>`;
  }
  chat.appendChild(wrap);
  scrollChat();
  return wrap;
}

function scrollChat() {
  const chat = $('#chat');
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  const chat = $('#chat');
  const wrap = document.createElement('div');
  wrap.className = 'msg in';
  wrap.id = 'typing';
  wrap.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
  chat.appendChild(wrap);
  scrollChat();
}

function hideTyping() {
  $('#typing')?.remove();
}

async function loadChatHistory() {
  try {
    const data = await api('/api/chat/history');
    if (!data.messages?.length) return;
    $('#chat').innerHTML = '<div class="chat-day">Earlier</div>';
    for (const message of data.messages) {
      if (message.direction === 'in') {
        appendMessage({ direction: 'out', html: waHtml(message.text || '') });
      } else if (message.kind === 'text') {
        appendMessage({ direction: 'in', html: waHtml(message.text || '') });
      }
    }
    const divider = document.createElement('div');
    divider.className = 'chat-day';
    divider.textContent = 'Today';
    $('#chat').appendChild(divider);
  } catch { /* first run */ }
}

$('#composer').onsubmit = async (event) => {
  event.preventDefault();
  const input = $('#message');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  appendMessage({ direction: 'out', html: waHtml(text) });
  showTyping();
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    hideTyping();
    await playMessages(data.messages);
  } catch (err) {
    hideTyping();
    appendMessage({ direction: 'in', html: waHtml(`⚠️ ${err.message}`) });
  }
};

async function playMessages(messages = []) {
  for (const message of messages) {
    if (message.kind === 'text') {
      appendMessage({ direction: 'in', html: waHtml(message.text) });
    } else if (message.kind === 'document' || message.kind === 'image') {
      appendMessage({ direction: 'in', kind: 'document', file: message });
    }
    await new Promise((r) => setTimeout(r, 220));
  }
  await refreshOverview();
  if (state.tab === 'library') loadDocs();
}

$('#message').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = `${Math.min(130, e.target.scrollHeight)}px`;
});
$('#message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

$('#attach').onclick = () => $('#file-input').click();
$('#file-input').onchange = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  state.pendingFile = file;
  const preview = $('#attach-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = `<span>📎 ${escapeHtml(file.name)}</span><span><a href="#" id="attach-cancel">remove</a></span>`;
  $('#attach-cancel').onclick = (e) => {
    e.preventDefault();
    state.pendingFile = null;
    preview.classList.add('hidden');
    $('#file-input').value = '';
  };
  $('#message').focus();
};

// Files are sent with the next message press.
const originalSubmit = $('#composer').onsubmit;
$('#composer').onsubmit = async (event) => {
  event.preventDefault();
  if (state.pendingFile) return sendPendingFile();
  return originalSubmit(event);
};

async function sendPendingFile() {
  const file = state.pendingFile;
  const caption = $('#message').value.trim();
  state.pendingFile = null;
  $('#attach-preview').classList.add('hidden');
  $('#message').value = '';
  $('#file-input').value = '';

  appendMessage({
    direction: 'out',
    kind: 'document',
    file: { filename: file.name, caption: caption || 'Sending…', url: '#', mime: file.type },
  });
  showTyping();
  const form = new FormData();
  form.append('file', file);
  form.append('caption', caption);
  try {
    const data = await api('/api/chat/upload', { method: 'POST', body: form });
    hideTyping();
    await playMessages(data.messages);
  } catch (err) {
    hideTyping();
    appendMessage({ direction: 'in', html: waHtml(`⚠️ ${err.message}`) });
  }
}

$('#chat-reset').onclick = async () => {
  if (!(await confirmDialog('Clear this view?', 'Only the visible chat is cleared. Your documents and files stay exactly as they are.', 'Clear'))) return;
  $('#chat').innerHTML = `<div class="chat-day">Today</div><div class="note-strip">Cleared. Your documents are untouched.</div>`;
};

/* ─────────────────────────── library ─────────────────────────── */

let searchTimer = null;
$('#lib-search').addEventListener('input', (event) => {
  state.query = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadDocs, 260);
});

async function loadDocs() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  else if (state.type) params.set('type', state.type);
  params.set('limit', '80');
  const data = await api(`/api/documents?${params.toString()}`);
  state.docs = data.documents || [];
  const rows = $('#doc-rows');
  if (!state.docs.length) {
    rows.innerHTML = `<div class="empty-state"><span class="big">🗂</span><p>No documents match. Try fewer words or another spelling.</p></div>`;
    return;
  }
  rows.innerHTML = state.docs.map((doc) => `
    <div class="doc-row ${state.selected?.id === doc.id ? 'active' : ''}" data-id="${doc.id}">
      <div class="badge">${escapeHtml(doc.id)}</div>
      <div>
        <div class="title">${escapeHtml(doc.title || doc.originalName || 'Untitled')}</div>
        <div class="meta">
          <span>${escapeHtml(doc.typeLabel || '')}</span>
          ${doc.matterId ? `<span>· ${escapeHtml(doc.matterId)}</span>` : ''}
          ${doc.needsReview ? '<span>· ⚠️ check</span>' : ''}
        </div>
      </div>
      <div class="date">${doc.date ? fmtDate(doc.date) : fmtDate(doc.createdAt)}</div>
    </div>`).join('');
  $$('.doc-row', rows).forEach((row) => {
    row.onclick = () => selectDoc(row.dataset.id);
  });
}

async function selectDoc(id) {
  const doc = await api(`/api/documents/${id}`);
  state.selected = doc;
  $$('.doc-row').forEach((row) => row.classList.toggle('active', row.dataset.id === id));
  if (window.innerWidth <= 1080) {
    // On small screens open the file directly.
    if (doc.fileUrl) window.open(doc.fileUrl, '_blank');
  }
  renderPreview(doc);
}

function renderPreview(doc) {
  const preview = $('#preview');
  const isPdf = /\.pdf$/i.test(doc.fileName || '') || (doc.fileUrl || '').includes('.pdf');
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(doc.fileName || '');
  preview.innerHTML = `
    <h2>${escapeHtml(doc.title)}</h2>
    <div class="pill-row">
      <span class="pill green">${escapeHtml(doc.id)}</span>
      <span class="pill">${escapeHtml(doc.typeLabel || '')}</span>
      ${doc.date ? `<span class="pill">${fmtDate(doc.date)}</span>` : ''}
      ${doc.pages ? `<span class="pill">${doc.pages} pages</span>` : ''}
      ${doc.language === 'hi' ? '<span class="pill">Hindi</span>' : ''}
    </div>
    ${doc.matter ? `<p class="small muted">Case: <b>${escapeHtml(doc.matter.title)}</b> (${escapeHtml(doc.matter.id)})</p>` : ''}
    <dl class="kv">
      ${doc.parties?.length ? `<dt>Parties</dt><dd>${doc.parties.map((p) => escapeHtml(typeof p === 'string' ? p : `${p.name}${p.role ? ` (${p.role})` : ''}`)).join('<br>')}</dd>` : ''}
      ${doc.court ? `<dt>Court</dt><dd>${escapeHtml(doc.court)}</dd>` : ''}
      ${doc.caseNumber ? `<dt>Case no.</dt><dd>${escapeHtml(doc.caseNumber)}</dd>` : ''}
      ${doc.amounts?.length ? `<dt>Amounts</dt><dd>${doc.amounts.slice(0, 3).map((a) => escapeHtml(a.raw)).join('<br>')}</dd>` : ''}
      ${doc.tags?.length ? `<dt>Tags</dt><dd>${doc.tags.map((t) => escapeHtml(t)).join(' · ')}</dd>` : ''}
      <dt>Original</dt><dd class="small muted">${escapeHtml(doc.originalName || '—')}</dd>
    </dl>
    <div class="summary-box">${escapeHtml(doc.summary || 'No summary.')}</div>
    <div class="doc-actions">
      ${doc.fileUrl ? `<a class="btn primary small" href="${doc.fileUrl}" target="_blank" rel="noopener">Open file</a>` : ''}
      ${doc.docxUrl ? `<a class="btn ghost small" href="${doc.docxUrl}">Word copy</a>` : ''}
      <button class="btn ghost small" data-rename>Rename</button>
      <select class="btn ghost small" data-matter-select style="max-width:190px">
        <option value="">— no case —</option>
        ${state.matters.map((m) => `<option value="${m.id}" ${m.id === doc.matterId ? 'selected' : ''}>${escapeHtml(m.title)}</option>`).join('')}
      </select>
      <button class="btn danger small" data-delete>Delete</button>
    </div>
    ${isPdf ? `<div class="frame-wrap"><iframe src="${doc.fileUrl}#toolbar=0&navpanes=0" title="preview"></iframe></div>`
      : isImage ? `<div class="frame-wrap"><img src="${doc.fileUrl}" style="width:100%;height:100%;object-fit:contain" alt="document" /></div>`
      : `<div class="text-preview">${escapeHtml((doc.text || '').slice(0, 4000) || 'No readable text — this file is indexed by its name, date and caption.')}</div>`}
    ${doc.related?.length ? `<h3 style="margin-top:16px">Also in this file</h3>${doc.related.map((r) => `<p class="small"><a href="#" data-related="${r.id}">${escapeHtml(r.id)} · ${escapeHtml(r.title)}</a></p>`).join('')}` : ''}
  `;
  preview.querySelector('[data-rename]').onclick = async () => {
    const result = await promptDialog('Rename document', [{ name: 'title', label: 'New title', value: doc.title, required: true }]);
    if (!result) return;
    await api(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: result.title }),
    });
    toast('Title updated');
    loadDocs();
    selectDoc(doc.id);
  };
  preview.querySelector('[data-matter-select]').onchange = async (event) => {
    await api(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matter_id: event.target.value || null }),
    });
    toast('Case updated');
    loadDocs();
    selectDoc(doc.id);
  };
  preview.querySelector('[data-delete]').onclick = async () => {
    if (!(await confirmDialog('Delete this document?', `${doc.id} — ${doc.title}. The record and file are archived, not destroyed.`, 'Delete'))) return;
    await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    toast('Document archived');
    $('#preview').innerHTML = '<div class="empty-state"><span class="big">🗂</span><p>Deleted. Your other files are untouched.</p></div>';
    loadDocs();
    refreshOverview();
  };
  preview.querySelectorAll('[data-related]').forEach((link) => {
    link.onclick = (event) => { event.preventDefault(); selectDoc(link.dataset.related); };
  });
}

$('#upload-open').onclick = () => $('#lib-file').click();
$('#lib-file').onchange = async (event) => {
  const files = [...event.target.files];
  for (const file of files) {
    const form = new FormData();
    form.append('file', file);
    try {
      toast(`Reading ${file.name}…`);
      const data = await api('/api/upload', { method: 'POST', body: form });
      toast(`${data.document.id} filed · ${data.document.typeLabel}`);
    } catch (err) {
      toast(`Could not add ${file.name}: ${err.message}`);
    }
  }
  event.target.value = '';
  await refreshOverview();
  loadDocs();
};

/* ─────────────────────────── cases ─────────────────────────── */

async function loadCases() {
  const data = await api('/api/matters');
  state.matters = data.matters || [];
  fillMatterSelects();
  const body = $('#cases-body');
  if (!state.matters.length) {
    body.innerHTML = `<div class="empty-state"><span class="big">📁</span><p>No cases yet. Create one, then send documents — I file them by name automatically.</p></div>`;
    return;
  }
  body.innerHTML = state.matters.map((m) => `
    <div class="case-card" data-id="${m.id}">
      <div class="top">
        <h3>${escapeHtml(m.title)}</h3>
        <span class="pill green">${m.doc_count || 0} docs</span>
      </div>
      <div class="sub">
        ${m.client ? `Client: ${escapeHtml(m.client)}` : ''}
        ${m.opposite ? ` · Other side: ${escapeHtml(m.opposite)}` : ''}
        ${m.case_number ? ` · ${escapeHtml(m.case_number)}` : ''}
        ${m.court ? ` · ${escapeHtml(m.court)}` : ''}
      </div>
    </div>`).join('');
  $$('.case-card', body).forEach((card) => {
    card.onclick = () => openCase(card.dataset.id);
  });
}

async function openCase(id) {
  const data = await api(`/api/matters/${id}`);
  const body = $('#cases-body');
  const docs = data.documents || [];
  body.innerHTML = `<div class="case-detail">
      <div class="top" style="display:flex;justify-content:space-between;gap:12px;align-items:start">
        <div>
          <h2 style="margin:0">${escapeHtml(data.matter.title)}</h2>
          <p class="muted small">${escapeHtml([data.matter.client, data.matter.opposite, data.matter.case_number, data.matter.court].filter(Boolean).join(' · '))}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost small" data-back>← All cases</button>
          ${docs.length ? '<button class="btn primary small" data-bundle>Compile bundle</button>' : ''}
        </div>
      </div>
      ${docs.length ? `<div class="timeline">${docs.map((d) => `
        <div class="tl-item">
          <span class="muted small">${d.date ? fmtDate(d.date) : fmtDate(d.createdAt)}</span>
          <span><b>${escapeHtml(d.id)}</b> · ${escapeHtml(d.title)} <span class="muted small">${escapeHtml(d.typeLabel || '')}</span></span>
          <span>${d.fileUrl ? `<a class="small" href="${d.fileUrl}" target="_blank">open</a>` : ''}</span>
        </div>`).join('')}</div>` : '<p class="muted">No documents in this case yet.</p>'}
    </div>`;
  body.querySelector('[data-back]').onclick = loadCases;
  const bundleBtn = body.querySelector('[data-bundle]');
  if (bundleBtn) {
    bundleBtn.onclick = async () => {
      bundleBtn.disabled = true;
      bundleBtn.textContent = 'Compiling…';
      try {
        const result = await api('/api/bundle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ matterId: id }),
        });
        window.open(result.url, '_blank');
        toast(`Bundle ready — ${result.count} documents + index`);
      } catch (err) {
        toast(err.message);
      } finally {
        bundleBtn.disabled = false;
        bundleBtn.textContent = 'Compile bundle';
      }
    };
  }
}

$('#new-case').onclick = async () => {
  const result = await promptDialog('New case', [
    { name: 'title', label: 'Case name (e.g. Sharma v Mehta)', required: true },
    { name: 'client', label: 'Client name' },
    { name: 'opposite', label: 'Other side' },
    { name: 'case_number', label: 'Case number' },
    { name: 'court', label: 'Court' },
  ]);
  if (!result || !result.title) return;
  await api('/api/matters', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
  toast('Case created');
  loadCases();
  refreshOverview();
};

/* ─────────────────────────── dates ─────────────────────────── */

async function loadDeadlines() {
  const data = await api('/api/deadlines');
  const list = $('#deadlines-list');
  if (!list) return;
  const items = data.deadlines || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><span class="big">🗓</span><p>No dates yet. Add hearings and limitation dates so nothing slips.</p></div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  list.innerHTML = items.map((d) => {
    const diff = Math.round((new Date(`${d.due_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
    const cls = diff < 0 ? 'overdue' : diff <= 3 ? 'soon' : '';
    const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff > 1 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
    return `<div class="date-row ${cls}">
      <div class="bar"></div>
      <div>
        <div class="t">${escapeHtml(d.title)}</div>
        <div class="s">${fmtDate(d.due_date)} · ${when}${d.document_id ? ` · ${escapeHtml(d.document_id)}` : ''}</div>
      </div>
      <button class="btn small ghost" data-done="${d.id}">Done</button>
    </div>`;
  }).join('');
  $$('[data-done]', list).forEach((button) => {
    button.onclick = async () => {
      await api(`/api/deadlines/${button.dataset.done}/done`, { method: 'POST' });
      toast('Marked done');
      loadDeadlines();
    };
  });
}

$('#deadline-form').onsubmit = async (event) => {
  event.preventDefault();
  const body = {
    title: $('#dl-title').value.trim(),
    due_date: $('#dl-date').value,
    remind_days: Number($('#dl-remind').value || 3),
    matter_id: $('#dl-matter').value || null,
    detail: $('#dl-detail').value.trim() || null,
  };
  if (!body.title || !body.due_date) return;
  await api('/api/deadlines', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  event.target.reset();
  $('#dl-remind').value = 3;
  toast('Date saved');
  loadDeadlines();
  refreshOverview();
};

/* ─────────────────────────── draft ─────────────────────────── */

async function loadTemplates() {
  const data = await api('/api/templates');
  const select = $('#draft-template');
  if (!select) return;
  select.innerHTML = data.templates.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
}

$('#draft-go').onclick = async () => {
  const templateId = $('#draft-template').value;
  const instruction = $('#draft-instruction').value.trim();
  const out = $('#draft-out');
  out.innerHTML = '<p class="muted">Drafting…</p>';
  try {
    const data = await api('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId, instruction }),
    });
    out.innerHTML = `
      <h3>${escapeHtml(data.document.title)} <span class="pill green">${escapeHtml(data.document.id)}</span></h3>
      ${data.missing?.length ? `<p class="small warn">Fill in: ${escapeHtml(data.missing.join(', '))}</p>` : ''}
      <div class="doc-actions">
        ${data.docxUrl ? `<a class="btn primary small" href="${data.docxUrl}">Download Word</a>` : ''}
        ${data.document.fileUrl ? `<a class="btn ghost small" href="${data.document.fileUrl}" target="_blank">Open PDF</a>` : ''}
      </div>
      <div class="draft-preview">${escapeHtml(data.preview || '')}</div>
      <p class="small muted">Saved in your library as ${escapeHtml(data.document.id)}. Edit the Word file, then send it back to me to file the signed version.</p>`;
    refreshOverview();
  } catch (err) {
    out.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
};

/* ─────────────────────────── settings ─────────────────────────── */

function renderSettings() {
  const body = $('#settings-body');
  if (!body || !state.overview) return;
  const { stats, whatsapp, llm, ownerName } = state.overview;
  body.innerHTML = `
    <div class="card">
      <h3>📊 Library</h3>
      <div class="stat-line"><span>Documents</span><b>${stats.total}</b></div>
      <div class="stat-line"><span>Pages</span><b>${stats.pages || '—'}</b></div>
      <div class="stat-line"><span>Storage used</span><b>${(stats.bytes / 1024 / 1024).toFixed(1)} MB</b></div>
      <div class="stat-line"><span>Active cases</span><b>${stats.matters}</b></div>
      <div class="stat-line"><span>Needs a check</span><b>${stats.needsReview}</b></div>
      <div class="doc-actions" style="margin-top:12px">
        <a class="btn ghost small" href="/api/export/csv">Export list (CSV)</a>
        <a class="btn ghost small" href="/api/backup">Download backup</a>
      </div>
    </div>
    <div class="card">
      <h3>📱 WhatsApp</h3>
      <div class="stat-line"><span>Status</span><span class="${whatsapp ? 'ok' : 'warn'}">${whatsapp ? 'Connected' : 'Demo mode'}</span></div>
      <p class="small muted">${whatsapp
        ? 'Your bot is live on WhatsApp. Messages from your number are filed automatically.'
        : 'The chat tab works exactly like WhatsApp. To put this on your real WhatsApp number, follow the steps below.'}</p>
      ${whatsapp ? '' : `<ol class="setup-steps">
        <li>Create a free Meta developer app and add WhatsApp.</li>
        <li>Put the token and phone-number id in the <code>.env</code> file.</li>
        <li>Point the webhook to <code>https://your-server/webhook</code>.</li>
        <li>Add your own number as <code>OWNER_PHONE</code> so nobody else can open your files.</li>
      </ol>
      <p class="small muted">Full step-by-step instructions are in <code>README.md</code>.</p>`}
    </div>
    <div class="card">
      <h3>🤖 Reading quality</h3>
      <div class="stat-line"><span>AI upgrade</span><span class="${llm ? 'ok' : 'warn'}">${llm ? 'On' : 'Off (local analysis)'}</span></div>
      <p class="small muted">${llm
        ? 'An AI model is polishing summaries and reading photos.'
        : 'Everything still works: names, dates, amounts, parties, courts and document types are read on your own machine. Adding an AI key in <code>.env</code> improves summaries and photo reading.'}</p>
      <div class="stat-line"><span>Your name</span><b>${escapeHtml(ownerName || 'not set')}</b></div>
      <p class="small muted">Set <code>OWNER_NAME</code> in <code>.env</code> to sign drafts with your name.</p>
    </div>
    <div class="card">
      <h3>🔒 Privacy</h3>
      <p class="small">Every file, summary and search index lives in the <code>data/</code> folder on this machine. No document is sent anywhere unless you switch on the AI upgrade. WhatsApp messages are private between your number and this server.</p>
      <div class="doc-actions">
        <button class="btn ghost small" id="logout">Lock dashboard</button>
      </div>
    </div>`;
  const logout = $('#logout');
  if (logout) {
    logout.onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      location.reload();
    };
  }
}

/* ─────────────────────────── start ─────────────────────────── */

if (new URLSearchParams(location.search).get('token')) {
  const token = new URLSearchParams(location.search).get('token');
  api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(() => {
    history.replaceState({}, '', '/');
    enterApp();
  }).catch(showGate);
} else {
  boot();
}
