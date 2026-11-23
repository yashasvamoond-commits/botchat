import crypto from 'node:crypto';
import express from 'express';
import { config, isOwner } from '../config.js';
import { log } from '../util/logger.js';
import { handleText, handleMedia } from '../bot/handlers.js';
import { downloadMedia, makeSender, markRead } from './cloud.js';
import { logMessage, seenWaId } from '../store/repo.js';

export const webhookRouter = express.Router();

function verifySignature(req) {
  if (!config.whatsapp.appSecret) return true; // signature check optional until the secret is set
  const signature = req.get('x-hub-signature-256') || '';
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex')}`;
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

webhookRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    log.info('WhatsApp webhook verified by Meta');
    return res.status(200).send(String(challenge || ''));
  }
  log.warn('WhatsApp webhook verification failed (check WHATSAPP_VERIFY_TOKEN)');
  return res.sendStatus(403);
});

webhookRouter.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) {
    log.warn('Rejected a webhook call with a bad signature');
    return res.sendStatus(401);
  }
  // Acknowledge immediately — Meta retries when responses are slow.
  res.sendStatus(200);
  try {
    await processWebhook(req.body || {});
  } catch (err) {
    log.error('webhook processing failed:', err.stack || err.message);
  }
});

async function processWebhook(body) {
  const entries = body.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const name = contacts[0]?.profile?.name || '';
      for (const message of value.messages || []) {
        await handleOne(message, name).catch((err) => log.error('message failed:', err.message));
      }
    }
  }
}

async function handleOne(message, profileName) {
  const from = String(message.from || '');
  if (!from) return;
  if (seenWaId(message.id)) {
    log.debug('duplicate webhook message ignored', message.id);
    return;
  }

  const send = makeSender(from);
  const kind = message.type;
  const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';

  logMessage({
    owner: from,
    direction: 'in',
    waId: message.id,
    kind,
    body: text || message.document?.filename || message.image?.caption || `[${kind}]`,
    meta: message,
  });

  if (!isOwner(from)) {
    log.warn(`blocked message from unauthorised number ${from}`);
    await send({ text: 'This is a private document assistant. This number is not authorised to use it.' });
    return;
  }

  await markRead(message.id);

  if (kind === 'text' || message.button || message.interactive) {
    await handleText({ owner: from, text, send, phoneName: profileName });
    logMessage({ owner: from, direction: 'out', kind: 'text', body: text });
    return;
  }

  if (kind === 'document') {
    await handleMedia({
      owner: from,
      message: {
        type: 'document',
        filename: message.document?.filename || 'document',
        mime: message.document?.mime_type || 'application/octet-stream',
        caption: message.document?.caption || '',
        mediaId: message.document?.id,
      },
      send,
      downloadMedia: () => downloadMedia(message.document.id),
      phoneName: profileName,
    });
    return;
  }

  if (kind === 'image') {
    await handleMedia({
      owner: from,
      message: {
        type: 'image',
        filename: `photo-${message.id}.jpg`,
        mime: message.image?.mime_type || 'image/jpeg',
        caption: message.image?.caption || '',
        mediaId: message.image?.id,
      },
      send,
      downloadMedia: () => downloadMedia(message.image.id),
      phoneName: profileName,
    });
    return;
  }

  if (kind === 'audio' || kind === 'voice') {
    await send({
      text: 'I can read documents, not voice notes yet. Please type your question, or send the paper as a PDF, Word file or photo.',
    });
    return;
  }

  if (kind === 'video') {
    await send({ text: 'I cannot read video. Send the document as a PDF, Word file or photo instead.' });
    return;
  }

  if (kind === 'location') {
    await send({ text: 'Received your location. Send the document itself and I will file it.' });
    return;
  }

  await send({ text: 'I can handle documents, photos and text messages. Send me a paper and I will file it.' });
}
