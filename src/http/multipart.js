import Busboy from 'busboy';
import { config } from '../config.js';

/**
 * Parse a multipart/form-data request into { fields, files }.
 * Files are held in memory (documents are small enough for this use).
 */
export function parseMultipart(req, { maxFileBytes = config.maxUploadBytes } = {}) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: maxFileBytes, files: 10, fields: 20 },
      });
    } catch (err) {
      reject(err);
      return;
    }
    const fields = {};
    const files = [];
    let failure = null;

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size <= maxFileBytes) chunks.push(chunk);
      });
      stream.on('limit', () => {
        failure = new Error('File is too large');
        stream.resume();
      });
      stream.on('end', () => {
        if (!failure && chunks.length) {
          files.push({
            field: name,
            filename: info.filename || 'upload',
            mime: info.mimeType || 'application/octet-stream',
            buffer: Buffer.concat(chunks),
          });
        }
      });
    });
    busboy.on('error', reject);
    busboy.on('close', () => {
      if (failure) reject(failure);
      else if (!files.length) reject(new Error('No file received'));
      else resolve({ fields, files });
    });
    req.pipe(busboy);
  });
}
