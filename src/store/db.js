import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { config } from '../config.js';
import { log } from '../util/logger.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  phone      TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT DEFAULT 'owner',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matters (
  id            TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL,
  owner         TEXT NOT NULL,
  title         TEXT NOT NULL,
  client        TEXT,
  opposite      TEXT,
  case_number   TEXT,
  court         TEXT,
  practice_area TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matters_owner ON matters(owner);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL,
  owner           TEXT NOT NULL,
  matter_id       TEXT REFERENCES matters(id) ON DELETE SET NULL,
  title           TEXT,
  doc_type        TEXT,
  type_label      TEXT,
  type_confidence REAL DEFAULT 0,
  doc_date        TEXT,
  date_source     TEXT,
  court           TEXT,
  case_number     TEXT,
  original_name   TEXT,
  file_name       TEXT,
  rel_path        TEXT,
  mime            TEXT,
  size            INTEGER,
  pages           INTEGER,
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'processing',
  source          TEXT NOT NULL DEFAULT 'upload',
  text            TEXT,
  text_source     TEXT,
  summary         TEXT,
  key_points      TEXT,
  parties         TEXT,
  amounts         TEXT,
  statutes        TEXT,
  deadlines_json  TEXT,
  clauses         TEXT,
  tags            TEXT,
  entities        TEXT,
  confidence      REAL DEFAULT 0,
  needs_review    INTEGER DEFAULT 0,
  duplicate_of    TEXT,
  version_of      TEXT,
  language        TEXT DEFAULT 'en',
  fts_rowid       INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_accessed   TEXT,
  access_count    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner);
CREATE INDEX IF NOT EXISTS idx_documents_matter ON documents(matter_id);
CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_search USING fts5(
  title, doc_type, parties, tags, summary, body,
  tokenize = 'porter unicode61',
  prefix = '2 3 5'
);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_vocab USING fts5vocab(doc_search, 'row');

CREATE TABLE IF NOT EXISTS deadlines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner       TEXT NOT NULL,
  document_id TEXT,
  matter_id   TEXT,
  kind        TEXT NOT NULL DEFAULT 'deadline',
  title       TEXT NOT NULL,
  detail      TEXT,
  due_date    TEXT NOT NULL,
  remind_days INTEGER DEFAULT 3,
  notified_at TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(due_date);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT,
  direction  TEXT NOT NULL,
  wa_id      TEXT,
  kind       TEXT,
  body       TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages(owner, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(wa_id) WHERE wa_id IS NOT NULL;

-- eCourts case status data, imported from a .txt dump and remembered forever.
CREATE TABLE IF NOT EXISTS ecourts_cases (
  id             TEXT PRIMARY KEY,
  owner          TEXT NOT NULL,
  cnr            TEXT,
  case_number    TEXT,
  title          TEXT,
  court          TEXT,
  petitioner     TEXT,
  respondent     TEXT,
  status         TEXT,
  stage          TEXT,
  filing_date    TEXT,
  next_hearing   TEXT,
  last_hearing   TEXT,
  acts           TEXT,
  police_station TEXT,
  fir_number     TEXT,
  source_file    TEXT,
  raw            TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ecourts_owner ON ecourts_cases(owner, next_hearing);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ecourts_key ON ecourts_cases(owner, cnr) WHERE cnr IS NOT NULL;

CREATE TABLE IF NOT EXISTS bundles (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL,
  owner      TEXT NOT NULL,
  matter_id  TEXT,
  title      TEXT NOT NULL,
  doc_ids    TEXT NOT NULL,
  path       TEXT,
  size       INTEGER,
  created_at TEXT NOT NULL
);
`);

log.debug('database ready at', config.dbFile);

/** Run a function inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/** Atomic counter for human-friendly IDs: D1, M4, B2 … */
export function nextSeq(name) {
  db.prepare('INSERT INTO counters(name, value) VALUES(?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  return row.value;
}

export function setting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

/** Full backup copy of the database (used by the dashboard). */
export function backupTo(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function dbSize() {
  try { return fs.statSync(config.dbFile).size; } catch { return 0; }
}
