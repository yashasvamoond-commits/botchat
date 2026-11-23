import { DOC_TYPES, TYPE_BY_ID } from './taxonomy.js';
import { normalize } from '../util/text.js';

/**
 * Work out what kind of document this is using weighted keyword evidence.
 * @returns {{id:string, label:string, score:number, confidence:number, evidence:string[], runnerUp:?string}}
 */
export function classifyDocument({ text = '', filename = '', caption = '', mime = '' } = {}) {
  const head = String(text || '').slice(0, 3000);
  const body = String(text || '').slice(0, 120000);
  const name = `${filename} ${caption}`;
  const normalizedBody = normalize(body);
  const normalizedHead = normalize(head);
  const normalizedName = normalize(name);

  const scores = new Map();

  for (const type of DOC_TYPES) {
    if (type.id === 'photo') continue;
    let score = 0;
    const evidence = [];
    for (const re of type.strong) {
      const flags = re.flags.includes('i') ? re.flags.replace('g', '') : `${re.flags.replace('g', '')}i`;
      const inName = new RegExp(re.source, flags).test(normalizedName);
      const inHead = new RegExp(re.source, flags).test(normalizedHead);
      const inBody = new RegExp(re.source, flags).test(normalizedBody);
      if (inName) { score += 7; evidence.push(re.source); }
      else if (inHead) { score += 5; evidence.push(re.source); }
      else if (inBody) { score += 3; evidence.push(re.source); }
    }
    for (const re of type.weak) {
      const flags = re.flags.includes('i') ? re.flags.replace('g', '') : `${re.flags.replace('g', '')}i`;
      const inHead = new RegExp(re.source, flags).test(normalizedHead);
      const inBody = new RegExp(re.source, flags).test(normalizedBody);
      const inName = new RegExp(re.source, flags).test(normalizedName);
      if (inName) score += 1.4;
      else if (inHead) score += 1.6;
      else if (inBody) score += 0.7;
    }
    if (score > 0) scores.set(type.id, { score, evidence });
  }

  if (mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|tiff?|bmp)$/i.test(filename)) {
    scores.set('photo', { score: (scores.get('photo')?.score || 0) + 2, evidence: ['image file'] });
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) {
    const fallback = mime.startsWith('image/') ? 'photo' : 'other';
    return { id: fallback, label: TYPE_BY_ID.get(fallback)?.label || 'Document', score: 0, confidence: 0.2, evidence: [], runnerUp: null };
  }

  const [bestId, best] = ranked[0];
  const second = ranked[1];
  const bestType = TYPE_BY_ID.get(bestId);
  const gap = second ? best.score - second[1].score : best.score;
  const confidence = Math.max(
    0.25,
    Math.min(0.97, 0.3 + Math.min(best.score, 30) / 40 + Math.min(gap, 8) / 30),
  );

  return {
    id: bestId,
    label: bestType?.label || 'Document',
    score: Number(best.score.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    evidence: [...new Set(best.evidence)].slice(0, 5),
    runnerUp: second ? second[0] : null,
  };
}
