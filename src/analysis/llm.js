/**
 * Optional AI upgrade. The product works completely without this file's services.
 * Supports OpenAI, Anthropic, OpenRouter and local Ollama.
 */
import { config, llmConfigured } from '../config.js';
import { log } from '../util/logger.js';

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 45000);

function endpoint() {
  const { provider, baseUrl, model } = config.llm;
  if (baseUrl) return { url: baseUrl.replace(/\/$/, ''), model: model || 'default' };
  switch (provider) {
    case 'openai': return { url: 'https://api.openai.com/v1/chat/completions', model: model || 'gpt-4o-mini' };
    case 'openrouter': return { url: 'https://openrouter.ai/api/v1/chat/completions', model: model || 'openai/gpt-4o-mini' };
    case 'ollama': return { url: 'http://127.0.0.1:11434/api/chat', model: model || 'llama3.1' };
    default: return { url: '', model: '' };
  }
}

async function callOpenAiCompatible({ system, user, maxTokens = 800, json = false }) {
  const { url, model } = endpoint();
  if (!url) throw new Error('No LLM endpoint configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(config.llm.apiKey ? { authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic({ system, user, maxTokens = 800 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.llm.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.llm.model || 'claude-3-5-haiku-latest',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.content || []).map((c) => c.text || '').join('').trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function complete({ system, user, maxTokens = 800, json = false }) {
  if (!llmConfigured()) return null;
  try {
    if (config.llm.provider === 'anthropic') {
      return await callAnthropic({ system, user, maxTokens });
    }
    return await callOpenAiCompatible({ system, user, maxTokens, json });
  } catch (err) {
    log.warn('LLM call failed, using local analysis instead:', err.message);
    return null;
  }
}

/** Better summary + key points. Returns null when unavailable. */
export async function llmEnrichDocument({ text, filename, base }) {
  if (!llmConfigured() || !text || text.length < 120) return null;
  const excerpt = text.slice(0, 12000);
  const raw = await complete({
    system:
      'You are a senior Indian advocate\'s document clerk. You read legal and business documents and report facts precisely. ' +
      'Never invent names, dates or amounts. Reply with JSON only.',
    user:
      `Document: ${filename}\nLocal first-pass guess: ${base.typeLabel}, date ${base.docDate || 'unknown'}.\n\n` +
      `Return JSON with keys:\n` +
      `"title" (max 80 chars, e.g. "Rent Agreement — Sharma v Mehta"),\n` +
      `"docType" (one of: rent_agreement, sale_deed, agreement_to_sell, gift_deed, mortgage_deed, partition_deed, power_of_attorney, will, legal_notice, cheque_bounce_notice, plaint, written_statement, petition, complaint, fir, court_order, affidavit, vakalatnama, noc, agreement, nda, partnership_deed, company_document, employment_contract, settlement, arbitration, bank_statement, invoice, receipt, it_return, land_record, encumbrance, identity_proof, certificate, education, medical, valuation, notice_reply, draft, other),\n` +
      `"docDate" (YYYY-MM-DD or null),\n` +
      `"parties" (array of {"name","role"}),\n` +
      `"summary" (2-3 plain-English sentences, max 400 chars),\n` +
      `"keyPoints" (array of up to 5 short factual strings),\n` +
      `"amounts" (array of {"raw","label"}),\n` +
      `"court" (string or null),\n` +
      `"caseNumber" (string or null),\n` +
      `"tags" (array of up to 8 short lowercase tags),\n` +
      `"risks" (array of up to 3 things a lawyer should check).\n\n` +
      `--- DOCUMENT TEXT ---\n${excerpt}`,
    maxTokens: 1000,
    json: true,
  });
  if (!raw) return null;
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
}

/** Answer a question from a document's own text, with citations. */
export async function llmAnswerQuestion({ question, docs }) {
  if (!llmConfigured() || !docs.length) return null;
  const corpus = docs
    .slice(0, 4)
    .map((d) => `### ${d.id} — ${d.title}\n${String(d.text || '').slice(0, 6000)}`)
    .join('\n\n');
  const raw = await complete({
    system:
      'You are an Indian lawyer\'s document assistant. Answer ONLY from the supplied documents. ' +
      'If the answer is not present, say so plainly. Quote the clause or line you rely on and name the document id. ' +
      'Keep it to 120 words, plain English. This is a working note, not legal advice.',
    user: `Question: ${question}\n\nDocuments:\n${corpus}`,
    maxTokens: 500,
  });
  return raw || null;
}

/** Read a photo of a document (needs a vision-capable model). */
export async function llmVisionExtract({ base64, mime = 'image/jpeg', hint = '' }) {
  if (!llmConfigured()) return null;
  const { provider, apiKey, model, baseUrl } = config.llm;
  const isOpenAiLike = provider === 'openai' || provider === 'openrouter' || Boolean(baseUrl);
  if (!isOpenAiLike) return null;
  const url = baseUrl ? baseUrl.replace(/\/$/, '') : provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Transcribe all visible text from this document image, preserving lines. If a question is asked, answer it too. ${hint}` },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    log.warn('Vision call failed:', err.message);
    return null;
  }
}

function extractJson(raw) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}
