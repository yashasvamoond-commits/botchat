import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { deleteDocument, createDocument } from './repo.js';
import { log } from '../util/logger.js';

const ARCHIVE_DIR = path.join(config.dataDir, 'archive');

async function ensureDir() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
}

/**
 * Remove a document from the library but keep everything needed to undo it.
 */
export async function archiveDelete(doc) {
  await ensureDir();
  const snapshot = { ...doc, deletedAt: new Date().toISOString() };
  if (doc.rel_path) {
    const abs = path.resolve(config.dataDir, doc.rel_path);
    if (abs.startsWith(config.dataDir) && await exists(abs)) {
      const dest = path.join(ARCHIVE_DIR, `${doc.id}-${path.basename(abs)}`);
      await fs.rename(abs, dest).catch(async () => {
        await fs.copyFile(abs, dest);
        await fs.unlink(abs).catch(() => {});
      });
      snapshot.archivedFile = path.relative(config.dataDir, dest);
    }
  }
  await fs.writeFile(path.join(ARCHIVE_DIR, `${doc.id}.json`), JSON.stringify(snapshot, null, 1));
  deleteDocument(doc.owner, doc.id);
  log.info(`archived ${doc.id} (undo available)`);
  return snapshot;
}

export async function restoreArchived(snapshot) {
  if (!snapshot?.id) return null;
  let relPath = snapshot.rel_path || null;
  if (snapshot.archivedFile) {
    const from = path.join(config.dataDir, snapshot.archivedFile);
    const to = path.join(config.dataDir, relPath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to).catch(async () => {
      await fs.copyFile(from, to);
      await fs.unlink(from).catch(() => {});
    });
  }
  const fields = { ...snapshot };
  delete fields.deletedAt;
  delete fields.archivedFile;
  delete fields.fts_rowid;
  delete fields.access_count;
  delete fields.last_accessed;
  return createDocument(fields);
}

export async function purgeArchived(id) {
  await ensureDir();
  await fs.unlink(path.join(ARCHIVE_DIR, `${id}.json`)).catch(() => {});
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
