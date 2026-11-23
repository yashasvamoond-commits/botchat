#!/usr/bin/env node
/**
 * Import an eCourts .txt dump into permanent memory from the command line.
 *
 *   npm run ecourts -- path/to/ecourts.txt
 *   npm run ecourts -- path/to/ecourts.txt --owner 919812345678
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { importEcourtsUpload } from '../src/ingest/ecourts.js';
import { listEcourtsCases, ecourtsSummary } from '../src/store/ecourts.js';

const args = process.argv.slice(2);
const ownerIndex = args.indexOf('--owner');
const owner = ownerIndex >= 0 ? args[ownerIndex + 1] : (config.simOwner || 'local');
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--owner');

if (!file) {
  console.error('Usage: npm run ecourts -- <eCourts .txt file> [--owner <phone>]');
  process.exit(1);
}

const buffer = fs.readFileSync(file);
const result = importEcourtsUpload({ owner, buffer, filename: path.basename(file) });

if (!result.handled) {
  console.error('That file does not look like an eCourts case-status dump (no CNR / case number lines found).');
  process.exit(2);
}

console.log(result.message);
const summary = ecourtsSummary(owner);
console.log(`\nRemembered for ${owner}: ${summary.total} case(s), ${summary.withHearing} with a next hearing.`);
for (const row of listEcourtsCases(owner, { limit: 10 })) {
  console.log(`  ${row.cnr || '-'}  ${(row.title || '').slice(0, 48).padEnd(48)}  next: ${row.next_hearing || '-'}`);
}
