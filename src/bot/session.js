import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const FILE = path.join(config.dataDir, 'sessions.json');
const sessions = new Map();
let saveTimer = null;

function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [owner, session] of Object.entries(data)) sessions.set(owner, session);
  } catch {
    /* start fresh */
  }
}
load();

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const obj = Object.fromEntries(sessions.entries());
      fs.writeFileSync(FILE, JSON.stringify(obj, null, 1), { mode: 0o600 });
    } catch {
      /* non-fatal */
    }
  }, 400);
  saveTimer.unref?.();
}

export function defaultSession() {
  return {
    lastResults: [],
    lastQuery: '',
    lastPage: 0,
    lastDocId: null,
    lastMatterId: null,
    pending: null,
    undo: [],
    introShown: false,
    createdAt: new Date().toISOString(),
  };
}

export function getSession(owner) {
  if (!sessions.has(owner)) sessions.set(owner, defaultSession());
  return sessions.get(owner);
}

export function updateSession(owner, patch) {
  const session = getSession(owner);
  Object.assign(session, patch);
  scheduleSave();
  return session;
}

export function pushUndo(owner, action) {
  const session = getSession(owner);
  session.undo.unshift({ ...action, at: new Date().toISOString() });
  session.undo = session.undo.slice(0, 10);
  scheduleSave();
}

export function popUndo(owner) {
  const session = getSession(owner);
  const action = session.undo.shift();
  scheduleSave();
  return action || null;
}
