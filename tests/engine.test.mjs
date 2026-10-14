// Testa o acabamento da máscara da IA (sem rodar modelo). Uso:  node tests/engine.test.mjs
import { finishMask, maskStats, halfToFloat } from '../assets/js/engine.js';

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

const N = 100000;
const make = (objVal, bgVal, objFrac = 0.2) => {
  const g = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) g[i] = i < N * objFrac ? objVal : bgVal;
  return g;
};

console.log('Máscara fraca (objeto achado com pouca força, como no relato do menino)');
{
  const g = make(80, 5), r = finishMask(g);
  ok(r.normalized && r.before.p999 === 80, 'detecta a máscara fraca (p99,9 = 80)');
  ok(g[0] >= 250, 'o objeto é esticado para perto de 100%');
  ok(g[N - 1] < 25, 'o fundo continua baixo');
  ok(Math.abs(r.stats.solid - 0.2) < 0.01, 'a área do objeto (20%) é preservada');
}

console.log('Máscara boa e casos extremos');
{
  const g = make(255, 0), r = finishMask(g);
  ok(!r.normalized && g[0] === 255, 'máscara forte não é alterada');
  const f = finishMask(make(120, 118));
  ok(f.before.max - f.before.min < 4, 'máscara chapada é reconhecida (a GPU recua para WASM)');
  const e = finishMask(make(3, 2));
  ok(!e.normalized && e.before.p999 <= 40, 'máscara vazia não é esticada (ruído não vira objeto) e é reconhecida como vazia');
  const tiny = maskStats(make(255, 0, 0.0005));
  ok(tiny.solid < 0.002, 'objeto minúsculo (0,05% da imagem) conta como "não achou"');
}

console.log('Conversão de half-float (tensores fp16 que chegam como Uint16Array)');
{
  ok(halfToFloat(0x3c00) === 1 && halfToFloat(0xc000) === -2 && halfToFloat(0x3800) === 0.5 && halfToFloat(0) === 0, 'valores comuns');
  ok(Number.isNaN(halfToFloat(0x7e00)) && halfToFloat(0x7c00) === Infinity, 'NaN e infinito');
  ok(Math.abs(halfToFloat(0x2e66) - 0.1) < 1e-3, 'fração (0,1)');
}

console.log(failures ? '\n' + failures + ' falha(s)' : '\ntudo certo');
process.exit(failures ? 1 : 0);
