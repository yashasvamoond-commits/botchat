/**
 * Optional OCR. Works if either:
 *   • the tesseract command-line program is installed (TESSERACT_BIN), or
 *   • the npm package "tesseract.js" is installed.
 * Neither is required — without OCR, captions and an AI vision model still work.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { log } from '../util/logger.js';

const run = promisify(execFile);
let tesseractJs = null;
let tesseractJsChecked = false;

async function loadTesseractJs() {
  if (tesseractJsChecked) return tesseractJs;
  tesseractJsChecked = true;
  try {
    tesseractJs = await import('tesseract.js');
  } catch {
    tesseractJs = null;
  }
  return tesseractJs;
}

export async function ocrAvailable() {
  if (config.tesseractBin) return 'cli';
  if (await loadTesseractJs()) return 'tesseract.js';
  return null;
}

export async function ocrImage(buffer, { filename = 'image.png', languages = ['eng', 'hin'] } = {}) {
  const mode = await ocrAvailable();
  if (!mode) return { text: '', method: 'unavailable' };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xdoc-ocr-'));
  const file = path.join(tmpDir, path.basename(filename) || 'image.png');
  await fs.writeFile(file, buffer);

  try {
    if (mode === 'cli') {
      const lang = languages.join('+');
      const { stdout } = await run(config.tesseractBin, [file, 'stdout', '-l', lang], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      });
      return { text: String(stdout || '').trim(), method: 'tesseract-cli' };
    }
    if (mode === 'tesseract.js') {
      const { createWorker } = tesseractJs;
      const worker = await createWorker(languages[0]);
      const { data } = await worker.recognize(file);
      await worker.terminate();
      return { text: String(data?.text || '').trim(), method: 'tesseract.js' };
    }
  } catch (err) {
    log.warn('OCR failed:', err.message);
    return { text: '', method: 'error', error: err.message };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return { text: '', method: 'unavailable' };
}
