// Valida BMP, GIF, ICO e PDF lendo de volta o que foi escrito (sem depender de navegador).
// Uso:  node tests/encoders.test.mjs
import { encodeBMP, encodeGIF, encodeICO, encodePDF } from '../assets/js/encoders.js';

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

// imagem de teste: degradê + círculo + canto transparente
const W = 96, H = 64;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, inCircle = Math.hypot(x - 48, y - 32) < 20;
  rgba[i] = inCircle ? 230 : x * 255 / W; rgba[i + 1] = inCircle ? 60 : y * 255 / H; rgba[i + 2] = inCircle ? 40 : 160; rgba[i + 3] = (x < 12 && y < 12) ? 0 : 255;
}

console.log('BMP');
{
  const bmp = encodeBMP(rgba, W, H, [255, 255, 255]), dv = new DataView(bmp.buffer);
  ok(bmp[0] === 0x42 && bmp[1] === 0x4d, 'assinatura BM');
  ok(dv.getInt32(18, true) === W && dv.getInt32(22, true) === H, 'dimensões no cabeçalho');
  ok(dv.getUint32(2, true) === bmp.length, 'tamanho do arquivo confere');
  const rowSize = (W * 3 + 3) & ~3, px = (x, y) => { const o = 54 + (H - 1 - y) * rowSize + x * 3; return [bmp[o + 2], bmp[o + 1], bmp[o]]; };
  ok(px(48, 32)[0] === 230 && px(48, 32)[1] === 60, 'pixel do círculo (RGB) correto');
  ok(px(3, 3).every(v => v === 255), 'transparente vira o fundo branco');
}

console.log('GIF');
function decodeGIF(bytes) {
  let p = 6;
  const w = bytes[p] | bytes[p + 1] << 8, h = bytes[p + 2] | bytes[p + 3] << 8, flags = bytes[p + 4]; p += 7;
  const size = 1 << ((flags & 7) + 1), pal = [];
  for (let i = 0; i < size; i++) { pal.push([bytes[p], bytes[p + 1], bytes[p + 2]]); p += 3; }
  let trans = -1;
  while (bytes[p] !== 0x2c) {
    if (bytes[p] === 0x21) { if (bytes[p + 1] === 0xf9 && (bytes[p + 3] & 1)) trans = bytes[p + 6]; p += 2; while (bytes[p]) p += bytes[p] + 1; p++; } else throw new Error('bloco inesperado ' + bytes[p]);
  }
  p += 10;
  const minCode = bytes[p++], data = [];
  while (bytes[p]) { for (let i = 0; i < bytes[p]; i++) data.push(bytes[p + 1 + i]); p += bytes[p] + 1; }
  const clear = 1 << minCode, eoi = clear + 1, out = [];
  let codeSize = minCode + 1, dict = [], next = eoi + 1, bitPos = 0, prev = null;
  const read = () => { let v = 0; for (let i = 0; i < codeSize; i++) { v |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i; bitPos++; } return v; };
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; next = eoi + 1; codeSize = minCode + 1; prev = null; };
  reset();
  for (;;) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (dict[code]) entry = dict[code]; else if (code === next && prev) entry = [...prev, prev[0]]; else throw new Error('código inválido ' + code);
    out.push(...entry);
    if (prev) { dict[next++] = [...prev, entry[0]]; if (next === (1 << codeSize) && codeSize < 12) codeSize++; }
    prev = entry;
  }
  return { w, h, pal, idx: out, trans };
}
{
  for (const dither of [false, true]) {
    const gif = encodeGIF(rgba, W, H, { colors: 64, dither, bg: [255, 255, 255] });
    const g = decodeGIF(gif);
    ok(gif[0] === 0x47 && gif[gif.length - 1] === 0x3b, `dither ${dither}: cabeçalho e trailer`);
    ok(g.w === W && g.h === H && g.idx.length === W * H, `dither ${dither}: dimensões e quantidade de pixels`);
    ok(g.trans === 0 && g.idx[3 * W + 3] === 0, `dither ${dither}: canto transparente usa o índice transparente`);
    let err = 0, n = 0;
    for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] > 0) { const c = g.pal[g.idx[i]]; err += Math.abs(c[0] - rgba[i * 4]) + Math.abs(c[1] - rgba[i * 4 + 1]) + Math.abs(c[2] - rgba[i * 4 + 2]); n++; }
    console.log(`     erro médio por canal: ${(err / n / 3).toFixed(1)}`);
    ok(err / n / 3 < 14, `dither ${dither}: erro de cor baixo com 64 cores`);
  }
  const opaque = new Uint8ClampedArray(rgba); for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  const g2 = decodeGIF(encodeGIF(opaque, W, H, { colors: 16, dither: false }));
  ok(g2.trans === -1 && g2.pal.length <= 16, 'sem transparência não reserva índice e respeita o número de cores');
}

console.log('ICO');
{
  const fake = size => ({ size, bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, size & 255, 1, 2, 3]) });
  const ico = encodeICO([fake(16), fake(32), fake(256)]), dv = new DataView(ico.buffer);
  ok(dv.getUint16(2, true) === 1 && dv.getUint16(4, true) === 3, 'tipo ICO com 3 imagens');
  ok(ico[6] === 16 && ico[22] === 32 && ico[38] === 0, '256 px é gravado como 0');
  ok(ico[dv.getUint32(6 + 12, true)] === 0x89, 'deslocamento aponta para o PNG');
}

console.log('PDF');
{
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  for (const page of ['image', 'a4', 'letter']) {
    const pdf = encodePDF(jpeg, 800, 600, { page }), text = Buffer.from(pdf).toString('latin1');
    ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'), `${page}: cabeçalho e %%EOF`);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
    ok(text.slice(xrefAt, xrefAt + 4) === 'xref', `${page}: startxref aponta para a tabela`);
    const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
    ok(offsets.length === 5 && offsets.every((o, i) => text.slice(o, o + 8).startsWith(`${i + 1} 0 obj`)), `${page}: todos os deslocamentos da xref apontam para o objeto certo`);
    ok(text.includes('/DCTDecode') && pdf.length > jpeg.length, `${page}: imagem JPEG embutida`);
  }
}

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
