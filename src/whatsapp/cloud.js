/**
 * WhatsApp Cloud API client (official Meta API).
 * Works with a phone number ID + permanent token from developers.facebook.com.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../util/logger.js';

const BASE = () => `https://graph.facebook.com/${config.whatsapp.apiVersion}`;

function authorised() {
  return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
}

async function graphFetch(url, options = {}, attempt = 1) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (attempt < 3 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return graphFetch(url, options, attempt + 1);
    }
    throw new Error(`WhatsApp API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function postMessage(payload) {
  if (!authorised()) {
    log.debug('WhatsApp not configured — message not sent:', JSON.stringify(payload).slice(0, 200));
    return null;
  }
  return graphFetch(`${BASE()}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.whatsapp.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
}

export async function sendText(to, body, { previewUrl = false } = {}) {
  const chunks = splitMessage(body);
  let last = null;
  for (const chunk of chunks) {
    last = await postMessage({
      to,
      type: 'text',
      text: { body: chunk, preview_url: previewUrl },
    });
  }
  return last;
}

function splitMessage(body, max = 3900) {
  const text = String(body || '').trim();
  if (text.length <= max) return [text];
  const out = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + line).length > max) {
      if (current.trim()) out.push(current.trim());
      current = '';
    }
    current += `${line}\n`;
  }
  if (current.trim()) out.push(current.trim());
  return out.length ? out : [text.slice(0, max)];
}

async function uploadMedia(filePath, mime) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime || 'application/octet-stream');
  form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), path.basename(filePath));
  const res = await fetch(`${BASE()}/${config.whatsapp.phoneNumberId}/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.whatsapp.token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Media upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.id;
}

export async function sendDocument(to, { path: filePath, filename, caption, mime }) {
  if (!authorised()) {
    log.debug('WhatsApp not configured — document not sent:', filename);
    return null;
  }
  const stat = await fs.stat(filePath);
  if (stat.size > 95 * 1024 * 1024) {
    await sendText(to, `⚠️ ${filename} is too large for WhatsApp (over 100 MB). It is safe in your library — open it from the dashboard.`);
    return null;
  }
  const mediaId = await uploadMedia(filePath, mime);
  return postMessage({
    to,
    type: 'document',
    document: {
      id: mediaId,
      filename: filename || path.basename(filePath),
      caption: (caption || '').slice(0, 1000),
    },
  });
}

export async function sendImage(to, { path: filePath, caption, mime = 'image/jpeg' }) {
  if (!authorised()) return null;
  const mediaId = await uploadMedia(filePath, mime);
  return postMessage({ to, type: 'image', image: { id: mediaId, caption: (caption || '').slice(0, 1000) } });
}

export async function markRead(messageId) {
  if (!authorised() || !messageId) return null;
  try {
    return await postMessage({ status: 'read', message_id: messageId });
  } catch (err) {
    log.debug('markRead failed:', err.message);
    return null;
  }
}

/** Template message — needed for reminders when the 24-hour window has closed. */
export async function sendTemplate(to, { name, language = 'en', params = [] }) {
  return postMessage({
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      components: params.length
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
        : undefined,
    },
  });
}

export async function downloadMedia(mediaId) {
  if (!authorised()) throw new Error('WhatsApp is not configured');
  const meta = await graphFetch(`${BASE()}/${mediaId}`, {
    headers: { authorization: `Bearer ${config.whatsapp.token}` },
  });
  const res = await fetch(meta.url, {
    headers: { authorization: `Bearer ${config.whatsapp.token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Media download failed ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Build the sender function used by the bot for one recipient. */
export function makeSender(to) {
  return async (payload) => {
    if (!payload) return null;
    if (payload.text) return sendText(to, payload.text);
    if (payload.document) return sendDocument(to, payload.document);
    if (payload.image) return sendImage(to, payload.image);
    return null;
  };
}

export { authorised as whatsappAuthorised };
