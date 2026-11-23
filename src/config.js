import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

for (const dir of [
  DATA_DIR,
  path.join(DATA_DIR, 'library'),
  path.join(DATA_DIR, 'imports'),
  path.join(DATA_DIR, 'exports'),
  path.join(DATA_DIR, 'logs'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

function readOrCreateToken() {
  if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN.trim();
  const tokenFile = path.join(DATA_DIR, 'dashboard-token.txt');
  if (fs.existsSync(tokenFile)) {
    const existing = fs.readFileSync(tokenFile, 'utf8').trim();
    if (existing) return existing;
  }
  // Short, typable, but random enough: 3 groups of 4 characters.
  const raw = crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 9);
  const token = `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`;
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  return token;
}

const phone = (value) => String(value || '').replace(/[^\d]/g, '');

export const config = {
  dataDir: DATA_DIR,
  libraryDir: path.join(DATA_DIR, 'library'),
  importsDir: path.join(DATA_DIR, 'imports'),
  exportsDir: path.join(DATA_DIR, 'exports'),
  dbFile: path.join(DATA_DIR, 'xdocmanager.db'),

  port: Number(process.env.PORT || 3000),
  host: '0.0.0.0',
  ownerName: (process.env.OWNER_NAME || '').trim(),
  ownerPhone: phone(process.env.OWNER_PHONE),
  allowedPhones: new Set(
    String(process.env.ALLOWED_PHONES || '')
      .split(',')
      .map(phone)
      .filter(Boolean),
  ),
  dashboardToken: readOrCreateToken(),

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'xdocmanager-verify',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },

  llm: {
    provider: (process.env.LLM_PROVIDER || '').trim().toLowerCase(),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    baseUrl: process.env.LLM_BASE_URL || '',
  },

  tesseractBin: process.env.TESSERACT_BIN || '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 64) * 1024 * 1024,
};

export function isOwner(waPhone) {
  const p = phone(waPhone);
  if (!p) return false;
  if (!config.ownerPhone && config.allowedPhones.size === 0) return true; // open demo mode
  return p === config.ownerPhone || config.allowedPhones.has(p);
}

export function whatsappConfigured() {
  return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
}

export function llmConfigured() {
  return Boolean(config.llm.provider && (config.llm.apiKey || config.llm.provider === 'ollama'));
}
