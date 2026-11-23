import path from 'node:path';
import { slugify } from '../util/text.js';
import { typeFolder } from '../analysis/taxonomy.js';
import { toIso } from '../util/dates.js';

/** Canonical, readable file name: 2024-05-12_Rent-Agreement_Sharma-v-Mehta_D12.pdf */
export function canonicalFileName({ docDate, title, id, ext, createdAt }) {
  const date = docDate || (createdAt ? String(createdAt).slice(0, 10) : toIso(new Date()));
  const titlePart = slugify(title || 'Document', { max: 70 });
  const safeExt = /^\.?[\w]{1,8}$/.test(ext || '') ? (String(ext).startsWith('.') ? ext : `.${ext}`) : '.pdf';
  return `${date}_${titlePart}_${id}${safeExt.toLowerCase()}`;
}

/** Folder inside the library: <owner>/<matter or 00-Unfiled>/<type folder>/ */
export function libraryFolder({ ownerSlug, matter, docType }) {
  const matterFolder = matter ? `${matter.id}-${slugify(matter.title, { max: 48 })}` : '00-Unfiled';
  return path.join(ownerSlug, matterFolder, typeFolder(docType));
}

export function ownerSlug(phone) {
  const digits = String(phone || 'local').replace(/\D/g, '');
  return digits ? `owner-${digits.slice(-4)}` : 'owner-local';
}
