#!/usr/bin/env node
/**
 * Build the single-file offline app: docs/index.html
 *
 * The whole analysis engine (script detection, dates, entities, taxonomy,
 * localisation, search planning, eCourts parsing) is plain ESM with no Node
 * built-ins, so it can be bundled into one classic <script> and run from
 * Safari/Chrome with no server at all — including from a downloaded file.
 *
 * The bundler is deliberately strict: it understands the import/export forms
 * this codebase uses and throws on anything else, so a bundling mistake can
 * never ship silently.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Dependency order — each module may only use the ones above it. */
const MODULES = [
  'src/util/script.js',
  'src/util/text.js',
  'src/util/dates.js',
  'src/util/numberWords.js',
  'src/analysis/taxonomy.js',
  'src/analysis/localized.js',
  'src/analysis/entities.js',
  'src/analysis/classify.js',
  'src/analysis/analyzer.js',
  'src/search/synonyms.js',
  'src/search/tokenize.js',
  'src/search/queryParser.js',
  'src/ingest/ecourts-parse.js',
];

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '');

function resolveSpecifier(fromModule, spec) {
  if (!spec.startsWith('.')) throw new Error(`Cannot bundle non-relative import "${spec}" in ${fromModule}`);
  const base = path.posix.dirname(fromModule);
  const resolved = path.posix.normalize(path.posix.join(base, spec));
  if (!MODULES.includes(resolved)) throw new Error(`${fromModule} imports ${resolved}, which is not in MODULES`);
  return resolved;
}

/** Remove import statements, return the destructuring lines to prepend. */
function extractImports(modulePath, code) {
  const lines = [];
  let out = code;
  const importRe = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
  out = out.replace(importRe, (whole, clause, spec) => {
    const target = resolveSpecifier(modulePath, spec);
    const clean = clause.trim();
    let binding;
    if (clean.startsWith('{')) {
      binding = `const ${clean} = __m['${target}'];`;
    } else if (/^\*\s+as\s+/.test(clean)) {
      binding = `const ${clean.replace(/^\*\s+as\s+/, '')} = __m['${target}'];`;
    } else {
      binding = `const ${clean} = __m['${target}'].default;`;
    }
    lines.push(binding);
    return '';
  });
  if (/^import\s/m.test(out)) throw new Error(`Unhandled import statement in ${modulePath}`);
  return { code: out, bindingLines: [...new Set(lines)] };
}

/** Remove export keywords, return the exported name map (exported -> local). */
function extractExports(modulePath, code) {
  const exported = new Map(); // exportedName -> localName
  let out = code;

  out = out.replace(/^export\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    exported.set(name, name);
    return `${kind} ${name}`;
  });

  out = out.replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    exported.set(name, name);
    return `${kind} ${name}`;
  });

  out = out.replace(/^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_m, list) => {
    for (const part of list.split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [local, alias] = piece.split(/\s+as\s+/);
      exported.set((alias || local).trim(), local.trim());
    }
    return '';
  });

  if (/^export\s/m.test(out)) {
    throw new Error(`Unhandled export statement in ${modulePath}:\n${out.match(/^export\s.*/m)[0]}`);
  }
  return { code: out, exported };
}

function bundle() {
  const chunks = ['const __m = Object.create(null);'];
  for (const modulePath of MODULES) {
    const raw = fs.readFileSync(path.join(ROOT, modulePath), 'utf8');
    const { code: withoutImports, bindingLines } = extractImports(modulePath, raw);
    const { code, exported } = extractExports(modulePath, stripComments(withoutImports));
    const entries = [...exported].map(([name, local]) => (name === local ? name : `${name}: ${local}`)).join(', ');
    chunks.push(
      `/* ${modulePath} */\n__m['${modulePath}'] = (function () {\n`
      + `${bindingLines.join('\n')}\n${code}\n`
      + `return { ${entries} };\n})();`,
    );
  }
  chunks.push('const ENGINE = { analyzeDocument: __m["src/analysis/analyzer.js"].analyzeDocument, '
    + 'parseQuery: __m["src/search/queryParser.js"].parseQuery, '
    + 'queryTokens: __m["src/search/tokenize.js"].queryTokens, '
    + 'normalize: __m["src/util/text.js"].normalize, '
    + 'clip: __m["src/util/text.js"].clip, '
    + 'slugify: __m["src/util/text.js"].slugify, '
    + 'parseEcourtsText: __m["src/ingest/ecourts-parse.js"].parseEcourtsText, '
    + 'looksLikeEcourts: __m["src/ingest/ecourts-parse.js"].looksLikeEcourts, '
    + 'formatDate: __m["src/util/dates.js"].formatDate, '
    + 'daysBetween: __m["src/util/dates.js"].daysBetween, '
    + 'toIso: __m["src/util/dates.js"].toIso, '
    + 'DOC_TYPES: __m["src/analysis/taxonomy.js"].DOC_TYPES };');
  return chunks.join('\n\n');
}

const engine = bundle();
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'offline-engine.js'), `${engine}\n`);
console.log(`bundled ${MODULES.length} modules → build/offline-engine.js (${(engine.length / 1024).toFixed(1)} kB)`);

/* ── one self-contained HTML file ─────────────────────────────── */

const shell = fs.readFileSync(path.join(ROOT, 'src', 'offline', 'shell.html'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'src', 'offline', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'src', 'offline', 'app-ui.js'), 'utf8');

if (/<\/script/i.test(engine) || /<\/script/i.test(app)) {
  throw new Error('Bundled code contains a closing script tag — it would break the inline page.');
}

const html = shell
  .replace('/*__STYLES__*/', () => styles.trim())
  .replace('/*__ENGINE__*/', () => engine.trim())
  .replace('/*__APP__*/', () => app.trim());

for (const dir of ['docs', 'downloads']) fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), html);
fs.writeFileSync(path.join(ROOT, 'downloads', 'X-Document-Manager.html'), html);
console.log(`wrote docs/index.html and downloads/X-Document-Manager.html (${(html.length / 1024).toFixed(1)} kB)`);
