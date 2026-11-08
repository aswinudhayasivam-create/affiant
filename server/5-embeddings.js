// Local embeddings: a small open model runs inside this backend process.
// No content leaves the server for the embedding step.
import { pipeline } from '@xenova/transformers';

let extractor = null;
export async function initEmbeddings() {
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  return extractor;
}

export async function embed(texts) {
  const out = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
