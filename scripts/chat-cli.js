#!/usr/bin/env node
/**
 * Talk to X Document Manager from the terminal — the same brain as WhatsApp.
 *
 *   npm run sim
 *
 * Handy before you connect WhatsApp: you can send commands, upload files with
 * `upload <path>` and see exactly what the bot would have replied.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { handleText } from '../src/bot/handlers.js';
import { ingestFile } from '../src/ingest/pipeline.js';
import { docCard } from '../src/bot/formatters.js';
import { getMatter, stats } from '../src/store/repo.js';
import { config } from '../src/config.js';

const OWNER = config.ownerPhone || 'local';

const send = async (payload) => {
  if (payload.text) {
    process.stdout.write(`\n${payload.text}\n`);
    return;
  }
  if (payload.document) {
    process.stdout.write(`\n📎 [file] ${payload.document.filename} — ${payload.document.caption}\n   ${payload.libraryPath || payload.document.path}\n`);
    return;
  }
  if (payload.image) {
    process.stdout.write(`\n🖼 [image] ${payload.image.caption || ''} ${payload.image.path}\n`);
  }
};

const count = stats(OWNER);
console.log('──────────────────────────────────────────────────────────');
console.log('  X Document Manager — terminal chat');
console.log(`  ${count.total} documents · ${count.matters} cases`);
console.log('  Type a message (try "help"). Upload with: upload <file path>');
console.log('  Type "exit" to quit.');
console.log('──────────────────────────────────────────────────────────');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const prompt = () => rl.setPrompt('\nYou: ') && rl.prompt();

async function upload(file) {
  const abs = path.resolve(file.replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(abs)) {
    console.log(`\nNo such file: ${abs}`);
    return;
  }
  const result = await ingestFile({
    owner: OWNER,
    buffer: fs.readFileSync(abs),
    filename: path.basename(abs),
    mime: 'application/octet-stream',
  });
  const doc = result.doc;
  await send({ text: docCard(doc, { matter: doc.matter_id ? getMatter(doc.matter_id) : null, heading: result.duplicate ? '📎 Already in your library' : '📥 Filed' }) });
}

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return prompt();
  if (/^(?:exit|quit|bye|band)$/i.test(text)) {
    rl.close();
    return;
  }
  try {
    if (/^upload\s+/i.test(text)) {
      await upload(text.replace(/^upload\s+/i, ''));
    } else {
      await handleText({ owner: OWNER, text, send });
    }
  } catch (err) {
    console.log(`\n⚠️  ${err.message}`);
  }
  prompt();
});

rl.on('close', () => {
  console.log('\nBye.');
  process.exit(0);
});

prompt();
