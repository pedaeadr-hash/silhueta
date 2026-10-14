/*
 * Silhueta · vetorizador (PNG/JPG → SVG)
 * Traça máscaras por cor (k-means) ou por limiar e converte os contornos em curvas.
 * Sem DOM: roda na página e no worker do conversor.
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

function boxBlur(ch, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += ch[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc / n; acc += ch[o + Math.min(x + r + 1, w - 1)] - ch[o + Math.max(x - r, 0)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x]; }
  }
  return out;
}

/** Desfoque ponderado pelo alfa (não "suja" as bordas com o transparente). */
function blurRGBA(d, w, h, r) {
  if (r <= 0) return d;
  const N = w * h, R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), A = new Float32Array(N);
  for (let i = 0; i < N; i++) { const p = i * 4, a = d[p + 3]; A[i] = a; R[i] = d[p] * a; G[i] = d[p + 1] * a; B[i] = d[p + 2] * a; }
  const r2 = boxBlur(R, w, h, r), g2 = boxBlur(G, w, h, r), b2 = boxBlur(B, w, h, r), a2 = boxBlur(A, w, h, r);
  const out = new Uint8ClampedArray(d);
  for (let i = 0; i < N; i++) if (a2[i] > 0) { const p = i * 4; out[p] = r2[i] / a2[i]; out[p + 1] = g2[i] / a2[i]; out[p + 2] = b2[i] / a2[i]; }
  return out;
}

/** k-means (k-means++) nas cores dos pixels opacos. */
function kmeans(d, N, k) {
  const idx = [];
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] >= 128) idx.push(i);
  if (!idx.length) return null;
  const step = Math.max(1, Math.floor(idx.length / 24000));
  const S = Math.ceil(idx.length / step), sm = new Float32Array(S * 3);
  for (let j = 0, s = 0; j < idx.length; j += step, s++) { const p = idx[j] * 4; sm[s * 3] = d[p]; sm[s * 3 + 1] = d[p + 1]; sm[s * 3 + 2] = d[p + 2]; }
  const rnd = mulberry32(7), C = new Float32Array(k * 3);
  const f = Math.floor(rnd() * S); C[0] = sm[f * 3]; C[1] = sm[f * 3 + 1]; C[2] = sm[f * 3 + 2];
  const dmin = new Float32Array(S).fill(Infinity);
  let K = 1;
  for (; K < k; K++) {
    let sum = 0; const c = (K - 1) * 3;
    for (let i = 0; i < S; i++) {
      const dr = sm[i * 3] - C[c], dg = sm[i * 3 + 1] - C[c + 1], db = sm[i * 3 + 2] - C[c + 2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < dmin[i]) dmin[i] = dd;
      sum += dmin[i];
    }
    if (sum <= 0) break;
    let r = rnd() * sum, pick = S - 1;
    for (let i = 0; i < S; i++) { r -= dmin[i]; if (r <= 0) { pick = i; break; } }
    C[K * 3] = sm[pick * 3]; C[K * 3 + 1] = sm[pick * 3 + 1]; C[K * 3 + 2] = sm[pick * 3 + 2];
  }
  const nearest = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let c = 0; c < K; c++) { const dr = r - C[c * 3], dg = g - C[c * 3 + 1], db = b - C[c * 3 + 2]; const dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = c; } }
    return best;
  };
  const asg = new Int16Array(S).fill(-1);
  for (let it = 0; it < 16; it++) {
    const acc = new Float64Array(K * 4); let changed = 0;
    for (let i = 0; i < S; i++) {
      const c = nearest(sm[i * 3], sm[i * 3 + 1], sm[i * 3 + 2]);
      if (c !== asg[i]) { changed++; asg[i] = c; }
      acc[c * 4] += sm[i * 3]; acc[c * 4 + 1] += sm[i * 3 + 1]; acc[c * 4 + 2] += sm[i * 3 + 2]; acc[c * 4 + 3]++;
    }
    for (let c = 0; c < K; c++) if (acc[c * 4 + 3]) { const n = acc[c * 4 + 3]; C[c * 3] = acc[c * 4] / n; C[c * 3 + 1] = acc[c * 4 + 1] / n; C[c * 3 + 2] = acc[c * 4 + 2] / n; }
    if (!changed) break;
  }
  const labels = new Int16Array(N).fill(-1), acc = new Float64Array(K * 4);
  for (let i = 0; i < N; i++) {
    const p = i * 4; if (d[p + 3] < 128) continue;
    const c = nearest(d[p], d[p + 1], d[p + 2]);
    labels[i] = c; acc[c * 4] += d[p]; acc[c * 4 + 1] += d[p + 1]; acc[c * 4 + 2] += d[p + 2]; acc[c * 4 + 3]++;
  }
  const colors = [], counts = [];
  for (let c = 0; c < K; c++) { const n = acc[c * 4 + 3]; counts.push(n); colors.push(n ? rgbHex(acc[c * 4] / n, acc[c * 4 + 1] / n, acc[c * 4 + 2] / n) : '#000000'); }
  return { K, labels, colors, counts };
}

function otsu(L) {
  const hist = new Float64Array(256);
  for (let i = 0; i < L.length; i++) hist[clamp(Math.round(L[i]), 0, 255)]++;
  const total = L.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t + 0.5; }
  }
  return Math.round(thr);
}

/** Contorna a máscara pelas arestas dos pixels. Devolve laços fechados [x0,y0,x1,y1,...]. */
function traceMask(mask, w, h, minArea) {
  const W1 = w + 1, bits = new Uint8Array(W1 * (h + 1));
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (!mask[i]) continue;
    const v = y * W1 + x;
    if (y === 0 || !mask[i - w]) bits[v] |= 1;              // topo  → leste
    if (x === w - 1 || !mask[i + 1]) bits[v + 1] |= 2;      // direita → sul
    if (y === h - 1 || !mask[i + w]) bits[v + W1 + 1] |= 4; // base → oeste
    if (x === 0 || !mask[i - 1]) bits[v + W1] |= 8;         // esquerda → norte
  }
  const DV = [1, W1, -1, -W1], loops = [];
  for (let v0 = 0; v0 < bits.length; v0++) {
    while (bits[v0]) {
      const b0 = bits[v0];
      let d = (b0 & 1) ? 0 : (b0 & 2) ? 1 : (b0 & 4) ? 2 : 3;
      let v = v0, area = 0, ok = true;
      const pts = [];
      for (;;) {
        bits[v] &= ~(1 << d);
        const x = v % W1, y = (v - x) / W1;
        pts.push(x, y);
        const nv = v + DV[d], nx = nv % W1, ny = (nv - nx) / W1;
        area += x * ny - nx * y;
        v = nv;
        if (v === v0) break;
        const b = bits[v], r = (d + 1) & 3, l = (d + 3) & 3;
        if (b & (1 << r)) d = r;
        else if (b & (1 << d)) { /* segue reto */ }
        else if (b & (1 << l)) d = l;
        else { ok = false; break; }
      }
      if (ok && Math.abs(area) / 2 >= minArea) loops.push(pts);
    }
  }
  return loops;
}

function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Douglas–Peucker para polígono fechado. */
function simplifyClosed(P, eps) {
  const n = P.length;
  if (n < 5) return P;
  let far = 0, md = -1;
  for (let i = 1; i < n; i++) { const dx = P[i][0] - P[0][0], dy = P[i][1] - P[0][1], dd = dx * dx + dy * dy; if (dd > md) { md = dd; far = i; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const e2 = eps * eps, stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const A = P[a % n], B = P[b % n];
    let mi = -1, mdd = e2;
    for (let i = a + 1; i < b; i++) { const dd = segDist2(P[i], A, B); if (dd > mdd) { mdd = dd; mi = i; } }
    if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]);
  return out;
}

function lineX(A, B, C, D) {
  const rx = B[0] - A[0], ry = B[1] - A[1], sx = D[0] - C[0], sy = D[1] - C[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((C[0] - A[0]) * sy - (C[1] - A[1]) * sx) / den;
  return [A[0] + t * rx, A[1] + t * ry];
}

/** Recupera cantos vivos que viraram um chanfro pequeno. */
function restoreCorners(P) {
  const n = P.length, out = [], used = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const j = (i + 1) % n;
    if (j !== 0) {
      const A = P[(i + n - 1) % n], B = P[i], C = P[j], D = P[(j + 1) % n];
      const bc = Math.hypot(C[0] - B[0], C[1] - B[1]);
      const ab = Math.hypot(B[0] - A[0], B[1] - A[1]), cd = Math.hypot(D[0] - C[0], D[1] - C[1]);
      if (bc < 1.8 && ab > bc * 1.8 && cd > bc * 1.8) {
        const cos = ((B[0] - A[0]) * (D[0] - C[0]) + (B[1] - A[1]) * (D[1] - C[1])) / (ab * cd);
        if (cos < 0.64) {
          const X = lineX(A, B, C, D);
          if (X && Math.hypot(X[0] - B[0], X[1] - B[1]) < 1.6 && Math.hypot(X[0] - C[0], X[1] - C[1]) < 1.6) { out.push(X); used[j] = 1; continue; }
        }
      }
    }
    out.push(P[i]);
  }
  return out;
}

function refine(flat, eps, w, h) {
  const n = flat.length / 2, P = new Array(n);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; P[i] = [(flat[i * 2] + flat[j * 2]) / 2, (flat[i * 2 + 1] + flat[j * 2 + 1]) / 2]; }
  let Q = simplifyClosed(P, eps);
  if (Q.length >= 4) Q = restoreCorners(Q);
  // encosta na borda da imagem o que estiver a meio pixel dela
  for (const p of Q) {
    if (p[0] <= 0.5) p[0] = 0; else if (p[0] >= w - 0.5) p[0] = w;
    if (p[1] <= 0.5) p[1] = 0; else if (p[1] >= h - 0.5) p[1] = h;
  }
  return Q;
}

const fmtN = v => { let t = String(Math.round(v * 10) / 10); if (t.length > 1 && t[0] === '0') t = t.slice(1); return t; };

/** Polígono → path: cantos vivos viram linha, curvas suaves viram Q pelos pontos médios. */
function pathData(P, thr) {
  const n = P.length, smooth = new Uint8Array(n);
  let firstSharp = -1;
  for (let i = 0; i < n; i++) {
    const A = P[(i + n - 1) % n], B = P[i], C = P[(i + 1) % n];
    const ux = B[0] - A[0], uy = B[1] - A[1], vx = C[0] - B[0], vy = C[1] - B[1];
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ang = l ? Math.acos(clamp((ux * vx + uy * vy) / l, -1, 1)) : Math.PI;
    smooth[i] = ang < thr ? 1 : 0;
    if (!smooth[i] && firstSharp < 0) firstSharp = i;
  }
  const mid = i => { const a = P[i], b = P[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  let s = '', last = '';
  const cmd = (c, nums) => { s += (c === last ? ' ' : c) + nums.map(fmtN).join(' '); last = c; };
  if (firstSharp < 0) {
    cmd('M', mid(n - 1));
    for (let i = 0; i < n; i++) cmd('Q', [...P[i], ...mid(i)]);
  } else {
    cmd('M', P[firstSharp]);
    let prevSharp = true;
    for (let k = 1; k < n; k++) {
      const i = (firstSharp + k) % n;
      if (smooth[i]) { if (prevSharp) cmd('L', mid((i + n - 1) % n)); cmd('Q', [...P[i], ...mid(i)]); prevSharp = false; }
      else { cmd('L', P[i]); prevSharp = true; }
    }
  }
  return s + 'Z';
}

export function vectorize(img, mode, o) {
  const w = img.w, h = img.h, N = w * h;
  const d = blurRGBA(img.data, w, h, o.blur | 0);
  let autoThr = 128;
  const eps = 1.6 - o.detail / 100 * 1.25;
  const thr = (10 + o.smooth * 1.2) * Math.PI / 180;
  const layers = [];

  if (mode === 'mono') {
    const mask = new Uint8Array(N);
    if (o.src === 'alpha') {
      for (let i = 0; i < N; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    } else {
      const over = o.src === 'light' ? 0 : 255, L = new Float32Array(N);
      for (let i = 0; i < N; i++) { const p = i * 4, a = d[p + 3] / 255; L[i] = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) * a + over * (1 - a); }
      const t = o.thr == null ? otsu(L) : o.thr;
      autoThr = t;
      for (let i = 0; i < N; i++) mask[i] = (o.src === 'light' ? L[i] > t : L[i] < t) ? 1 : 0;
    }
    layers.push({ color: o.color, mask });
  } else {
    const q = kmeans(d, N, o.colors);
    if (q) {
      const order = [...Array(q.K).keys()].filter(c => q.counts[c] > 0).sort((a, b) => q.counts[b] - q.counts[a]);
      const rank = new Int16Array(q.K).fill(-1);
      order.forEach((c, j) => { rank[c] = j; });
      // camadas empilhadas: cada camada cobre também as de cima → sem frestas entre cores
      order.forEach((c, j) => {
        const mask = new Uint8Array(N);
        for (let i = 0; i < N; i++) { const lb = q.labels[i]; if (lb >= 0 && rank[lb] >= j) mask[i] = 1; }
        layers.push({ color: q.colors[c], mask });
      });
    }
  }

  const traced = [];
  let loopsCount = 0;
  for (const layer of layers) {
    let dstr = '';
    for (const lp of traceMask(layer.mask, w, h, o.speckle)) {
      const P = refine(lp, eps, w, h);
      if (P.length < 3) continue;
      dstr += pathData(P, thr);
      loopsCount++;
    }
    if (dstr) traced.push({ color: layer.color, d: dstr });
  }
  // guarda as camadas traçadas: trocar uma cor da paleta só remonta o SVG, sem retraçar
  const vec = { w, h, layers: traced };
  return { svg: buildVectorSvg(vec, {}), vec, autoThr, stats: { colors: traced.length, shapes: loopsCount, w, h } };
}

export function buildVectorSvg(vec, colorMap) {
  const paths = vec.layers.map(L => `<path fill="${colorMap[L.color] || L.color}" d="${L.d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vec.w} ${vec.h}" fill-rule="evenodd">${paths}</svg>`;
}

