// Teste numérico do refinamento com "cabelo" sintético (alfa real conhecido).
// Uso:  node tests/refine.test.mjs
import assert from 'node:assert/strict';
import {
  boxBlur, softBlur, refineDetail, estimateForeground, shiftEdge, cleanup,
  applyLevels, colorKeyAlpha, distanceTo, clamp01, estimateForegroundRGB, autoSub, borderColor
} from '../assets/js/refine.js';

const W = 640, H = 640, N = W * H;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** Cena: cabeça elíptica + fios finos saindo da cabeça, sobre fundo liso em degradê suave. */
function makeScene(bgBase = [214, 222, 232], strandCount = 520) {
  const gt = new Float32Array(N);                // alfa real
  const fgR = new Float32Array(N), fgG = new Float32Array(N), fgB = new Float32Array(N);
  const cx = W / 2, cy = H * 0.56, rx = 150, ry = 190;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    const a = clamp01((1 - d) * rx * 0.5 + 0.5);   // borda suave de ~1px
    const i = y * W + x;
    if (a > 0) { gt[i] = a; fgR[i] = 92; fgG[i] = 58; fgB[i] = 44; }
  }
  // fios: curvas saindo da borda superior da cabeça
  const seg = (x0, y0, x1, y1, th, col) => {
    const minx = Math.max(0, Math.floor(Math.min(x0, x1) - th - 2)), maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + th + 2));
    const miny = Math.max(0, Math.floor(Math.min(y0, y1) - th - 2)), maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + th + 2));
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const t = clamp01(((x - x0) * dx + (y - y0) * dy) / L2);
      const dist = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      const cov = clamp01(th / 2 + 0.5 - dist);
      const i = y * W + x;
      if (cov > gt[i]) { gt[i] = cov; fgR[i] = col[0]; fgG[i] = col[1]; fgB[i] = col[2]; }
    }
  };
  for (let s = 0; s < strandCount; s++) {
    const ang = Math.PI * (1.08 + rnd() * 0.84);          // leque acima da cabeça
    let x = cx + Math.cos(ang) * rx * 0.97, y = cy + Math.sin(ang) * ry * 0.97;
    let dir = ang + (rnd() - 0.5) * 0.5;
    const len = 18 + rnd() * 48, th = 1 + rnd() * 1.1, shade = 0.75 + rnd() * 0.5;
    const col = [92 * shade, 58 * shade, 44 * shade];
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      dir += (rnd() - 0.5) * 0.22;
      const nx = x + Math.cos(dir) * len / steps, ny = y + Math.sin(dir) * len / steps;
      seg(x, y, nx, ny, th, col);
      x = nx; y = ny;
    }
  }
  const rgba = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = gt[i];
    const g = (x / W * 0.5 + y / H * 0.5) * 22;       // fundo com degradê suave
    const br = bgBase[0] - g, bg = bgBase[1] - g, bb = bgBase[2] - g;
    rgba[i * 4] = a * fgR[i] + (1 - a) * br;
    rgba[i * 4 + 1] = a * fgG[i] + (1 - a) * bg;
    rgba[i * 4 + 2] = a * fgB[i] + (1 - a) * bb;
    rgba[i * 4 + 3] = 255;
  }
  return { gt, rgba, bg: bgBase };
}

/** Simula a saída de uma IA: suave, sem os fios finos. */
function fakeCoarse(gt) {
  const b = softBlur(gt, W, H, 7);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = clamp01((b[i] - 0.3) / 0.45);
  return out;
}

/** Erro médio só onde importa: perto da borda da cabeça (inclui o cabelo). */
function edgeError(a, gt) {
  const near = new Uint8Array(N), far = new Uint8Array(N);
  for (let i = 0; i < N; i++) { near[i] = gt[i] > 0.5 ? 0 : 1; far[i] = gt[i] > 0.5 ? 1 : 0; }
  // faixa = pixels a até 70px de um fio ou da cabeça, mas não do miolo
  const dBg = distanceTo(near, W, H), dFg = distanceTo(far, W, H);
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) if ((gt[i] <= 0.5 && dFg[i] <= 70 && dFg[i] > 0) || (gt[i] > 0.5 && dBg[i] <= 8)) { sum += Math.abs(a[i] - gt[i]); n++; }
  return sum / n;
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

console.log('Refinamento com cabelo sintético');
const { gt, rgba } = makeScene();
const coarse = fakeCoarse(gt);
const e0 = edgeError(coarse, gt);
let t0 = performance.now();
const ref = refineDetail(rgba, coarse, W, H, { strength: 0.85, band: 12 });
const tRef = performance.now() - t0;
const e1 = edgeError(ref, gt);
console.log(`     erro da borda: IA ${e0.toFixed(4)}  →  refinado ${e1.toFixed(4)}   (${tRef.toFixed(0)} ms para ${(N / 1e6).toFixed(2)} MP)`);
ok(e1 < e0 * 0.8, 'o refinamento reduz o erro da borda em pelo menos 20%');

// caminho otimizado (médias locais em meia resolução) deve render quase o mesmo
t0 = performance.now();
const refFast = refineDetail(rgba, coarse, W, H, { strength: 0.85, band: 12, sub: 2 });
const tFast = performance.now() - t0;
const eFast = edgeError(refFast, gt);
console.log(`     meia resolução: erro ${eFast.toFixed(4)}  (${tFast.toFixed(0)} ms contra ${tRef.toFixed(0)} ms)`);
ok(eFast < e0 * 0.85 && eFast < e1 * 1.2, 'a versão rápida mantém a qualidade (até 20% do erro da exata)');
ok(tFast < tRef, 'e é mais rápida');

const refMild = refineDetail(rgba, coarse, W, H, { strength: 0.3, band: 12 });
const e2 = edgeError(refMild, gt);
ok(e2 < e0 && e2 > e1 - 1e-6, 'intensidade menor fica entre a IA e o refinado total');

// fundo parecido com o cabelo: a estimativa por cor deve ter pouca confiança e não piorar
const hard = makeScene([110, 80, 64]);
const hardCoarse = fakeCoarse(hard.gt);
const eh0 = edgeError(hardCoarse, hard.gt);
const hardRef = refineDetail(hard.rgba, hardCoarse, W, H, { strength: 0.85, band: 12 });
const eh1 = edgeError(hardRef, hard.gt);
console.log(`     fundo da cor do cabelo: ${eh0.toFixed(4)} → ${eh1.toFixed(4)}`);
ok(eh1 <= eh0 * 1.1, 'com fundo difícil o refinamento não piora mais que 10%');

console.log('Descontaminação de cor');
// pixels de borda misturados com fundo claro: a cor estimada do objeto deve ser mais escura que a mistura
let mixed = 0, estimated = 0, count = 0;
const F = estimateForeground(rgba, gt, W, H, 18, 3);
for (let i = 0; i < N; i++) if (gt[i] > 0.15 && gt[i] < 0.6) {
  mixed += rgba[i * 4] / 255; estimated += F[0][i]; count++;
}
console.log(`     canal R médio nas bordas: mistura ${(mixed / count).toFixed(3)}  →  objeto ${(estimated / count).toFixed(3)}  (real ${(92 / 255).toFixed(3)})`);
ok(Math.abs(estimated / count - 92 / 255 * 0.98) < Math.abs(mixed / count - 92 / 255 * 0.98), 'a cor estimada fica mais perto da cor real do cabelo');

{
  const exact = estimateForeground(rgba, gt, W, H, 18, 3), fast = estimateForegroundRGB(rgba, gt, W, H, 18, 3, 2);
  let dExact = 0, dFast = 0, dMix = 0, n = 0;
  for (let i = 0; i < N; i++) if (gt[i] > 0.15 && gt[i] < 0.6) { dExact += Math.abs(exact[0][i] * 255 - 92); dFast += Math.abs(fast[i * 3] - 92); dMix += Math.abs(rgba[i * 4] - 92); n++; }
  console.log(`     erro de cor nas bordas (canal R): mistura ${(dMix / n).toFixed(1)}  exata ${(dExact / n).toFixed(1)}  rápida ${(dFast / n).toFixed(1)}`);
  ok(dFast / n < dMix / n * 0.3, 'a estimativa rápida remove pelo menos 70% da contaminação de cor');
}
ok(autoSub(640, 640) === 1 && autoSub(1400, 900) === 2 && autoSub(3000, 2000) === 3 && autoSub(4096, 3000) === 4, 'sub-amostragem escolhida pelo tamanho');

console.log('Contrair / expandir');
const hardMask = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hardMask[y * W + x] = (x > 200 && x < 440 && y > 200 && y < 440) ? 1 : 0;
const area = m => m.reduce((s, v) => s + v, 0);
const base = area(hardMask);
ok(area(shiftEdge(hardMask, W, H, -5)) < base - 1500, 'contrair 5px diminui a área');
ok(area(shiftEdge(hardMask, W, H, 5)) > base + 1500, 'expandir 5px aumenta a área');
const shrunk = area(shiftEdge(hardMask, W, H, -5));
ok(Math.abs(shrunk - 230 * 230) / (230 * 230) < 0.06, `contrair 5px dá ~230×230 (obtido ${Math.sqrt(shrunk).toFixed(1)}²)`);

console.log('Limpeza');
const dirty = hardMask.slice();
for (let y = 60; y < 66; y++) for (let x = 60; x < 66; x++) dirty[y * W + x] = 1;       // mancha de 36 px
for (let y = 300; y < 306; y++) for (let x = 300; x < 306; x++) dirty[y * W + x] = 0;   // buraco de 36 px
const cleaned = cleanup(dirty, W, H, { minArea: 100, keepLargest: false, dustReach: 0, fillHoles: true, holeMax: 100 });
ok(cleaned[62 * W + 62] === 0, 'mancha isolada some');
ok(cleaned[302 * W + 302] === 1, 'buraco pequeno é preenchido');
ok(cleaned[250 * W + 250] === 1, 'o objeto principal continua');

console.log('Regiões com a cor do fundo (riscos claros marcados como objeto)');
{
  const w = 800, h = 400, n = w * h, img = new Uint8ClampedArray(n * 4), mask = new Float32Array(n);
  const paint = (x0, y0, x1, y1, c, a = 1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; img[i * 4] = c[0]; img[i * 4 + 1] = c[1]; img[i * 4 + 2] = c[2]; if (a) mask[i] = a; } };
  for (let i = 0; i < n; i++) { img[i * 4] = 248; img[i * 4 + 1] = 248; img[i * 4 + 2] = 250; img[i * 4 + 3] = 255; }
  paint(360, 40, 440, 300, [28, 38, 92]);                 // figura azul-marinho
  paint(360, 306, 400, 340, [250, 250, 250]);             // sapato branco separado por uma fresta de 6 px
  paint(60, 60, 220, 90, [245, 246, 248]);                // risco claro grande, longe: a IA marcou como objeto
  paint(600, 250, 760, 280, [243, 245, 247]);             // outro risco claro
  paint(560, 40, 620, 100, [200, 40, 40]);                // segundo objeto, colorido, longe
  const bg = borderColor(img, w, h);
  const run = o => cleanup(mask, w, h, { minArea: 0, keepLargest: false, dustReach: 0, fillHoles: false, holeMax: 0, ...o });
  const off = run({}), on = run({ bgLike: { rgba: img, color: bg, protect: 20 } });
  const at = (m, x, y) => m[y * w + x];
  ok(at(off, 100, 70) === 1, 'sem a regra, o risco claro continua (o problema relatado)');
  ok(at(on, 100, 70) === 0 && at(on, 700, 260) === 0, 'com a regra, os riscos claros somem');
  ok(at(on, 400, 150) === 1, 'a figura continua');
  ok(at(on, 380, 320) === 1, 'o sapato branco separado por fresta é protegido');
  ok(at(on, 590, 70) === 1, 'um segundo objeto colorido continua');
}

console.log('Níveis e cor-chave');
ok(applyLevels(coarse, 0.5, 0) === coarse, 'níveis padrão não alteram nada');
const keyed = colorKeyAlpha(rgba, W, H, [214, 222, 232], 0.12, 0.08, true);
ok(keyed[5 * W + 5] < 0.05 && keyed[(H * 0.56 | 0) * W + W / 2] > 0.95, 'cor-chave remove o fundo e mantém a cabeça');

console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
process.exit(failures ? 1 : 0);
