/*
 * Silhueta · retoques manuais
 *
 * Cada traço fica guardado em coordenadas normalizadas (0..1) e raio relativo ao lado maior, então a
 * mesma lista de traços é reaplicada na prévia (pequena) e na exportação (tamanho real).
 *
 * O resultado dos traços é um par de mapas:   alfa_final = alfa_auto · (1 − W) + P
 * (equivale a empilhar cada traço, com sua cobertura, por cima do recorte automático).
 */
import { floodRegion } from './refine.js';

export function newEdits(w, h) {
  return { w, h, P: new Float32Array(w * h), W: new Float32Array(w * h) };
}

/** Um carimbo circular. `target` é 0, 1 ou um mapa (cabelo). Devolve o retângulo alterado. */
export function stamp(ed, cx, cy, r, hardness, target) {
  const { w, h, P, W } = ed;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const soft = Math.max(0.0001, r * (1 - hardness)), isMap = typeof target !== 'number';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = (r - d) / soft, f = t >= 1 ? 1 : t * t * (3 - 2 * t);
      if (f <= 0) continue;
      const i = y * w + x, tv = isMap ? target[i] : target;
      P[i] = P[i] * (1 - f) + tv * f;
      W[i] = 1 - (1 - W[i]) * (1 - f);
    }
  }
  return [x0, y0, x1 + 1, y1 + 1];
}

/** Carimba ao longo do segmento (x0,y0)→(x1,y1). Devolve o retângulo alterado. */
export function strokeSegment(ed, x0, y0, x1, y1, r, hardness, target) {
  const dist = Math.hypot(x1 - x0, y1 - y0), step = Math.max(1, r * 0.22), n = Math.max(1, Math.ceil(dist / step));
  let box = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n, b = stamp(ed, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, hardness, target);
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  return box;
}

/** Aplica uma máscara 0..1 (varinha) como um traço de uma vez só. */
export function applyMask(ed, mask, target) {
  const { P, W } = ed;
  for (let i = 0; i < mask.length; i++) {
    const f = mask[i];
    if (f <= 0) continue;
    P[i] = P[i] * (1 - f) + target * f;
    W[i] = 1 - (1 - W[i]) * (1 - f);
  }
}

const TARGET = { restore: 1, erase: 0 };

/** Refaz todos os traços numa imagem de w×h. `src` = { rgba, hair } (hair só se houver traço de cabelo). */
export function rasterizeStrokes(strokes, w, h, src) {
  const ed = newEdits(w, h), L = Math.max(w, h);
  for (const s of strokes) {
    if (s.tool === 'wand') {
      const x = Math.min(w - 1, Math.max(0, Math.round(s.u * (w - 1)))), y = Math.min(h - 1, Math.max(0, Math.round(s.v * (h - 1))));
      const mask = floodRegion(src.rgba, w, h, x, y, s.tol, Math.max(1, L / 900));
      applyMask(ed, mask, s.mode === 'keep' ? 1 : 0);
      continue;
    }
    const target = s.tool === 'hair' ? (src.hair || 1) : TARGET[s.tool];
    const r = s.r * L, pts = s.pts;
    if (pts.length === 2) { stamp(ed, pts[0] * w, pts[1] * h, r, s.hardness, target); continue; }
    for (let k = 2; k < pts.length; k += 2) strokeSegment(ed, pts[k - 2] * w, pts[k - 1] * h, pts[k] * w, pts[k + 1] * h, r, s.hardness, target);
  }
  return ed;
}
