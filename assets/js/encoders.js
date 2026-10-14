/*
 * Silhueta · codificadores de formatos que o navegador não gera sozinho: BMP, GIF, ICO e PDF.
 * Recebem pixels RGBA (Uint8ClampedArray) ou bytes já codificados e devolvem Uint8Array.
 */

const clampByte = v => (v < 0 ? 0 : v > 255 ? 255 : v);

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

/** Compõe o pixel (r,g,b,a) sobre a cor de fundo. */
const over = (c, a, bg) => c * (a / 255) + bg * (1 - a / 255);

/* ------------------------------------------------------------------ BMP (24 bits) */

export function encodeBMP(rgba, w, h, bg = [255, 255, 255]) {
  const rowSize = (w * 3 + 3) & ~3, dataSize = rowSize * h, total = 54 + dataSize;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, total, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, dataSize, true);
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * rowSize;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) {
      const a = rgba[p + 3];
      out[o++] = over(rgba[p + 2], a, bg[2]); out[o++] = over(rgba[p + 1], a, bg[1]); out[o++] = over(rgba[p], a, bg[0]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ ICO (PNG dentro do contêiner) */

/** images: [{ size, bytes (PNG) }] */
export function encodeICO(images) {
  const n = images.length, head = 6 + 16 * n;
  const total = head + images.reduce((s, i) => s + i.bytes.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, n, true);
  let off = head;
  images.forEach((img, k) => {
    const e = 6 + 16 * k;
    out[e] = img.size >= 256 ? 0 : img.size; out[e + 1] = img.size >= 256 ? 0 : img.size;
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, img.bytes.length, true); dv.setUint32(e + 12, off, true);
    out.set(img.bytes, off); off += img.bytes.length;
  });
  return out;
}

/* ------------------------------------------------------------------ GIF (quadro único) */

/** Corte mediano sobre histograma de 15 bits. Devolve paleta [[r,g,b], ...] com até `max` cores. */
function medianCut(hist, max) {
  const idx = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) idx.push(i);
  if (!idx.length) return [[0, 0, 0]];
  const make = list => {
    let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0, pop = 0;
    for (const c of list) {
      const r = c >> 10, g = c >> 5 & 31, b = c & 31;
      if (r < r0) r0 = r; if (r > r1) r1 = r; if (g < g0) g0 = g; if (g > g1) g1 = g; if (b < b0) b0 = b; if (b > b1) b1 = b;
      pop += hist[c];
    }
    return { list, r: r1 - r0, g: g1 - g0, b: b1 - b0, pop };
  };
  const boxes = [make(idx)];
  while (boxes.length < max) {
    let best = -1, score = 0;
    boxes.forEach((bx, i) => { const s = Math.max(bx.r, bx.g, bx.b) * (bx.list.length > 1 ? 1 : 0) * Math.sqrt(bx.pop); if (s > score) { score = s; best = i; } });
    if (best < 0) break;
    const bx = boxes[best], axis = bx.r >= bx.g && bx.r >= bx.b ? 10 : bx.g >= bx.b ? 5 : 0;
    const sorted = bx.list.slice().sort((p, q) => ((p >> axis) & 31) - ((q >> axis) & 31));
    let acc = 0, cut = 0;
    for (; cut < sorted.length - 1; cut++) { acc += hist[sorted[cut]]; if (acc >= bx.pop / 2) break; }
    cut = Math.min(sorted.length - 2, cut);
    boxes.splice(best, 1, make(sorted.slice(0, cut + 1)), make(sorted.slice(cut + 1)));
  }
  return boxes.map(bx => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const c of bx.list) { const k = hist[c]; r += (c >> 10) * k; g += (c >> 5 & 31) * k; b += (c & 31) * k; n += k; }
    const f = v => { const q = Math.round(v / n); return (q << 3) | (q >> 2); };
    return [f(r), f(g), f(b)];
  });
}

function lzwEncode(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let codeSize = minCode + 1, next = eoi + 1, table = new Map(), cur = 0, shift = 0;
  const emit = code => {
    cur |= code << shift; shift += codeSize;
    while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k, hit = table.get(key);
    if (hit === undefined) {
      emit(prefix);
      if (next === 4096) { emit(clear); next = eoi + 1; codeSize = minCode + 1; table = new Map(); }
      else { if (next >= (1 << codeSize)) codeSize++; table.set(key, next++); }
      prefix = k;
    } else prefix = hit;
  }
  emit(prefix); emit(eoi);
  if (shift > 0) out.push(cur & 255);
  return out;
}

/**
 * GIF de um quadro. `colors` 2..256; `dither` liga Floyd–Steinberg.
 * Se houver pixels transparentes, o índice 0 vira a cor transparente (GIF só tem transparência de 1 bit).
 */
export function encodeGIF(rgba, w, h, { colors = 256, dither = true, bg = [255, 255, 255] } = {}) {
  const N = w * h;
  let hasAlpha = false;
  for (let i = 3; i < N * 4; i += 4) if (rgba[i] < 128) { hasAlpha = true; break; }

  // pixels já compostos sobre o fundo (os opacos de verdade ficam como estão)
  const px = new Uint8ClampedArray(N * 3), transparent = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const a = rgba[p + 3];
    if (hasAlpha && a < 128) { transparent[i] = 1; px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; continue; }
    const t = hasAlpha ? 255 : a;
    px[i * 3] = over(rgba[p], t, bg[0]); px[i * 3 + 1] = over(rgba[p + 1], t, bg[1]); px[i * 3 + 2] = over(rgba[p + 2], t, bg[2]);
  }

  const reserve = hasAlpha ? 1 : 0, maxColors = Math.max(2, Math.min(256, colors)) - reserve;
  const hist = new Uint32Array(32768);
  for (let i = 0; i < N; i++) if (!transparent[i]) hist[(px[i * 3] >> 3) << 10 | (px[i * 3 + 1] >> 3) << 5 | (px[i * 3 + 2] >> 3)]++;
  const pal = medianCut(hist, maxColors);
  const palette = hasAlpha ? [[0, 0, 0], ...pal] : pal;

  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = (clampByte(r) >> 3) << 10 | (clampByte(g) >> 3) << 5 | (clampByte(b) >> 3);
    let v = cache[key];
    if (v >= 0) return v;
    let best = reserve, bd = Infinity;
    const rr = (key >> 10) << 3 | 4, gg = (key >> 5 & 31) << 3 | 4, bb = (key & 31) << 3 | 4;
    for (let k = reserve; k < palette.length; k++) {
      const dr = rr - palette[k][0], dg = gg - palette[k][1], db = bb - palette[k][2], d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = k; }
    }
    return (cache[key] = best);
  };

  const idx = new Uint8Array(N);
  if (dither && palette.length > 2) {
    const er = new Float32Array((w + 2) * 2), eg = new Float32Array((w + 2) * 2), eb = new Float32Array((w + 2) * 2);
    for (let y = 0; y < h; y++) {
      const cur = (y & 1) * (w + 2), nxt = ((y + 1) & 1) * (w + 2);
      er.fill(0, nxt, nxt + w + 2); eg.fill(0, nxt, nxt + w + 2); eb.fill(0, nxt, nxt + w + 2);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (transparent[i]) { idx[i] = 0; continue; }
        const r = px[i * 3] + er[cur + x + 1], g = px[i * 3 + 1] + eg[cur + x + 1], b = px[i * 3 + 2] + eb[cur + x + 1];
        const k = nearest(r, g, b); idx[i] = k;
        const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2];
        er[cur + x + 2] += dr * 7 / 16; eg[cur + x + 2] += dg * 7 / 16; eb[cur + x + 2] += db * 7 / 16;
        er[nxt + x] += dr * 3 / 16; eg[nxt + x] += dg * 3 / 16; eb[nxt + x] += db * 3 / 16;
        er[nxt + x + 1] += dr * 5 / 16; eg[nxt + x + 1] += dg * 5 / 16; eb[nxt + x + 1] += db * 5 / 16;
        er[nxt + x + 2] += dr / 16; eg[nxt + x + 2] += dg / 16; eb[nxt + x + 2] += db / 16;
      }
    }
  } else for (let i = 0; i < N; i++) idx[i] = transparent[i] ? 0 : nearest(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]);

  let bits = 1; while ((1 << bits) < palette.length) bits++;
  const size = 1 << bits, minCode = Math.max(2, bits);
  const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0x80 | 0x70 | (bits - 1), 0, 0];
  for (let k = 0; k < size; k++) { const c = palette[k] || [0, 0, 0]; bytes.push(c[0], c[1], c[2]); }
  if (hasAlpha) bytes.push(0x21, 0xf9, 0x04, 0x01, 0, 0, 0, 0);
  bytes.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, minCode);
  const lzw = lzwEncode(idx, minCode);
  for (let i = 0; i < lzw.length; i += 255) { const n = Math.min(255, lzw.length - i); bytes.push(n); for (let k = 0; k < n; k++) bytes.push(lzw[i + k]); }
  bytes.push(0, 0x3b);
  return Uint8Array.from(bytes);
}

/* ------------------------------------------------------------------ PDF (uma página, imagem JPEG) */

const PAGES = { a4: [595.28, 841.89], letter: [612, 792] };

/**
 * jpeg: bytes JPEG; (w,h) em px. page: 'image' (página do tamanho da imagem), 'a4' ou 'letter' (imagem ajustada e centralizada).
 */
export function encodePDF(jpeg, w, h, { page = 'image', margin = 28 } = {}) {
  let pw, ph, x, y, iw, ih;
  if (page === 'image') { pw = w * 0.75; ph = h * 0.75; x = 0; y = 0; iw = pw; ih = ph; }
  else {
    let [a, b] = PAGES[page] || PAGES.a4;
    if (w > h) [a, b] = [b, a];                                   // paisagem para imagem larga
    pw = a; ph = b;
    const s = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h);
    iw = w * s; ih = h * s; x = (pw - iw) / 2; y = (ph - ih) / 2;
  }
  const f = v => v.toFixed(2);
  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = chunk => { const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg); push('\nendstream\nendobj\n');
  const content = `q ${f(iw)} 0 0 ${f(ih)} ${f(x)} ${f(y)} cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
