/* Silhueta · worker do conversor: vetoriza (PNG/JPG → SVG) fora da thread da página */
import { vectorize } from './vectorize.js';

self.onmessage = e => {
  const { id, img, mode, opts } = e.data;
  try {
    const r = vectorize(img, mode, opts);
    self.postMessage({ id, svg: r.svg, stats: r.stats, autoThr: r.autoThr });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
