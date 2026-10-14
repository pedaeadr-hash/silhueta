/*
 * Silhueta · pipeline do recorte (puro, sem DOM: roda na página, no Worker e no Node)
 *
 *   máscara da IA ─▶ detalhe fino ─▶ forma da borda ─▶ limpeza ─▶ cores sem halo ─▶ (pincéis) ─▶ pixels finais
 *
 * Os parâmetros de tamanho (contrair, suavizar, alcance...) são dados em "px numa imagem de 1500 px"
 * e escalados para o tamanho real, então a prévia e a exportação ficam iguais.
 */
import {
  softBlur, refineDetail, estimateForegroundRGB, shiftEdge, cleanup, applyLevels,
  colorKeyAlpha, borderColor, clamp01
} from './refine.js';

export const MATTE_DEFAULTS = {
  mode: 'auto',            // auto | portrait | general | color
  hair: 65,                // 0..100  intensidade do detalhe fino
  reach: 50,               // 0..100  largura da faixa de cabelo
  threshold: 50,           // 0..100  posição da borda (50 = como a IA fez)
  contrast: 0,             // 0..100  nitidez da borda
  shift: 0,                // -30..30 contrair (-) / expandir (+)
  feather: 0,              // 0..12   suavizar a borda
  decontam: 85,            // 0..100  remover halo de cor
  islands: 15,             // 0..100  tamanho das manchas isoladas que somem
  keepLargest: false,
  dust: true,
  bgLike: true,            // ignora regiões separadas que têm a cor do fundo (riscos claros, sombras)
  fillHoles: false,
  holeSize: 20,
  key: { color: null, tol: 14, soft: 9, contiguous: true, seed: null }   // modo "cor sólida"
};

export const sizeScale = (w, h) => Math.max(w, h) / 1500;

/** Redimensiona um mapa em tons de cinza (Uint8 / Float32) para w2×h2, bilinear, devolvendo 0..1. */
export function resizeGray(src, sw, sh, dw, dh, srcIs8bit = true) {
  const out = new Float32Array(dw * dh), k = srcIs8bit ? 1 / 255 : 1;
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * k;
    }
  }
  return out;
}

/** Máscara bruta (antes de qualquer ajuste) no tamanho da imagem. */
export function baseMatte(ctx, P) {
  const { rgba, w, h } = ctx;
  if (P.mode === 'color' || !ctx.coarse) {
    const key = P.key.color || [255, 255, 255];
    return colorKeyAlpha(rgba, w, h, key, P.key.tol / 100, P.key.soft / 100, P.key.contiguous, P.key.seed);
  }
  const g = ctx.coarse;
  return g.w === w && g.h === h ? Float32Array.from(g.data, v => v / 255) : resizeGray(g.data, g.w, g.h, w, h);
}

const bandPx = (P, s) => (5 + P.reach * 0.4) * s;

/** Detalhe fino. Em modo cor sólida o recorte já vem da própria foto, então não refina. */
export function detailStage(ctx, P, m0) {
  const { w, h } = ctx, s = sizeScale(w, h);
  if (P.mode === 'color' || P.hair <= 0) return m0;
  return refineDetail(ctx.rgba, m0, w, h, { strength: P.hair / 100, band: bandPx(P, s) });
}

/** Posição, nitidez, contrair/expandir, suavizar e limpeza. */
export function shapeStage(ctx, P, m1) {
  const { w, h } = ctx, s = sizeScale(w, h), N = w * h;
  let m = applyLevels(m1, P.threshold / 100, P.contrast / 100);
  if (P.shift) m = shiftEdge(m, w, h, P.shift * s);
  if (P.feather > 0) m = softBlur(m, w, h, P.feather * s);
  const hasClean = P.islands > 0 || P.keepLargest || P.fillHoles || P.bgLike;
  if (hasClean) {
    m = cleanup(m, w, h, {
      minArea: P.islands / 100 * 0.01 * N,
      keepLargest: P.keepLargest,
      dustReach: P.dust && P.islands > 0 ? bandPx(P, s) * 1.4 : 0,
      bgLike: P.bgLike && P.mode !== 'color' ? { rgba: ctx.rgba, color: (ctx.bgColor ||= borderColor(ctx.rgba, w, h)), protect: Math.max(4, Math.max(w, h) * 0.025) } : null,
      fillHoles: P.fillHoles,
      holeMax: P.holeSize / 100 * 0.05 * N
    });
  }
  return m;
}

/** Cor do objeto sem a parte que veio do fundo. Devolve RGB intercalado (Uint8ClampedArray) ou null. */
export function colorStage(ctx, P, m2) {
  if (P.decontam <= 0) return null;
  const { w, h } = ctx, s = sizeScale(w, h);
  return estimateForegroundRGB(ctx.rgba, m2, w, h, Math.max(4, Math.round(22 * s)), Math.max(1, Math.round(2.4 * s)));
}

/** Roda tudo, reaproveitando o que não mudou (`cache` guarda a última execução e os tempos de cada etapa). */
export function computeMatte(ctx, P, cache = {}) {
  const T = cache.timing = cache.timing || {};
  const now = typeof performance !== 'undefined' ? () => performance.now() : Date.now;
  const key0 = P.mode === 'color' ? 'k' + JSON.stringify(P.key) : 'm' + (ctx.coarseId ?? 0);
  if (cache.k0 !== key0) { cache.k0 = key0; const t = now(); cache.m0 = baseMatte(ctx, P); T.base = now() - t; cache.k1 = cache.k2 = cache.k3 = null; }

  const key1 = key0 + `|${P.mode === 'color' ? 0 : P.hair}|${P.reach}`;
  if (cache.k1 !== key1) { cache.k1 = key1; const t = now(); cache.m1 = detailStage(ctx, P, cache.m0); T.detail = now() - t; cache.k2 = cache.k3 = null; }

  const key2 = key1 + `|${P.threshold}|${P.contrast}|${P.shift}|${P.feather}|${P.islands}|${P.keepLargest}|${P.dust}|${P.bgLike}|${P.fillHoles}|${P.holeSize}`;
  if (cache.k2 !== key2) { cache.k2 = key2; const t = now(); cache.m2 = shapeStage(ctx, P, cache.m1); T.shape = now() - t; cache.k3 = null; }

  const key3 = key2 + `|${P.decontam > 0}`;
  if (cache.k3 !== key3) { cache.k3 = key3; const t = now(); cache.rgb = colorStage(ctx, P, cache.m2); T.color = now() - t; }

  return { alpha: cache.m2, rgb: cache.rgb, base: cache.m1, timing: T };
}

/** Máscara "agressiva" para o pincel de cabelo: refinamento total numa faixa larga. */
export function hairMatte(ctx, P, m0) {
  const { w, h } = ctx, s = sizeScale(w, h);
  return refineDetail(ctx.rgba, m0, w, h, { strength: 1, band: (14 + P.reach * 0.3) * s, force: true });
}

/**
 * Monta os pixels finais (RGBA não pré-multiplicado).
 *  rgb       cores sem halo (ou null)
 *  decontam  0..100
 *  ed        { P, W } dos pincéis (ou null)
 */
export function buildSubject(orig, alpha, rgb, decontam, ed, w, h, out) {
  const N = w * h, k = clamp01(decontam / 100), o = out || new Uint8ClampedArray(N * 4);
  fillSubject(orig, alpha, rgb, k, ed, w, h, o, 0, 0, w, h);
  return o;
}

/** Recalcula só o retângulo [x0,x1) × [y0,y1): usado enquanto o pincel pinta. */
export function fillSubject(orig, alpha, rgb, k, ed, w, h, o, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x, p = i * 4;
      let a = alpha[i], wt = 0;
      if (ed) { wt = ed.W[i]; a = a * (1 - wt) + ed.P[i]; }
      let r = orig[p], g = orig[p + 1], b = orig[p + 2];
      if (rgb && k > 0) {
        const q = i * 3;
        r += (rgb[q] - r) * k; g += (rgb[q + 1] - g) * k; b += (rgb[q + 2] - b) * k;
        if (wt > 0) { r += (orig[p] - r) * wt; g += (orig[p + 1] - g) * wt; b += (orig[p + 2] - b) * wt; }
      }
      o[p] = r; o[p + 1] = g; o[p + 2] = b; o[p + 3] = a * 255 + 0.5;
    }
  }
}

/** Retângulo que contém o objeto (alfa acima do limite). null se estiver vazio. */
export function alphaBounds(rgba, w, h, thr = 8) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w * 4 + 3;
    for (let x = 0; x < w; x++) if (rgba[o + x * 4] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
