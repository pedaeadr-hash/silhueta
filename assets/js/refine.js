/*
 * Silhueta · núcleo de refinamento do recorte
 *
 * Tudo aqui trabalha com Float32Array (valores 0..1) e RGBA 8 bits, sem DOM,
 * então roda no navegador e também no Node (veja tests/refine.test.mjs).
 *
 * Os raios são sempre em pixels da imagem que está sendo processada; quem chama
 * converte a partir de frações do lado maior (veja `scaleParams` em pipeline.js).
 */

export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ */
/* Filtros básicos                                                     */
/* ------------------------------------------------------------------ */

/** Desfoque de caixa separável com bordas replicadas. O(N), independe do raio. */
export function boxBlur(src, w, h, r, out = new Float32Array(w * h)) {
  r = Math.round(r);
  if (r < 1) { out.set(src); return out; }
  const n = 2 * r + 1, tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[o + (k < 0 ? 0 : k >= w ? w - 1 : k)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / n;
      acc += src[o + (x + r + 1 < w ? x + r + 1 : w - 1)] - src[o + (x - r < 0 ? 0 : x - r)];
    }
  }
  const acc = new Float64Array(w);
  for (let k = -r; k <= r; k++) {
    const o = (k < 0 ? 0 : k >= h ? h - 1 : k) * w;
    for (let x = 0; x < w; x++) acc[x] += tmp[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w, add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, sub = (y - r < 0 ? 0 : y - r) * w;
    for (let x = 0; x < w; x++) { out[o + x] = acc[x] / n; acc[x] += tmp[add + x] - tmp[sub + x]; }
  }
  return out;
}

/** Duas passadas de caixa: aproxima um gaussiano e evita o aspecto "quadrado". */
export function softBlur(src, w, h, r) {
  if (r < 0.5) return src.slice();
  const rr = Math.max(1, Math.round(r * 0.72));
  return boxBlur(boxBlur(src, w, h, rr), w, h, rr);
}

export function luma(rgba, w, h) {
  const N = w * h, out = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) out[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  return out;
}

function downsample(src, w, h, s) {
  const w2 = Math.ceil(w / s), h2 = Math.ceil(h / s), out = new Float32Array(w2 * h2);
  for (let y2 = 0; y2 < h2; y2++) for (let x2 = 0; x2 < w2; x2++) {
    let sum = 0, n = 0;
    const y0 = y2 * s, x0 = x2 * s, y1 = Math.min(h, y0 + s), x1 = Math.min(w, x0 + s);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += src[y * w + x]; n++; }
    out[y2 * w2 + x2] = sum / n;
  }
  return { data: out, w: w2, h: h2 };
}

function upsample(src, w2, h2, w, h) {
  const out = new Float32Array(w * h), sx = w2 / w, sy = h2 / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h2 - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w2 - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * w2 + x0], b = src[y0 * w2 + x1], c = src[y1 * w2 + x0], d = src[y1 * w2 + x1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Guided filter (He et al.) com guia em tons de cinza; `sub` > 1 usa a versão rápida. */
export function guidedFilter(I, p, w, h, r, eps, sub = 1) {
  let I2 = I, p2 = p, w2 = w, h2 = h;
  if (sub > 1) {
    const a = downsample(I, w, h, sub);
    I2 = a.data; w2 = a.w; h2 = a.h; p2 = downsample(p, w, h, sub).data;
    r = Math.max(1, Math.round(r / sub));
  }
  const N = w2 * h2;
  const mI = boxBlur(I2, w2, h2, r), mp = boxBlur(p2, w2, h2, r);
  const II = new Float32Array(N), Ip = new Float32Array(N);
  for (let i = 0; i < N; i++) { II[i] = I2[i] * I2[i]; Ip[i] = I2[i] * p2[i]; }
  const mII = boxBlur(II, w2, h2, r), mIp = boxBlur(Ip, w2, h2, r);
  const a = II, b = Ip; // reaproveita os buffers
  for (let i = 0; i < N; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i], ai = c / (v + eps);
    a[i] = ai; b[i] = mp[i] - ai * mI[i];
  }
  let A = boxBlur(a, w2, h2, r), B = boxBlur(b, w2, h2, r);
  if (sub > 1) { A = upsample(A, w2, h2, w, h); B = upsample(B, w2, h2, w, h); }
  const q = new Float32Array(w * h);
  for (let i = 0; i < q.length; i++) q[i] = clamp01(A[i] * I[i] + B[i]);
  return q;
}

/* ------------------------------------------------------------------ */
/* Distância euclidiana (Felzenszwalb) para contrair / expandir        */
/* ------------------------------------------------------------------ */

const INF = 1e20;

function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    while (s <= z[k]) {
      k--; p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Distância (px) de cada pixel até o pixel mais próximo onde `target[i] === 1`. */
export function distanceTo(target, w, h) {
  const N = w * h, g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = target[i] ? 0 : INF;
  const m = Math.max(w, h), v = new Int32Array(m), z = new Float32Array(m + 1);
  const col = new Float32Array(h), colOut = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = g[y * w + x];
    dt1d(col, h, colOut, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = colOut[y];
  }
  const row = new Float32Array(w), rowOut = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) row[x] = g[o + x];
    dt1d(row, w, rowOut, v, z);
    for (let x = 0; x < w; x++) g[o + x] = Math.sqrt(rowOut[x]);
  }
  return g;
}

/** Contrai (d < 0) ou expande (d > 0) a silhueta em `d` pixels, mantendo a suavidade onde dá. */
export function shiftEdge(a, w, h, d) {
  if (!d || Math.abs(d) < 0.05) return a;
  const N = w * h, out = new Float32Array(N), t = new Uint8Array(N);
  if (d < 0) {
    for (let i = 0; i < N; i++) t[i] = a[i] < 0.5 ? 1 : 0;
    const dist = distanceTo(t, w, h), k = -d;
    for (let i = 0; i < N; i++) out[i] = a[i] * clamp01(dist[i] - k + 0.35);
  } else {
    for (let i = 0; i < N; i++) t[i] = a[i] >= 0.5 ? 1 : 0;
    const dist = distanceTo(t, w, h);
    for (let i = 0; i < N; i++) { const grow = clamp01(d - dist[i] + 1); out[i] = a[i] > grow ? a[i] : grow; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Componentes conexos: manchas isoladas e buracos                     */
/* ------------------------------------------------------------------ */

function labelComponents(bin, w, h) {
  const N = w * h, labels = new Int32Array(N), queue = new Int32Array(N);
  const areas = [0], border = [false];
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (!bin[s] || labels[s]) continue;
    const id = ++count;
    let qh = 0, qt = 0, area = 0, touches = false;
    labels[s] = id; queue[qt++] = s;
    while (qh < qt) {
      const i = queue[qh++], x = i % w, y = (i - x) / w;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && bin[i - 1] && !labels[i - 1]) { labels[i - 1] = id; queue[qt++] = i - 1; }
      if (x < w - 1 && bin[i + 1] && !labels[i + 1]) { labels[i + 1] = id; queue[qt++] = i + 1; }
      if (y > 0 && bin[i - w] && !labels[i - w]) { labels[i - w] = id; queue[qt++] = i - w; }
      if (y < h - 1 && bin[i + w] && !labels[i + w]) { labels[i + w] = id; queue[qt++] = i + w; }
    }
    areas.push(area); border.push(touches);
  }
  return { labels, areas, border, count };
}

/**
 * Limpeza do recorte.
 *  minArea     – manchas com menos pixels que isso somem
 *  keepLargest – mantém só o maior objeto
 *  dustReach   – px; pixels semitransparentes mais longe que isso de qualquer objeto mantido somem
 *  fillHoles / holeMax – tapa buracos fechados menores que holeMax pixels
 *  bgLike      – { rgba, color:[r,g,b], protect:px }: some com regiões separadas do objeto principal cuja cor é a do fundo
 *                (riscos claros, sombras, reflexos que a IA marcou como objeto). Regiões a menos de `protect` px
 *                do objeto principal ficam, para não perder um sapato branco separado da perna por uma fresta.
 */
export function cleanup(a, w, h, o) {
  const N = w * h, out = a.slice();
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = a[i] >= 0.5 ? 1 : 0;

  if (o.minArea > 0 || o.keepLargest || o.dustReach > 0 || o.bgLike) {
    const { labels, areas, count } = labelComponents(bin, w, h);
    if (count) {
      let largest = 1;
      for (let c = 2; c <= count; c++) if (areas[c] > areas[largest]) largest = c;
      const drop = new Uint8Array(count + 1);
      for (let c = 1; c <= count; c++) if ((o.keepLargest && c !== largest) || areas[c] < o.minArea) drop[c] = 1;

      if (o.bgLike && count > 1) {
        const { rgba, color, protect } = o.bgLike, tol = 38;
        const main = new Float32Array(N);
        for (let i = 0; i < N; i++) if (labels[i] === largest) main[i] = 1;
        const guard = boxBlur(main, w, h, Math.max(2, Math.round(protect)));
        const like = new Uint32Array(count + 1), guarded = new Uint8Array(count + 1);
        for (let i = 0; i < N; i++) {
          const l = labels[i];
          if (!l || l === largest) continue;
          const p = i * 4;
          if (Math.abs(rgba[p] - color[0]) <= tol && Math.abs(rgba[p + 1] - color[1]) <= tol && Math.abs(rgba[p + 2] - color[2]) <= tol) like[l]++;
          if (guard[i] > 0.0005) guarded[l] = 1;
        }
        for (let c = 1; c <= count; c++) if (c !== largest && !guarded[c] && like[c] >= areas[c] * 0.85) drop[c] = 1;
      }

      const rem = new Float32Array(N), keep = new Float32Array(N);
      let anyDrop = false;
      for (let i = 0; i < N; i++) {
        const l = labels[i];
        if (!l) continue;
        if (drop[l]) { rem[i] = 1; out[i] = 0; anyDrop = true; } else keep[i] = 1;
      }
      if (anyDrop) {
        const remD = boxBlur(rem, w, h, 3), keepD = boxBlur(keep, w, h, 3);
        for (let i = 0; i < N; i++) if (remD[i] > 0.001 && keepD[i] < 0.001) out[i] = 0;
      }
      if (o.dustReach > 0) {
        const near = boxBlur(keep, w, h, Math.max(2, Math.round(o.dustReach)));
        for (let i = 0; i < N; i++) if (near[i] < 0.0005) out[i] = 0;
      }
    }
  }

  if (o.fillHoles && o.holeMax > 0) {
    const inv = new Uint8Array(N);
    for (let i = 0; i < N; i++) inv[i] = out[i] < 0.5 ? 1 : 0;
    const { labels, areas, border, count } = labelComponents(inv, w, h);
    const fill = new Uint8Array(count + 1);
    for (let c = 1; c <= count; c++) if (!border[c] && areas[c] <= o.holeMax) fill[c] = 1;
    for (let i = 0; i < N; i++) if (labels[i] && fill[labels[i]]) out[i] = 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Contraste / limiar da borda                                         */
/* ------------------------------------------------------------------ */

/** t = onde fica a borda (0.5 = onde a IA colocou); c = 0 mantém o degradê, 1 deixa a borda dura. */
export function applyLevels(a, t, c) {
  if (Math.abs(t - 0.5) < 1e-4 && c < 1e-4) return a;
  const w = 1 - 0.96 * c, lo = t - w / 2, k = 1 / w, out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = clamp01((a[i] - lo) * k);
  return out;
}

/* ------------------------------------------------------------------ */
/* Detalhe fino (cabelo, pelos, bordas vazadas)                        */
/* ------------------------------------------------------------------ */

/** Média em blocos s×s de 3 canais RGB (0..1) numa passada só. */
function downsampleRGB(rgba, w, h, s) {
  const w2 = Math.ceil(w / s), h2 = Math.ceil(h / s), N2 = w2 * h2;
  const out = [new Float32Array(N2), new Float32Array(N2), new Float32Array(N2)];
  for (let y2 = 0; y2 < h2; y2++) for (let x2 = 0; x2 < w2; x2++) {
    let r = 0, g = 0, b = 0, n = 0;
    const y0 = y2 * s, x0 = x2 * s, y1 = Math.min(h, y0 + s), x1 = Math.min(w, x0 + s);
    for (let y = y0; y < y1; y++) for (let x = x0, p = (y * w + x0) * 4; x < x1; x++, p += 4) { r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++; }
    const o = y2 * w2 + x2, k = 1 / (255 * n);
    out[0][o] = r * k; out[1][o] = g * k; out[2][o] = b * k;
  }
  return { ch: out, w: w2, h: h2 };
}

/** Tamanho do bloco usado nas partes de baixa frequência, conforme o lado maior da imagem. */
export const autoSub = (w, h) => { const L = Math.max(w, h); return L <= 700 ? 1 : L <= 2200 ? 2 : L <= 3400 ? 3 : 4; };

/**
 * Estima o alfa de cada pixel da faixa incerta a partir das cores locais do objeto (F)
 * e do fundo (B): o pixel é uma mistura  C = a·F + (1-a)·B  e a projeção de C na reta F–B dá `a`.
 * Funciona muito bem com fundo liso ou suave (estúdio, parede, céu); onde o fundo é complexo
 * a confiança cai e sobra só o guided filter.
 *
 * As médias locais de F e B são suaves, então são calculadas em resolução reduzida (`sub`);
 * a projeção em si roda pixel a pixel na resolução cheia, que é onde moram os fios finos.
 * Devolve { alpha, conf }, com `conf` (0..1) a confiança da estimativa em cada pixel.
 */
export function colorLineAlpha(rgba, m, w, h, band, sub = 1) {
  const s = Math.max(1, sub), N = w * h;
  const lo = s > 1 ? downsampleRGB(rgba, w, h, s) : { ch: [0, 1, 2].map(c => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c] / 255; return a; }), w, h };
  const w2 = lo.w, h2 = lo.h, N2 = w2 * h2;
  const m2 = s > 1 ? downsample(m, w, h, s).data : m;
  const eB = Math.max(2, Math.round(band / s)), eF = Math.max(1, Math.round(band * 0.55 / s)), R = Math.max(3, Math.round(band * 3 / s));

  const fgBin = new Float32Array(N2), bgBin = new Float32Array(N2);
  for (let i = 0; i < N2; i++) { fgBin[i] = m2[i] >= 0.92 ? 1 : 0; bgBin[i] = m2[i] <= 0.08 ? 1 : 0; }
  const fgE = boxBlur(fgBin, w2, h2, eF), bgE = boxBlur(bgBin, w2, h2, eB);
  const tF = 1 - 0.5 / ((2 * eF + 1) ** 2), tB = 1 - 0.5 / ((2 * eB + 1) ** 2);
  const wf = new Float32Array(N2), wb = new Float32Array(N2);
  for (let i = 0; i < N2; i++) { wf[i] = fgE[i] >= tF ? 1 : 0; wb[i] = bgE[i] >= tB ? 1 : 0; }

  const bwf = boxBlur(wf, w2, h2, R), bwb = boxBlur(wb, w2, h2, R);
  const F = [], B = [], tmp = new Float32Array(N2);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < N2; i++) tmp[i] = lo.ch[c][i] * wf[i];
    F.push(boxBlur(tmp, w2, h2, R));
    for (let i = 0; i < N2; i++) tmp[i] = lo.ch[c][i] * wb[i];
    B.push(boxBlur(tmp, w2, h2, R));
  }

  const alpha = m.slice(), conf = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const row = Math.min(h2 - 1, (y / s) | 0) * w2;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, j = row + Math.min(w2 - 1, (x / s) | 0);
      if (wf[j] || wb[j]) continue;                      // região já segura
      const vf = bwf[j], vb = bwb[j];
      if (vf < 0.015 || vb < 0.015) continue;            // sem amostras próximas
      const p = i * 4;
      const fr = F[0][j] / vf, fg = F[1][j] / vf, fb = F[2][j] / vf;
      const br = B[0][j] / vb, bg = B[1][j] / vb, bb = B[2][j] / vb;
      const dr = fr - br, dg = fg - bg, db = fb - bb, dd = dr * dr + dg * dg + db * db;
      const cd = smoothstep(0.09, 0.26, Math.sqrt(dd));
      if (cd <= 0) continue;
      const cr = rgba[p] / 255 - br, cg = rgba[p + 1] / 255 - bg, cb = rgba[p + 2] / 255 - bb;
      const t = clamp01((cr * dr + cg * dg + cb * db) / dd);
      const er = cr - t * dr, eg = cg - t * dg, eb = cb - t * db;
      const res = Math.sqrt(er * er + eg * eg + eb * eb);
      alpha[i] = t; conf[i] = cd * (1 - smoothstep(0.05, 0.16, res));
    }
  }
  return { alpha, conf, band: eB * s };
}

/**
 * Refina o recorte da IA: snap às bordas reais da foto (guided filter) + alfa por mistura de cores.
 *  strength 0..1 – quanto do refinamento entra no resultado
 *  band      – largura da faixa incerta, em px (o "alcance" do cabelo)
 *  force     – ignora a mistura entre coarse e refinado (usado pelo pincel de cabelo)
 */
export function refineDetail(rgba, m, w, h, o) {
  const s = clamp01(o.strength);
  if (s <= 0) return m;
  const N = w * h, band = Math.max(2, o.band);
  const sub = o.sub || autoSub(w, h);
  const I = luma(rgba, w, h), r = Math.max(2, Math.round(band * 0.6));
  const gf = guidedFilter(I, m, w, h, r, 0.0002 + (1 - s) * 0.004, sub);
  const mm = boxBlur(m, w, h, r);                 // o que o filtro daria sem nenhum contraste na foto
  const { alpha: cl, conf } = colorLineAlpha(rgba, m, w, h, band, sub);

  const out = new Float32Array(N), e = o.force ? 1 : 0.92;
  for (let i = 0; i < N; i++) {
    // só entra o detalhe que a foto realmente tem (gf - mm); em áreas sem contraste fica o recorte da IA
    const snap = clamp01(m[i] + (gf[i] - mm[i]));
    const c = conf[i] * e;
    const ref = snap + (cl[i] - snap) * c;        // borda real + cor local
    out[i] = o.force ? ref : m[i] + (ref - m[i]) * s;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cores do objeto sem a contaminação do fundo (halo)                  */
/* ------------------------------------------------------------------ */

/**
 * Fusão de desfoques (Forte & Pitié, 2021): estima a cor do objeto F em cada pixel semitransparente,
 * tirando a parte que veio do fundo. Devolve 3 Float32Array (R, G, B em 0..1).
 */
export function estimateForeground(rgba, alpha, w, h, rBig, rSmall) {
  const N = w * h;
  const C = [0, 1, 2].map(c => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c] / 255; return a; });
  let F = C.map(a => a.slice()), B = C.map(a => a.slice());
  for (const r of [rBig, rSmall]) {
    const ba = boxBlur(alpha, w, h, r), nF = [], nB = [];
    for (let c = 0; c < 3; c++) {
      const fa = new Float32Array(N), b1a = new Float32Array(N);
      for (let i = 0; i < N; i++) { fa[i] = F[c][i] * alpha[i]; b1a[i] = B[c][i] * (1 - alpha[i]); }
      const bfa = boxBlur(fa, w, h, r), bbb = boxBlur(b1a, w, h, r);
      for (let i = 0; i < N; i++) {                      // reaproveita fa / b1a como saída
        const bF = bfa[i] / (ba[i] + 1e-5), bB = bbb[i] / (1 - ba[i] + 1e-5), a = alpha[i];
        const res = C[c][i] - a * bF - (1 - a) * bB;
        fa[i] = clamp01(bF + a * res); b1a[i] = bB;
      }
      nF.push(fa); nB.push(b1a);
    }
    F = nF; B = nB;
  }
  return F;
}

/**
 * Mesma ideia de estimateForeground, mas as médias suaves (a parte cara) rodam em resolução reduzida
 * e a correção final por pixel roda na cheia. Devolve RGB intercalado (Uint8ClampedArray, 3 por pixel).
 */
export function estimateForegroundRGB(rgba, alpha, w, h, rBig, rSmall, sub = autoSub(w, h)) {
  const N = w * h, out = new Uint8ClampedArray(N * 3), s = Math.max(1, sub);
  if (s === 1) {
    const F = estimateForeground(rgba, alpha, w, h, rBig, rSmall);
    for (let i = 0, p = 0; i < N; i++, p += 3) { out[p] = F[0][i] * 255; out[p + 1] = F[1][i] * 255; out[p + 2] = F[2][i] * 255; }
    return out;
  }
  // passo 1 (raio grande) em resolução reduzida
  const lo = downsampleRGB(rgba, w, h, s), w2 = lo.w, h2 = lo.h, N2 = w2 * h2;
  const a2 = downsample(alpha, w, h, s).data, r = Math.max(1, Math.round(rBig / s));
  const ba = boxBlur(a2, w2, h2, r), F = [], B = [];
  for (let c = 0; c < 3; c++) {
    const fa = new Float32Array(N2), b1a = new Float32Array(N2);
    for (let i = 0; i < N2; i++) { fa[i] = lo.ch[c][i] * a2[i]; b1a[i] = lo.ch[c][i] * (1 - a2[i]); }
    const bfa = boxBlur(fa, w2, h2, r), bbb = boxBlur(b1a, w2, h2, r);
    for (let i = 0; i < N2; i++) {
      const bF = bfa[i] / (ba[i] + 1e-5), bB = bbb[i] / (1 - ba[i] + 1e-5);
      fa[i] = bF; b1a[i] = bB;
    }
    F.push(fa); B.push(b1a);
  }
  // passo 2 (raio pequeno) em resolução cheia, só onde há transparência parcial; o resto é a correção direta
  const rs = Math.max(1, Math.min(2, Math.round(rSmall)));
  const jr = new Int32Array(h), jc = new Int32Array(w);
  for (let y = 0; y < h; y++) jr[y] = Math.min(h2 - 1, (y / s) | 0) * w2;
  for (let x = 0; x < w; x++) jc[x] = Math.min(w2 - 1, (x / s) | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i], p = i * 4, q = i * 3;
      let bF0, bF1, bF2, bB0, bB1, bB2;
      if (a > 0.004 && a < 0.996) {
        let sa = 0, f0 = 0, f1 = 0, f2 = 0, g0 = 0, g1 = 0, g2 = 0, n = 0;
        const y0 = y - rs < 0 ? 0 : y - rs, y1 = y + rs >= h ? h - 1 : y + rs, x0 = x - rs < 0 ? 0 : x - rs, x1 = x + rs >= w ? w - 1 : x + rs;
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const ni = yy * w + xx, an = alpha[ni], j = jr[yy] + jc[xx], bn = 1 - an, np = ni * 4;
          const b0 = B[0][j], b1 = B[1][j], b2 = B[2][j];
          sa += an;
          f0 += clamp01(F[0][j] + an * (rgba[np] / 255 - an * F[0][j] - bn * b0)) * an;
          f1 += clamp01(F[1][j] + an * (rgba[np + 1] / 255 - an * F[1][j] - bn * b1)) * an;
          f2 += clamp01(F[2][j] + an * (rgba[np + 2] / 255 - an * F[2][j] - bn * b2)) * an;
          g0 += b0 * bn; g1 += b1 * bn; g2 += b2 * bn; n++;
        }
        const ma = sa / n, df = ma + 1e-5, db = 1 - ma + 1e-5;
        bF0 = f0 / n / df; bF1 = f1 / n / df; bF2 = f2 / n / df; bB0 = g0 / n / db; bB1 = g1 / n / db; bB2 = g2 / n / db;
      } else {
        const j = jr[y] + jc[x];
        bF0 = F[0][j]; bF1 = F[1][j]; bF2 = F[2][j]; bB0 = B[0][j]; bB1 = B[1][j]; bB2 = B[2][j];
      }
      out[q] = clamp01(bF0 + a * (rgba[p] / 255 - a * bF0 - (1 - a) * bB0)) * 255;
      out[q + 1] = clamp01(bF1 + a * (rgba[p + 1] / 255 - a * bF1 - (1 - a) * bB1)) * 255;
      out[q + 2] = clamp01(bF2 + a * (rgba[p + 2] / 255 - a * bF2 - (1 - a) * bB2)) * 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recorte clássico por cor (fundo liso / chroma key)                  */
/* ------------------------------------------------------------------ */

/** Cor mais comum nas bordas da imagem (mediana por canal). */
export function borderColor(rgba, w, h) {
  const px = [];
  const step = Math.max(1, Math.floor((w + h) / 800));
  const take = i => px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  for (let x = 0; x < w; x += step) { take(x); take((h - 1) * w + x); }
  for (let y = 0; y < h; y += step) { take(y * w); take(y * w + w - 1); }
  const med = c => { const a = px.map(p => p[c]).sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(0), med(1), med(2)];
}

/**
 * Alfa pela distância à cor-chave. `tol` e `soft` em 0..1 (fração da distância máxima RGB).
 * Com `contiguous`, só o fundo ligado ao ponto de partida some (não fura o objeto por dentro).
 */
export function colorKeyAlpha(rgba, w, h, key, tol, soft, contiguous, seed) {
  const N = w * h, out = new Float32Array(N), dist = new Float32Array(N);
  const T = tol * 441.67, S = Math.max(1, soft * 441.67);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = rgba[p] - key[0], g = rgba[p + 1] - key[1], b = rgba[p + 2] - key[2];
    dist[i] = Math.sqrt(r * r + g * g + b * b);
    out[i] = smoothstep(T, T + S, dist[i]);
  }
  if (!contiguous) return out;
  const limit = T + S, reach = new Uint8Array(N), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const push = i => { if (!reach[i] && dist[i] <= limit) { reach[i] = 1; queue[qt++] = i; } };
  if (seed) push(seed[1] * w + seed[0]);
  else { for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); } }
  while (qh < qt) {
    const i = queue[qh++], x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w); if (i < N - w) push(i + w);
  }
  for (let i = 0; i < N; i++) if (!reach[i]) out[i] = 1;
  return out;
}

/** Região contígua de cor parecida a partir de (x, y), com borda suave. Usada pela varinha. */
export function floodRegion(rgba, w, h, x0, y0, tol, edge) {
  const N = w * h, p0 = (y0 * w + x0) * 4, key = [rgba[p0], rgba[p0 + 1], rgba[p0 + 2]];
  const T = tol * 441.67, limit = T, reach = new Uint8Array(N), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const dist = i => { const p = i * 4, r = rgba[p] - key[0], g = rgba[p + 1] - key[1], b = rgba[p + 2] - key[2]; return Math.sqrt(r * r + g * g + b * b); };
  const push = i => { if (!reach[i] && dist(i) <= limit) { reach[i] = 1; queue[qt++] = i; } };
  push(y0 * w + x0);
  while (qh < qt) {
    const i = queue[qh++], x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w); if (i < N - w) push(i + w);
  }
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = reach[i];
  return edge > 0 ? softBlur(f, w, h, edge) : f;
}
