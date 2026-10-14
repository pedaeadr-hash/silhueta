/*
 * Silhueta · motor de IA
 *
 * Carrega os modelos com transformers.js direto do Hugging Face, sempre no navegador (nada é enviado).
 * Na primeira vez o modelo é baixado e fica no cache do navegador; depois abre na hora.
 *
 *   portrait  MODNet       Apache-2.0   ~26 MB   retrato com matting de cabelo
 *   general   BiRefNet lite MIT         ~94 MB (WebGPU, fp16) ou ~183 MB (WASM, fp32), entrada 512×512
 *             (as variantes de 1024 px estouram a memória do onnxruntime-web; o refinamento recupera o detalhe)
 *
 *   hq / hqPortrait  BiRefNet completo em 1024 px no Silhueta Servidor (C#, roda no PC do usuário), opcional; ver runServer
 */

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_INPUT = 1536;     // lado maior da imagem enviada ao modelo
const PROXY = typeof location === 'undefined' || new URLSearchParams(location.search).get('proxy') !== '0';   // ?proxy=0 desliga (diagnóstico)

let libPromise = null;
let gpuPromise = null;
const loaded = new Map();
const noGpu = new Set();      // modelos que falharam em WebGPU nesta sessão: daqui em diante só WASM
let gpuDisabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('gpu') === '0';

/** Força (ou libera) o uso só do processador. Descarta os modelos já carregados em WebGPU. */
export function setGpuDisabled(v) {
  gpuDisabled = !!v;
  for (const [k, entry] of [...loaded]) if (entry.device === 'webgpu') loaded.delete(k);
}
export const isGpuDisabled = () => gpuDisabled;

export function webgpuAvailable() {
  if (!gpuPromise) {
    gpuPromise = (async () => {
      try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
    })();
  }
  return gpuPromise;
}

async function lib() {
  if (!libPromise) {
    libPromise = import(LIB_URL).then(mod => {
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      // roda o ONNX Runtime num worker próprio para a página continuar fluida durante a inferência
      try { mod.env.backends.onnx.wasm.proxy = PROXY; } catch { /* versão sem essa opção */ }
      return mod;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

export const MODELS = {
  portrait: {
    key: 'portrait', name: 'MODNet', label: 'Pessoas e cabelo', repo: 'Xenova/modnet', license: 'Apache-2.0',
    size: () => '26 MB', input: 'input'
  },
  general: {
    key: 'general', name: 'BiRefNet lite', label: 'Objetos e produtos', repo: 'studioludens/birefnet-lite-512', license: 'MIT',
    size: gpu => (gpu ? '94 MB' : '183 MB'), input: 'input_image'
  }
};

/** Modo "automático": objetos se der para usar a GPU; senão o modelo leve de pessoas. */
export async function resolveMode(mode) {
  if (mode !== 'auto') return mode;
  return (await webgpuAvailable()) && !gpuDisabled ? 'general' : 'portrait';
}

export const isLoaded = key => loaded.has(key);

/** Junta os eventos de download de vários arquivos em um só progresso. */
function progressTracker(onProgress) {
  const files = new Map();
  return ev => {
    if (!ev || !onProgress) return;
    if (ev.status === 'progress' && ev.total) {
      files.set(ev.file, { loaded: ev.loaded, total: ev.total });
      let l = 0, t = 0;
      for (const f of files.values()) { l += f.loaded; t += f.total; }
      onProgress({ phase: 'download', loaded: l, total: t, file: ev.file });
    } else if (ev.status === 'ready') onProgress({ phase: 'ready' });
  };
}

async function loadModel(key, onProgress) {
  if (loaded.has(key)) return loaded.get(key);
  const spec = MODELS[key], T = await lib(), gpu = await webgpuAvailable();
  const cb = progressTracker(onProgress);
  const attempts = key === 'general' && gpu && !gpuDisabled && !noGpu.has(key)
    ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'wasm', dtype: 'fp32' }]
    : [{ device: 'wasm', dtype: 'fp32' }];

  let lastError;
  for (const opt of attempts) {
    try {
      const model = await T.AutoModel.from_pretrained(spec.repo, { ...opt, progress_callback: cb });
      const processor = await T.AutoProcessor.from_pretrained(spec.repo);
      const entry = { model, processor, T, device: opt.device, dtype: opt.dtype };
      loaded.set(key, entry);
      return entry;
    } catch (err) { lastError = err; console.warn(`[silhueta] ${spec.name} em ${opt.device} falhou`, err); }
  }
  throw lastError;
}

export function modelStatus(key) {
  const e = loaded.get(key);
  return e ? { device: e.device, dtype: e.dtype } : null;
}

/** Reduz a imagem enviada ao modelo (o refinamento volta a usar a foto em tamanho cheio). */
function toInput(source, T) {
  const w0 = source.width, h0 = source.height, s = Math.min(1, MAX_INPUT / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return new T.RawImage(d.data, w, h, 4);
}

const sigmoid = x => 1 / (1 + Math.exp(-x));

/** Half-float (16 bits) → número. O ONNX Runtime às vezes entrega tensores fp16 como Uint16Array com os bits crus. */
export function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function toFloat32(data, type) {
  if (data instanceof Float32Array) return data;
  if (type === 'float16' && data instanceof Uint16Array) { const f = new Float32Array(data.length); for (let i = 0; i < f.length; i++) f[i] = halfToFloat(data[i]); return f; }
  return Float32Array.from(data);
}

/** Estatísticas da máscara: força (p99,9), quanto da imagem é objeto (≥50%), mínimo e máximo. */
export function maskStats(gray) {
  const n = gray.length, hist = new Uint32Array(256);
  let solid = 0;
  for (let i = 0; i < n; i++) { const v = gray[i]; hist[v]++; if (v >= 128) solid++; }
  let min = 0; while (min < 255 && !hist[min]) min++;
  let max = 255; while (max > 0 && !hist[max]) max--;
  let acc = 0, p999 = 255;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.001) { p999 = v; break; } }
  return { solid: solid / n, p999, min, max };
}

/**
 * Acabamento da máscara (0..255): se o objeto foi achado mas com pouca força (p99,9 entre 40 e 225),
 * estica os valores para chegar perto de 255. Devolve as estatísticas antes e depois.
 */
export function finishMask(gray) {
  const before = maskStats(gray);
  let stats = before, normalized = false;
  if (before.p999 > 40 && before.p999 < 225) {
    const k = 255 / before.p999;
    for (let i = 0; i < gray.length; i++) gray[i] = Math.min(255, gray[i] * k);
    stats = maskStats(gray); normalized = true;
  }
  return { before, stats, normalized };
}

/**
 * Roda o modelo e devolve a máscara em tons de cinza no tamanho de saída do modelo.
 * `source` é um canvas ou ImageBitmap com a foto.
 *
 * Duas proteções contra GPUs que erram em silêncio:
 *  - máscara fraca (objeto detectado com pouca força): é esticada para chegar perto de 100%;
 *  - máscara chapada, com NaN ou sem objeto algum vinda da WebGPU: repete uma vez em WASM.
 */
export async function runModel(key, source, onProgress) {
  const entry = await loadModel(key, onProgress);
  const { model, processor, T } = entry;
  onProgress && onProgress({ phase: 'run' });

  try {
    const image = toInput(source, T);
    const { pixel_values } = await processor(image);
    const outputs = await model({ [MODELS[key].input]: pixel_values });
    const out = outputs.logits || outputs.output_image || outputs.output || Object.values(outputs)[0];

    const dims = out.dims, h = dims[dims.length - 2], w = dims[dims.length - 1];
    const data = toFloat32(await out.data, out.type), n = w * h;
    const gray = new Uint8ClampedArray(n);
    // BiRefNet devolve logits; MODNet já devolve 0..1
    if (key === 'general') for (let i = 0; i < n; i++) gray[i] = sigmoid(data[i]) * 255 + 0.5;
    else for (let i = 0; i < n; i++) gray[i] = data[i] * 255 + 0.5;
    try { pixel_values.dispose && pixel_values.dispose(); } catch { /* ignore */ }

    let nan = false;
    for (let i = 0; i < n; i += 97) if (Number.isNaN(data[i])) { nan = true; break; }
    const { before, stats, normalized } = finishMask(gray);        // objeto achado com pouca força é esticado
    if (entry.device === 'webgpu' && (nan || before.max - before.min < 4 || before.p999 <= 40)) throw new Error('máscara inválida vinda da GPU');
    if (entry.device === 'webgpu' && stats.solid < 0.002) throw new Error('GPU não encontrou objeto');
    console.info('[silhueta] máscara', key, entry.device, entry.dtype, { objeto: +(stats.solid * 100).toFixed(1) + '%', p999: stats.p999, esticada: normalized });
    return { data: gray, w, h, device: entry.device, stats: { solid: stats.solid, normalized } };
  } catch (err) {
    if (entry.device !== 'webgpu') throw err;
    console.warn('[silhueta] WebGPU falhou na inferência; repetindo em WASM', err);
    noGpu.add(key); loaded.delete(key);
    return runModel(key, source, onProgress);
  }
}

/* ------------------------------------------------------------------ servidor local (alta precisão)
 *
 * Opcional: o Silhueta Servidor (repositório separado, em C#) roda o BiRefNet completo em 1024 px no computador
 * de quem está usando o site. "localhost" é sempre a máquina do próprio visitante: cada um usa o seu servidor.
 * A foto vai só para esse endereço; o resultado entra no mesmo refinamento do navegador.
 */

export const SERVER_DEFAULT = 'http://localhost:5174';
/** Onde baixar o servidor pronto (troque se o repositório tiver outro nome ou dono). */
export const SERVER_DOWNLOAD = 'https://github.com/pedaeadr-hash/silhueta-servidor/releases/latest';
export const SERVER_MODELS = {
  hq: { key: 'hq', name: 'BiRefNet 1024', remote: 'general', label: 'Servidor local · uso geral', license: 'MIT', server: true },
  hqPortrait: { key: 'hqPortrait', name: 'BiRefNet retrato 1024', remote: 'portrait', label: 'Servidor local · retratos', license: 'MIT', server: true }
};
Object.assign(MODELS, SERVER_MODELS);

const server = { on: false, url: '', health: null };
const serverStatus = new Map();

export function configureServer({ on, url } = {}) {
  if (on != null) server.on = !!on;
  if (url != null) server.url = String(url).trim();
}
export const serverOn = () => server.on;
export const serverBase = () => (server.url || SERVER_DEFAULT).replace(/\/+$/, '');
export const lastHealth = () => server.health;

/** Consulta /api/health. Devolve o JSON ou null (fora do ar, outra coisa no endereço, CORS recusado). */
export async function probeServer(base = serverBase(), ms = 2000) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    const ok = j && j.app === 'silhueta-server' ? j : null;
    if (base === serverBase()) server.health = ok;
    return ok;
  } catch { if (base === serverBase()) server.health = null; return null; } finally { clearTimeout(timer); }
}

/** O site está sendo servido pelo próprio servidor em C#? (ele marca as páginas com Server-Timing: silhueta-server) */
let sameOrigin = null;
export function sameOriginServer() {
  if (sameOrigin) return sameOrigin;
  let marked = false;
  try { marked = performance.getEntriesByType('navigation')[0]?.serverTiming?.some(t => t.name === 'silhueta-server') || false; } catch { /* navegador sem Server-Timing */ }
  sameOrigin = marked ? probeServer(location.origin, 3000).then(j => (j ? location.origin : null)) : Promise.resolve(null);
  return sameOrigin;
}

export const serverModelStatus = key => serverStatus.get(key) || null;

/**
 * Envia a foto (já no tamanho do modelo, 1024×1024, sobre branco) e recebe a máscara.
 * Enquanto espera, acompanha /api/health para mostrar o download ou o carregamento do modelo.
 */
export async function runServer(key, source, onProgress) {
  const spec = SERVER_MODELS[key], base = serverBase();
  const health = await probeServer(base);
  if (!health) throw new Error(`Servidor local não encontrado em ${base}`);
  const info = health.models.find(m => m.id === spec.remote);
  if (!info) throw new Error(`O servidor não tem o modelo ${spec.remote}`);

  const size = info.inputSize || 1024;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;

  const t0 = performance.now();
  const report = m => {
    if (!onProgress || !m) return;
    const elapsed = Math.round((performance.now() - t0) / 1000);
    if (m.state === 'downloading' || m.state === 'verifying') onProgress({ phase: 'download', loaded: m.downloaded, total: m.total, server: true, verifying: m.state === 'verifying' });
    else if (m.state === 'loading' || m.state === 'downloaded' || m.state === 'missing') onProgress({ phase: 'loading', server: true });
    else onProgress({ phase: 'run', server: true, device: m.device, elapsed });
  };
  report(info);
  let polling = true;
  const poll = (async () => {
    while (polling) {
      await new Promise(r => setTimeout(r, 1000));
      if (!polling) break;
      const h = await probeServer(base, 1500);
      if (polling && h) report(h.models.find(m => m.id === spec.remote));
    }
  })();

  let res;
  try {
    res = await fetch(`${base}/api/matte?model=${encodeURIComponent(spec.remote)}&w=${size}&h=${size}`, {
      method: 'POST', body: pixels, headers: { 'Content-Type': 'application/octet-stream' }, cache: 'no-store'
    });
  } finally { polling = false; }
  poll.catch(() => {});
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const t = await res.text(); try { msg = JSON.parse(t).detail || t; } catch { msg = t || msg; } } catch { /* ignore */ }
    throw new Error(`Servidor local: ${msg}`);
  }
  const w = Number(res.headers.get('X-Mask-Width')), h = Number(res.headers.get('X-Mask-Height'));
  const gray = new Uint8ClampedArray(await res.arrayBuffer());
  if (!w || !h || gray.length !== w * h) throw new Error('Servidor local: resposta em formato inesperado');
  const { stats, normalized } = finishMask(gray);
  const device = res.headers.get('X-Device') || 'cpu', ms = Number(res.headers.get('X-Elapsed-Ms')) || 0;
  serverStatus.set(key, { device, ms });
  console.info('[silhueta] máscara', key, 'servidor', device, { objeto: +(stats.solid * 100).toFixed(1) + '%', ms, esticada: normalized });
  return { data: gray, w, h, device, stats: { solid: stats.solid, normalized } };
}
