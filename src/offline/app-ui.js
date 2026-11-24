/* Offline UI — plain browser script, no modules, no network.
 * ENGINE (bundled analysis code) is already defined when this runs. */
(function () {
  'use strict';

  var KEY = 'xdm.offline.v1';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ── storage ─────────────────────────────────────────────────── */

  var memoryOnly = false;
  var store = null;

  function loadStore() {
    if (store) return store;
    try {
      var raw = window.localStorage.getItem(KEY);
      store = raw ? JSON.parse(raw) : { version: 1, docs: [], cases: [] };
    } catch (err) {
      memoryOnly = true;
      store = { version: 1, docs: [], cases: [] };
    }
    if (!Array.isArray(store.docs)) store.docs = [];
    if (!Array.isArray(store.cases)) store.cases = [];
    return store;
  }

  function renderStorageNote() {
    var note = $('#storage-note');
    if (note) note.textContent = memoryOnly ? t('toast.full') : '';
  }

  function saveStore() {
    if (memoryOnly) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(store));
      return true;
    } catch (err) {
      memoryOnly = true;
      renderStorageNote();
      toast(t('toast.full'));
      return false;
    }
  }

  /* ── language ────────────────────────────────────────────────── */

  var DICT = {
    en: {
      'top.sub': 'Offline edition — works without a server',
      'tab.docs': 'Documents', 'tab.courts': 'eCourts', 'tab.more': 'Backup & help',
      'add.title': 'Add a paper',
      'add.note': 'Paste the text of a rent agreement, notice, order, affidavit — English, हिंदी or اردو. It is read on this phone; nothing is uploaded.',
      'add.ph': 'Paste the text here…', 'add.file': 'Choose a .txt file',
      'add.name': 'File name (optional)', 'add.save': 'Read and save',
      'search.ph': 'Ask: rent agreement Sharma, notices last month, पिछले महीने के नोटिस',
      'search.go': 'Ask',
      'ec.title': 'eCourts memory',
      'ec.note': 'Paste or choose the eCourts Case Status text once. Every CNR, court, stage and next hearing date is kept on this phone for good.',
      'ec.ph': 'Paste the eCourts case status text here…', 'ec.file': 'Choose a .txt file',
      'ec.save': 'Remember these cases', 'ec.search': 'CNR number, party name, or “next hearing”',
      'backup.title': 'Backup',
      'backup.note': 'Everything on this phone, in one file you can keep or move to another device.',
      'backup.export': 'Download backup', 'backup.import': 'Restore from backup',
      'backup.wipe': 'Delete everything on this phone',
      'help.title': 'What this can do',
      'help.one': 'Read English, Hindi and Urdu papers: type, date, parties with roles, amounts, court, case numbers and sections.',
      'help.two': 'Search in any of the three languages — by party, type, month or year.',
      'help.three': 'Keep eCourts case status text forever: ecourts, next hearing, or a CNR number.',
      'help.four': 'No server, no account, no upload. PDF and Word files need the hosted version — here paste the text or send a .txt.',
      'help.ios': 'Tip: in Safari tap Share → Add to Home Screen to keep it as an app.',
      'foot.line': 'Runs entirely on this device.',
      'doc.delete': 'Delete this paper',
      'toast.saved': 'Read and saved', 'toast.full': 'This phone’s storage is full — export a backup, then delete old papers.',
      'toast.deleted': 'Deleted', 'toast.restored': 'Backup restored', 'toast.copied': 'Copied',
      'empty.docs': 'Nothing here yet. Paste a paper above to begin.',
      'empty.cases': 'No eCourts data yet. Paste the case status text above.',
      'ask.help': 'Try: rent agreement Sharma · notices last month · D1 · ecourts · next hearing · stats',
    },
    hi: {
      'top.sub': 'ऑफ़लाइन संस्करण — सर्वर की ज़रूरत नहीं',
      'tab.docs': 'दस्तावेज़', 'tab.courts': 'ई-कोर्ट', 'tab.more': 'बैकअप और मदद',
      'add.title': 'दस्तावेज़ जोड़ें',
      'add.note': 'किराया अनुबंध, नोटिस, आदेश, शपथ पत्र का पाठ चिपकाएँ — अंग्रेज़ी, हिंदी या उर्दू। पढ़ा इसी फ़ोन पर जाता है, कहीं अपलोड नहीं होता।',
      'add.ph': 'यहाँ पाठ चिपकाएँ…', 'add.file': '.txt फ़ाइल चुनें',
      'add.name': 'फ़ाइल का नाम (वैकल्पिक)', 'add.save': 'पढ़ें और सहेजें',
      'search.ph': 'पूछें: किराया अनुबंध शर्मा, पिछले महीने के नोटिस',
      'search.go': 'पूछें',
      'ec.title': 'ई-कोर्ट स्मृति',
      'ec.note': 'ई-कोर्ट केस स्टेटस का पाठ एक बार चिपकाएँ। हर CNR, न्यायालय, चरण और अगली सुनवाई की तारीख इसी फ़ोन पर हमेशा रहेगी।',
      'ec.ph': 'यहाँ ई-कोर्ट केस स्टेटस पाठ चिपकाएँ…', 'ec.file': '.txt फ़ाइल चुनें',
      'ec.save': 'इन केसों को याद रखें', 'ec.search': 'CNR संख्या, पक्षकार का नाम, या “अगली सुनवाई”',
      'backup.title': 'बैकअप',
      'backup.note': 'इस फ़ोन का सारा डेटा एक फ़ाइल में — रखें या दूसरे फ़ोन पर ले जाएँ।',
      'backup.export': 'बैकअप डाउनलोड करें', 'backup.import': 'बैकअप से बहाल करें',
      'backup.wipe': 'इस फ़ोन का सारा डेटा मिटाएँ',
      'help.title': 'यह क्या कर सकता है',
      'help.one': 'अंग्रेज़ी, हिंदी, उर्दू दस्तावेज़ पढ़ें: प्रकार, दिनांक, पक्षकार व भूमिका, राशि, न्यायालय, वाद संख्या और धाराएँ।',
      'help.two': 'तीनों भाषाओं में खोजें — पक्षकार, प्रकार, महीना या वर्ष से।',
      'help.three': 'ई-कोर्ट केस स्टेटस हमेशा के लिए रखें: ecourts, next hearing, या CNR संख्या।',
      'help.four': 'कोई सर्वर, खाता या अपलोड नहीं। PDF और Word के लिए होस्टेड संस्करण चाहिए — यहाँ पाठ चिपकाएँ या .txt दें।',
      'help.ios': 'सुझाव: Safari में Share → Add to Home Screen से इसे ऐप की तरह रखें।',
      'foot.line': 'पूरी तरह इसी डिवाइस पर चलता है।',
      'doc.delete': 'यह दस्तावेज़ हटाएँ',
      'toast.saved': 'पढ़ा और सहेजा गया', 'toast.full': 'फ़ोन की जगह भर गई — बैकअप लें, फिर पुराने दस्तावेज़ हटाएँ।',
      'toast.deleted': 'हटा दिया', 'toast.restored': 'बैकअप बहाल हुआ', 'toast.copied': 'कॉपी हो गया',
      'empty.docs': 'अभी कुछ नहीं है। ऊपर पाठ चिपकाकर शुरू करें।',
      'empty.cases': 'अभी ई-कोर्ट डेटा नहीं है। ऊपर केस स्टेटस पाठ चिपकाएँ।',
      'ask.help': 'आज़माएँ: किराया अनुबंध शर्मा · पिछले महीने के नोटिस · ecourts · next hearing · stats',
    },
    ur: {
      'top.sub': 'آف لائن نسخہ — سرور کی ضرورت نہیں',
      'tab.docs': 'دستاویزات', 'tab.courts': 'ای-کورٹ', 'tab.more': 'بیک اپ اور مدد',
      'add.title': 'دستاویز شامل کریں',
      'add.note': 'کرایہ نامہ، نوٹس، حکم یا حلف نامے کا متن چسپاں کریں — انگریزی، ہندی یا اردو۔ پڑھائی اسی فون پر ہوتی ہے، کہیں اپ لوڈ نہیں ہوتا۔',
      'add.ph': 'یہاں متن چسپاں کریں…', 'add.file': '.txt فائل چنیں',
      'add.name': 'فائل کا نام (اختیاری)', 'add.save': 'پڑھیں اور محفوظ کریں',
      'search.ph': 'پوچھیں: کرایہ نامہ شرما، گزشتہ ماہ کے نوٹس',
      'search.go': 'پوچھیں',
      'ec.title': 'ای-کورٹ یادداشت',
      'ec.note': 'ای-کورٹ کیس اسٹیٹس کا متن ایک بار چسپاں کریں۔ ہر CNR، عدالت، مرحلہ اور اگلی سماعت کی تاریخ اسی فون پر محفوظ رہے گی۔',
      'ec.ph': 'یہاں ای-کورٹ کیس اسٹیٹس کا متن چسپاں کریں…', 'ec.file': '.txt فائل چنیں',
      'ec.save': 'یہ کیسز یاد رکھیں', 'ec.search': 'CNR نمبر، فریق کا نام، یا “اگلی سماعت”',
      'backup.title': 'بیک اپ',
      'backup.note': 'اس فون کا سارا ڈیٹا ایک فائل میں — رکھیں یا دوسرے فون پر لے جائیں۔',
      'backup.export': 'بیک اپ ڈاؤن لوڈ کریں', 'backup.import': 'بیک اپ سے بحال کریں',
      'backup.wipe': 'اس فون کا سارا ڈیٹا مٹا دیں',
      'help.title': 'یہ کیا کر سکتا ہے',
      'help.one': 'انگریزی، ہندی اور اردو دستاویزات پڑھیں: قسم، تاریخ، فریق اور کردار، رقوم، عدالت، مقدمہ نمبر اور دفعات۔',
      'help.two': 'تینوں زبانوں میں تلاش کریں — فریق، قسم، مہینہ یا سال سے۔',
      'help.three': 'ای-کورٹ کیس اسٹیٹس ہمیشہ رکھیں: ecourts، next hearing، یا CNR نمبر۔',
      'help.four': 'کوئی سرور، اکاؤنٹ یا اپ لوڈ نہیں۔ PDF اور Word کے لیے ہوسٹڈ نسخہ درکار ہے — یہاں متن چسپاں کریں یا .txt دیں۔',
      'help.ios': 'مشورہ: Safari میں Share → Add to Home Screen سے اسے ایپ کی طرح رکھیں۔',
      'foot.line': 'مکمل طور پر اسی ڈیوائس پر چلتا ہے۔',
      'doc.delete': 'یہ دستاویز حذف کریں',
      'toast.saved': 'پڑھا اور محفوظ ہوا', 'toast.full': 'فون کی جگہ بھر گئی — بیک اپ لیں، پھر پرانی دستاویزات حذف کریں۔',
      'toast.deleted': 'حذف ہو گیا', 'toast.restored': 'بیک اپ بحال ہوا', 'toast.copied': 'کاپی ہو گیا',
      'empty.docs': 'ابھی کچھ نہیں۔ اوپر متن چسپاں کر کے شروع کریں۔',
      'empty.cases': 'ابھی ای-کورٹ ڈیٹا نہیں۔ اوپر کیس اسٹیٹس متن چسپاں کریں۔',
      'ask.help': 'آزمائیں: کرایہ نامہ شرما · گزشتہ ماہ کے نوٹس · ecourts · next hearing · stats',
    },
  };

  var lang = 'en';

  function t(key) {
    return (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
  }

  function applyLang(next) {
    lang = DICT[next] ? next : 'en';
    try { window.localStorage.setItem('xdm.offline.lang', lang); } catch (err) { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    $$('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (DICT[lang][key] || DICT.en[key]) el.innerHTML = t(key);
    });
    $$('[data-i18n-ph]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-ph');
      if (DICT[lang][key] || DICT.en[key]) el.setAttribute('placeholder', t(key));
    });
    $$('#lang button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === lang); });
    renderStats();
    renderList();
    renderCases();
  }

  /* ── helpers ─────────────────────────────────────────────────── */

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(message) {
    var el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  function money(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    return '₹ ' + value.toLocaleString('en-IN');
  }

  function dateLabel(iso, long) {
    if (!iso) return '';
    try { return ENGINE.formatDate(iso, { long: !!long }); } catch (err) { return iso; }
  }

  function daysUntil(iso) {
    if (!iso) return null;
    try { return -ENGINE.daysBetween(ENGINE.toIso(new Date()), iso); } catch (err) { return null; }
  }

  function nextId(list, prefix) {
    var max = 0;
    list.forEach(function (item) {
      var m = new RegExp('^' + prefix + '(\\d+)$').exec(item.id || '');
      if (m) max = Math.max(max, Number(m[1]));
    });
    return prefix + (max + 1);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  function readFileText(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '').replace(/^\uFEFF/, '');
      cb(text);
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ── analysis ────────────────────────────────────────────────── */

  function analyse(text, filename) {
    var source = String(text || '').trim();
    if (!source) return null;
    return ENGINE.analyzeDocument({ text: source, filename: filename || 'pasted text' });
  }

  function docRecord(result, filename, rawText) {
    var s = loadStore();
    var doc = {
      id: nextId(s.docs, 'D'),
      created_at: new Date().toISOString(),
      filename: filename || '',
      title: result.title,
      doc_type: result.docType,
      type_label: result.typeLabel,
      doc_date: result.docDate || null,
      language: result.language || 'en',
      parties: result.parties || [],
      amounts: result.amounts || [],
      court: result.court || null,
      case_number: result.caseNumber || null,
      statutes: result.statutes || [],
      clauses: result.clauses || [],
      key_points: result.keyPoints || [],
      summary: result.summary || '',
      tags: result.tags || [],
      text: String(rawText || '').slice(0, 150000),
    };
    return doc;
  }

  /** Create the record and file it in one step, so ids never collide. */
  function saveDoc(result, filename, rawText) {
    var s = loadStore();
    var doc = docRecord(result, filename, rawText);
    doc.id = nextId(s.docs, 'D');
    s.docs.push(doc);
    saveStore();
    return doc;
  }

  function searchDocs(query) {
    var s = loadStore();
    var plan;
    try { plan = ENGINE.parseQuery(query, { matters: [] }); } catch (err) { plan = { terms: ENGINE.queryTokens(query), typeIds: [], dateRange: null }; }
    if (plan.docId) {
      var direct = s.docs.filter(function (d) { return d.id === plan.docId; });
      if (direct.length) return { docs: direct, plan: plan };
    }
    var terms = (plan.terms && plan.terms.length ? plan.terms : ENGINE.queryTokens(query)).map(function (w) {
      return ENGINE.normalize(w);
    }).filter(Boolean);

    var scored = s.docs.map(function (doc) {
      var hay = ENGINE.normalize([
        doc.title, doc.type_label, doc.filename, doc.court, doc.case_number,
        (doc.parties || []).map(function (p) { return p.name + ' ' + (p.role || ''); }).join(' '),
        doc.summary, (doc.tags || []).join(' '), doc.text,
      ].join(' '));
      var score = 0;
      terms.forEach(function (term) {
        if (term.length < 2) return;
        if (hay.indexOf(term) >= 0) score += 2;
        else if (hay.indexOf(term.slice(0, Math.max(3, term.length - 2))) >= 0) score += 0.8;
      });
      if (plan.typeIds && plan.typeIds.length && plan.typeIds.indexOf(doc.doc_type) >= 0) score += 3;
      if (!terms.length && !(plan.typeIds || []).length) score += 0.5;
      return { doc: doc, score: score };
    }).filter(function (row) { return row.score > 0; });

    scored.sort(function (a, b) { return b.score - a.score || String(b.doc.created_at).localeCompare(String(a.doc.created_at)); });
    var docs = scored.map(function (r) { return r.doc; });
    if (plan.dateRange) {
      var inRange = docs.filter(function (d) { return d.doc_date && d.doc_date >= plan.dateRange.from && d.doc_date <= plan.dateRange.to; });
      if (inRange.length) docs = inRange;
    }
    if (plan.typeIds && plan.typeIds.length && docs.length) {
      var typed = docs.filter(function (d) { return plan.typeIds.indexOf(d.doc_type) >= 0; });
      if (typed.length) docs = typed.concat(docs.filter(function (d) { return typed.indexOf(d) < 0; }));
    }
    return { docs: docs.slice(0, 40), plan: plan };
  }

  /* ── rendering ───────────────────────────────────────────────── */

  function renderStats() {
    var s = loadStore();
    var upcoming = s.cases.filter(function (c) { return c.next_hearing; }).length;
    var html = ''
      + '<span class="pill"><b>' + s.docs.length + '</b> ' + esc(lang === 'en' ? 'papers' : lang === 'hi' ? 'दस्तावेज़' : 'دستاویزات') + '</span>'
      + '<span class="pill"><b>' + s.cases.length + '</b> ' + esc(lang === 'en' ? 'eCourts cases' : lang === 'hi' ? 'ई-कोर्ट केस' : 'ای-کورٹ کیسز') + '</span>'
      + (upcoming ? '<span class="pill"><b>' + upcoming + '</b> ' + esc(lang === 'en' ? 'with dates' : lang === 'hi' ? 'तारीखों सहित' : 'تاریخوں کے ساتھ') + '</span>' : '');
    $('#stats').innerHTML = html;
    $('#storage-note').textContent = memoryOnly ? t('toast.full') : '';
  }

  function chips(doc) {
    var out = '';
    if (doc.type_label) out += '<span class="chip">' + esc(doc.type_label) + '</span>';
    if (doc.doc_date) out += '<span class="chip muted">' + esc(dateLabel(doc.doc_date)) + '</span>';
    if (doc.language && doc.language !== 'en') out += '<span class="chip warn">' + esc(doc.language === 'hi' ? 'हिंदी' : doc.language === 'ur' ? 'اردو' : 'mixed') + '</span>';
    return out ? '<div class="chips">' + out + '</div>' : '';
  }

  function renderList() {
    var box = $('#results');
    if (!box) return;
    var s = loadStore();
    var docs = s.docs.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    if (!docs.length) { box.innerHTML = '<p class="muted small">' + esc(t('empty.docs')) + '</p>'; return; }
    box.innerHTML = docs.slice(0, 60).map(function (d) {
      return '<div class="item" data-open="' + esc(d.id) + '">'
        + '<b>' + esc(d.id) + ' · ' + esc(d.title) + '</b>'
        + '<small>' + esc([dateLabel(d.doc_date), d.type_label, (d.parties || [])[0] ? d.parties[0].name : ''].filter(Boolean).join(' · ')) + '</small>'
        + '</div>';
    }).join('');
    $$('#results .item').forEach(function (el) {
      el.addEventListener('click', function () { showDoc(el.getAttribute('data-open')); });
    });
  }

  function renderResults(docs, plan) {
    var box = $('#results');
    var answer = $('#answer');
    if (!docs.length) {
      box.innerHTML = '<p class="muted small">' + esc(lang === 'en' ? 'Nothing matched.' : lang === 'hi' ? 'कुछ नहीं मिला।' : 'کچھ نہیں ملا۔') + '</p>';
      return;
    }
    answer.textContent = (lang === 'en' ? docs.length + ' match' + (docs.length > 1 ? 'es' : '') : lang === 'hi' ? docs.length + ' परिणाम' : docs.length + ' نتائج')
      + (plan && plan.dateRange ? ' · ' + plan.dateRange.from + ' → ' + plan.dateRange.to : '');
    box.innerHTML = docs.map(function (d) {
      return '<div class="item" data-open="' + esc(d.id) + '">'
        + '<b>' + esc(d.id) + ' · ' + esc(d.title) + '</b>'
        + '<small>' + esc([dateLabel(d.doc_date), d.type_label].filter(Boolean).join(' · ')) + '</small>'
        + '</div>';
    }).join('');
    $$('#results .item').forEach(function (el) {
      el.addEventListener('click', function () { showDoc(el.getAttribute('data-open')); });
    });
  }

  function showDoc(id) {
    var s = loadStore();
    var doc = s.docs.filter(function (d) { return d.id === id; })[0];
    var box = $('#card');
    if (!doc) { box.classList.add('hidden'); return; }
    var facts = '';
    if (doc.doc_date) facts += '<dt>' + esc(lang === 'en' ? 'Date' : lang === 'hi' ? 'दिनांक' : 'تاریخ') + '</dt><dd>' + esc(dateLabel(doc.doc_date, true)) + '</dd>';
    if (doc.court) facts += '<dt>Court</dt><dd>' + esc(doc.court) + '</dd>';
    if (doc.case_number) facts += '<dt>Case</dt><dd>' + esc(doc.case_number) + '</dd>';
    if (doc.filename) facts += '<dt>File</dt><dd>' + esc(doc.filename) + '</dd>';
    if (doc.language) facts += '<dt>Language</dt><dd>' + esc(doc.language) + '</dd>';

    var parties = (doc.parties || []).map(function (p) {
      return '<div>' + esc(p.name) + (p.role ? ' — <span class="chip">' + esc(p.role) + '</span>' : '') + '</div>';
    }).join('');

    var amounts = (doc.amounts || []).map(function (a) {
      return '<div><span>' + esc(a.label || 'Amount') + '</span><b>' + esc(money(a.value)) + '</b></div>';
    }).join('');

    var statutes = (doc.statutes || []).map(function (st) {
      return '<span class="chip muted">' + esc([st.section, st.act].filter(Boolean).join(' · ')) + '</span>';
    }).join(' ');

    var clauses = (doc.clauses || []).slice(0, 8).map(function (c) {
      return '<div class="clause"><b>' + esc(c.label || c.heading || 'clause') + '</b>' + esc(c.text) + '</div>';
    }).join('');

    var keys = (doc.key_points || []).slice(0, 6).map(function (k) {
      return '<li>' + esc(k) + '</li>';
    }).join('');

    box.innerHTML = ''
      + '<div class="row" style="justify-content:space-between;align-items:flex-start">'
      + '<h2>' + esc(doc.title) + '</h2>'
      + '<button class="btn ghost" id="close-card">✕</button></div>'
      + chips(doc)
      + (facts ? '<dl class="facts">' + facts + '</dl>' : '')
      + (parties ? '<h3>' + esc(lang === 'en' ? 'Parties' : lang === 'hi' ? 'पक्षकार' : 'فریقین') + '</h3>' + parties : '')
      + (amounts ? '<h3>' + esc(lang === 'en' ? 'Amounts' : lang === 'hi' ? 'राशि' : 'رقوم') + '</h3><div class="amounts">' + amounts + '</div>' : '')
      + (statutes ? '<h3>Sections</h3><div class="chips">' + statutes + '</div>' : '')
      + (clauses ? '<h3>' + esc(lang === 'en' ? 'Clauses' : lang === 'hi' ? 'शर्तें' : 'شرائط') + '</h3>' + clauses : '')
      + (keys ? '<h3>' + esc(lang === 'en' ? 'Key points' : lang === 'hi' ? 'मुख्य बातें' : 'اہم نکات') + '</h3><ul class="help">' + keys + '</ul>' : '')
      + (doc.summary ? '<h3>Summary</h3><p class="small">' + esc(doc.summary) + '</p>' : '')
      + '<h3>Text</h3><pre class="raw">' + esc(doc.text || '') + '</pre>'
      + '<div class="row"><button class="btn" id="dl-txt">Download .txt</button>'
      + '<button class="btn ghost" id="dl-json">Download .json</button>'
      + '<button class="btn danger" id="del">' + esc(t('doc.delete')) + '</button></div>';
    box.classList.remove('hidden');

    $('#close-card').addEventListener('click', function () { box.classList.add('hidden'); });
    $('#dl-txt').addEventListener('click', function () {
      download((doc.id || 'document') + '.txt', doc.text || '', 'text/plain;charset=utf-8');
    });
    $('#dl-json').addEventListener('click', function () {
      download((doc.id || 'document') + '.json', JSON.stringify(doc, null, 2), 'application/json');
    });
    $('#del').addEventListener('click', function () {
      if (!window.confirm('Delete ' + doc.id + '?')) return;
      var s2 = loadStore();
      s2.docs = s2.docs.filter(function (d) { return d.id !== doc.id; });
      saveStore();
      box.classList.add('hidden');
      renderStats();
      renderList();
      toast(t('toast.deleted'));
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── eCourts ─────────────────────────────────────────────────── */

  function caseCard(c) {
    var bits = [];
    if (c.cnr) bits.push('CNR ' + c.cnr);
    if (c.case_number) bits.push('Case ' + c.case_number);
    if (c.court) bits.push(c.court);
    var lines = ['<b>' + esc(c.title || c.case_number || c.cnr) + '</b>'];
    if (bits.length) lines.push('<small>' + esc(bits.join(' · ')) + '</small>');
    var status = [c.status, c.stage ? 'stage: ' + c.stage : null].filter(Boolean).join(' · ');
    if (status) lines.push('<small>' + esc(status) + '</small>');
    if (c.next_hearing) {
      var days = daysUntil(c.next_hearing);
      var when = days === null ? '' : days === 0 ? '(today)' : days > 0 ? '(in ' + days + ' days)' : '(' + (-days) + ' days ago)';
      lines.push('<small>📅 Next hearing: <b>' + esc(dateLabel(c.next_hearing, true)) + '</b> ' + esc(when) + '</small>');
    }
    if (c.filing_date) lines.push('<small>Filed: ' + esc(dateLabel(c.filing_date, true)) + '</small>');
    if (c.acts) lines.push('<small>' + esc(c.acts) + '</small>');
    return '<div class="item">' + lines.join('') + '</div>';
  }

  function renderCases(filterText) {
    var box = $('#ec-list');
    if (!box) return;
    var s = loadStore();
    var cases = s.cases.slice();
    var needle = String(filterText || '').trim();
    if (needle) {
      var n = ENGINE.normalize(needle);
      cases = cases.filter(function (c) {
        return ENGINE.normalize([c.cnr, c.case_number, c.title, c.court, c.petitioner, c.respondent, c.status, c.stage, c.acts].filter(Boolean).join(' ')).indexOf(n) >= 0;
      });
    }
    cases.sort(function (a, b) {
      if (a.next_hearing && b.next_hearing) return a.next_hearing.localeCompare(b.next_hearing);
      if (a.next_hearing) return -1;
      if (b.next_hearing) return 1;
      return 0;
    });
    if (!cases.length) {
      box.innerHTML = '<p class="muted small">' + esc(needle ? 'Nothing matched.' : t('empty.cases')) + '</p>';
      return;
    }
    box.innerHTML = cases.slice(0, 40).map(caseCard).join('');
  }

  function saveCases(text) {
    var records = ENGINE.parseEcourtsText(text);
    if (!records.length) {
      $('#ec-hint').textContent = lang === 'en'
        ? 'No CNR or case number found in that text.'
        : lang === 'hi' ? 'उस पाठ में कोई CNR या वाद संख्या नहीं मिली।'
        : 'اس متن میں کوئی CNR یا مقدمہ نمبر نہیں ملا۔';
      return 0;
    }
    var s = loadStore();
    var added = 0;
    var updated = 0;
    records.forEach(function (r) {
      var key = r.cnr || ENGINE.normalize((r.case_number || '') + '|' + (r.title || ''));
      var existing = s.cases.filter(function (c) {
        return (c.cnr && c.cnr === r.cnr) || (!c.cnr && c.key === key);
      })[0];
      if (existing) {
        Object.keys(r).forEach(function (k) { existing[k] = r[k]; });
        existing.key = key;
        updated += 1;
      } else {
        r.key = key;
        r.id = nextId(s.cases, 'E');
        r.remembered_at = new Date().toISOString();
        s.cases.push(r);
        added += 1;
      }
    });
    saveStore();
    renderStats();
    renderCases('');
    $('#ec-hint').textContent = added + ' new · ' + updated + ' updated';
    toast((added ? added + ' remembered' : 'Updated ' + updated));
    return added + updated;
  }

  /* ── intents ─────────────────────────────────────────────────── */

  function answerQuery(text) {
    var q = String(text || '').trim();
    if (!q) return;
    var lower = q.toLowerCase();
    var s = loadStore();

    if (/^(?:help|commands|madad|मदद|مدد)\b/.test(lower)) {
      $('#results').innerHTML = '<p class="small">' + esc(t('ask.help')) + '</p>';
      return;
    }
    if (/^(?:stats?|library|how many|kitne|कितने|कुल)\b/.test(lower)) {
      renderList();
      $('#answer').textContent = s.docs.length + ' documents · ' + s.cases.length + ' eCourts cases';
      return;
    }
    if (/^(?:e-?courts?|case status|court status|कोर्ट स्टेटस|ای-کورٹ|کیس اسٹیٹس)\s*$/.test(lower)) {
      switchTab('courts');
      renderCases('');
      return;
    }
    if (/^(?:next hearing|upcoming hearings?|hearing dates?|अगली सुनवाई|اگلی سماعت)\s*$/.test(lower)) {
      switchTab('courts');
      renderCases('');
      return;
    }
    var cnr = /\b([A-Z]{2}[A-Z0-9]{2}\d{12,16})\b/i.exec(q);
    if (cnr) {
      switchTab('courts');
      renderCases(cnr[1]);
      return;
    }
    if (/^ecourts?\s+(.+)$/i.test(q)) {
      switchTab('courts');
      renderCases(q.replace(/^ecourts?\s+/i, ''));
      return;
    }
    var result = searchDocs(q);
    switchTab('docs');
    renderResults(result.docs, result.plan);
    if (result.docs.length === 1) showDoc(result.docs[0].id);
  }

  /* ── tabs / wiring ───────────────────────────────────────────── */

  function switchTab(name) {
    $$('.tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + name); });
  }

  function init() {
    try { var saved = window.localStorage.getItem('xdm.offline.lang'); if (saved) lang = saved; } catch (err) { /* ignore */ }

    $$('#lang button').forEach(function (btn) {
      btn.addEventListener('click', function () { applyLang(btn.getAttribute('data-lang')); });
    });
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });

    loadStore();
    applyLang(lang);
    renderStats();
    renderList();
    renderCases('');
    $('#version').textContent = 'v1.0';

    $('#file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      readFileText(file, function (text) {
        $('#paste').value = text.slice(0, 200000);
        $('#name').value = file.name;
        $('#add-hint').textContent = file.name + ' · ' + text.length.toLocaleString('en-IN') + ' characters';
      });
      event.target.value = '';
    });

    $('#save').addEventListener('click', function () {
      var text = $('#paste').value;
      var name = $('#name').value.trim();
      var result = analyse(text, name || 'pasted text');
      if (!result) { toast(lang === 'en' ? 'Paste some text first' : lang === 'hi' ? 'पहले पाठ चिपकाएँ' : 'پہلے متن چسپاں کریں'); return; }
      var doc = saveDoc(result, name, text);
      $('#paste').value = '';
      $('#name').value = '';
      $('#add-hint').textContent = '';
      renderStats();
      renderList();
      showDoc(doc.id);
      toast(doc.id + ' · ' + t('toast.saved'));
    });

    $('#ask').addEventListener('click', function () { answerQuery($('#q').value); });
    $('#q').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); answerQuery($('#q').value); }
    });

    $('#ec-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      readFileText(file, function (text) {
        $('#ec-paste').value = text.slice(0, 400000);
        $('#ec-hint').textContent = file.name + ' · ' + text.length.toLocaleString('en-IN') + ' characters';
      });
      event.target.value = '';
    });

    $('#ec-save').addEventListener('click', function () {
      var text = $('#ec-paste').value;
      if (!String(text).trim()) { toast(lang === 'en' ? 'Paste the eCourts text first' : 'पहले ई-कोर्ट पाठ चिपकाएँ'); return; }
      saveCases(text);
      $('#ec-paste').value = '';
    });

    $('#ec-go').addEventListener('click', function () {
      var value = $('#ec-q').value.trim();
      if (/^(?:next hearing|अगली सुनवाई|اگلی سماعت)$/i.test(value)) {
        var s = loadStore();
        var today = ENGINE.toIso(new Date());
        var upcoming = s.cases.filter(function (c) { return c.next_hearing && c.next_hearing >= today; })
          .sort(function (a, b) { return a.next_hearing.localeCompare(b.next_hearing); });
        $('#ec-list').innerHTML = upcoming.length ? upcoming.map(caseCard).join('') : '<p class="muted small">No upcoming hearings.</p>';
        return;
      }
      renderCases(value);
    });
    $('#ec-q').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); $('#ec-go').click(); }
    });

    $('#export').addEventListener('click', function () {
      var s = loadStore();
      var stamp = new Date().toISOString().slice(0, 10);
      download('xdm-backup-' + stamp + '.json', JSON.stringify(s, null, 2), 'application/json');
    });

    $('#import').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      readFileText(file, function (text) {
        try {
          var parsed = JSON.parse(text);
          if (!Array.isArray(parsed.docs) || !Array.isArray(parsed.cases)) throw new Error('bad file');
          store = { version: 1, docs: parsed.docs, cases: parsed.cases };
          saveStore();
          renderStats();
          renderList();
          renderCases('');
          toast(t('toast.restored'));
        } catch (err) {
          toast('That file is not an X Document Manager backup');
        }
      });
      event.target.value = '';
    });

    $('#wipe').addEventListener('click', function () {
      if (!window.confirm('Delete every document and eCourts case on this phone?')) return;
      store = { version: 1, docs: [], cases: [] };
      saveStore();
      $('#card').classList.add('hidden');
      renderStats();
      renderList();
      renderCases('');
    });

    if (memoryOnly) {
      var banner = document.createElement('div');
      banner.className = 'warnbox';
      banner.textContent = t('toast.full');
      $('#pane-docs').prepend(banner);
    }
  }

  // Small hook so the build can be smoke-tested without a browser.
  window.__XDM = {
    analyse: analyse,
    docRecord: docRecord,
    saveDoc: saveDoc,
    searchDocs: searchDocs,
    saveCases: saveCases,
    loadStore: loadStore,
    saveStore: saveStore,
    answerQuery: answerQuery,
    render: function () { renderStats(); renderList(); renderCases(''); },
    lang: function (next) { applyLang(next); },
    memoryOnly: function () { return memoryOnly; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
