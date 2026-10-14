/*
 * Silhueta · estúdio de remoção de fundo
 *
 *  arquivo ─▶ item (prévia + original) ─▶ IA (main) ─▶ máscara bruta ─▶ worker (refino, bordas, cores)
 *                                                                   └▶ pincéis (main, tempo real) ─▶ composição ─▶ tela / exportação
 */
import { $, $$, el, clamp, toast, mountHeader, mountAmbient, paintRange, formatBytes, baseName, downloadBlob, copyImage, pickFiles, acceptDrops, decodeImage } from './ui.js';
import { icon } from './icons.js';
import { MATTE_DEFAULTS, fillSubject, alphaBounds } from './pipeline.js';
import { rasterizeStrokes, strokeSegment, stamp, applyMask } from './edits.js';
import { floodRegion, borderColor } from './refine.js';
import { Viewport, isTyping } from './viewport.js';
import { LOOK_DEFAULTS, composeScene, frameFor, resizeCanvas, encodeCanvas, makeCanvas } from './compose.js';
import * as engine from './engine.js';
import { makeZip } from './zip.js';
import { mountLanding } from './landing.js';

const PREV_MAX = 1400;      // lado maior da prévia interativa
const FULL_MAX = 4096;      // lado maior que mantemos do original
const clone = o => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ preferências */
const prefs = (() => { try { return JSON.parse(localStorage.getItem('silhueta.prefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('silhueta.prefs', JSON.stringify(prefs)); } catch { /* ignore */ } };

/* ------------------------------------------------------------------ estado */
const S = { items: [], active: null, tool: 'move', brush: { size: prefs.brushSize || 44, hard: prefs.brushHard ?? 55 }, wandTol: prefs.wandTol || 14, uid: 0 };
const activeItem = () => S.items.find(i => i.id === S.active) || null;
const byId = id => S.items.find(i => i.id === id);
let vp = null;

const dom = {};
const FMT = {
  threshold: v => (Number(v) === 50 ? 'IA' : v), shift: v => `${v > 0 ? '+' : ''}${v} px`, feather: v => `${v} px`, decontam: v => `${v}%`,
  islands: v => (Number(v) === 0 ? 'desligado' : v), 'key.tol': v => `${v}%`, 'key.soft': v => `${v}%`,
  'bg.blur': v => `${v} px`, 'bg.angle': v => `${v}°`, 'shadow.opacity': v => `${v}%`, 'shadow.blur': v => `${v} px`, 'shadow.x': v => `${v} px`, 'shadow.y': v => `${v} px`,
  'outline.width': v => `${v} px`, 'frame.margin': v => `${v}%`, 'out.quality': v => `${v}%`
};
const isLookPath = p => /^(bg|shadow|outline|frame|out)\./.test(p);
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
const target = (it, p) => (isLookPath(p) ? it.look : it.params);

/* ------------------------------------------------------------------ worker */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const jobs = new Map();
let jobSeq = 0;
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'matte') onMatte(m);
  else if (m.type === 'hair') { const it = byId(m.id); if (it && it.hairReq && it.hairReq.seq === m.seq) { it.hair = m.data; it.hairReq.resolve(); it.hairReq = null; } }
  else if (m.type === 'export') { jobs.get(m.job)?.resolve(m); jobs.delete(m.job); }
  else if (m.type === 'progress') jobs.get(m.job)?.onProgress?.(m.stage);
  else if (m.type === 'error') {
    console.error('[silhueta] worker:', m.message);
    if (m.job && jobs.has(m.job)) { jobs.get(m.job).reject(new Error(m.message)); jobs.delete(m.job); }
    else toast('Algo falhou no processamento. Tente de novo ou reduza o tamanho da imagem.', { error: true });
    setWorking(false);
  }
};
worker.onerror = e => { console.error(e); toast('O processador de imagem não carregou. Atualize a página.', { error: true }); };

/* ------------------------------------------------------------------ itens */
async function makeItem(file) {
  const d = await decodeImage(file, FULL_MAX);
  const s = Math.min(1, PREV_MAX / Math.max(d.width, d.height));
  const pw = Math.max(1, Math.round(d.width * s)), ph = Math.max(1, Math.round(d.height * s));
  const canvas = makeCanvas(pw, ph), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, ph);          // PNG com transparência: achata sobre branco
  ctx.drawImage(d.bitmap, 0, 0, pw, ph);
  const rgba = ctx.getImageData(0, 0, pw, ph).data;

  const tc = makeCanvas(120, Math.max(1, Math.round(120 * ph / pw)));
  tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);

  const look = clone(LOOK_DEFAULTS);
  Object.assign(look.out, prefs.out || {});
  return {
    id: ++S.uid, name: d.name, bitmap: d.bitmap, fw: d.width, fh: d.height, pw, ph,
    prev: { canvas, rgba }, thumb: tc.toDataURL('image/jpeg', 0.7),
    params: clone(MATTE_DEFAULTS), look, bgImage: null, bgImageName: '',
    coarse: {}, coarseKey: null, sent: false, seq: 0, status: 'new',
    matte: null, hair: null, hairReq: null, strokes: [], redo: [], edits: null, subImage: null, subCanvas: null, subCtx: null, boundsCache: null
  };
}

function sendItem(it) {
  if (it.sent) return;
  const coarse = it.coarseKey ? { ...it.coarse[it.coarseKey], data: it.coarse[it.coarseKey].data.slice() } : null;
  const rgba = it.prev.rgba.slice();
  worker.postMessage({ type: 'set', id: it.id, rgba, w: it.pw, h: it.ph, coarse }, coarse ? [rgba.buffer, coarse.data.buffer] : [rgba.buffer]);
  it.sent = true;
}

/* ------------------------------------------------------------------ detecção (IA) */
let detectChain = Promise.resolve();
const queueDetect = (it, force) => { detectChain = detectChain.then(() => detect(it, force)).catch(err => console.error(err)); return detectChain; };

function showBusy(title, sub, pct) {
  dom.busyCard.hidden = false;
  dom.busyTitle.textContent = title; dom.busySub.textContent = sub || '';
  const bar = dom.busyBar, i = bar.firstElementChild;
  bar.classList.toggle('indeterminate', pct == null);
  i.style.width = pct == null ? '' : `${Math.round(pct * 100)}%`;
}
const hideBusy = () => { dom.busyCard.hidden = true; };

function setStatus(text, busy) {
  dom.statusText.textContent = text;
  dom.statusChip.classList.toggle('busy', !!busy);
}
function setWorking(on) { dom.working.hidden = !on; }

async function detect(it, force = false) {
  const P = it.params;
  sendItem(it);
  it.status = 'detecting'; renderStrip();

  if (P.mode === 'color') {
    if (!P.key.color) P.key.color = borderColor(it.prev.rgba, it.pw, it.ph);
    it.coarseKey = null;
    worker.postMessage({ type: 'coarse', id: it.id, coarse: null });
    it.hair = null; it.edits = null;
    it.status = 'ready'; renderStrip();
    if (it.id === S.active) { syncUI(it); setStatus('Pronto'); }
    requestMatte(it);
    return;
  }

  const isActive = () => it.id === S.active;

  /** Roda um modelo (ou reaproveita o resultado em cache) e guarda a máscara bruta no item. */
  const runKey = async k => {
    if (!force && it.coarse[k]) return;
    const m = engine.MODELS[k], gpu = await engine.webgpuAvailable();
    if (isActive()) {
      showBusy('Detectando o objeto…', m.server ? 'Enviando para o servidor local' : engine.isLoaded(k) ? '' : `Preparando ${m.name}…`, null);
      setStatus('Detectando…', true); dom.modelSpin.hidden = false;
    }
    const onProgress = p => {
      if (!isActive()) return;
      if (p.phase === 'download' && p.total) {
        showBusy(p.server ? 'O servidor está baixando o modelo' : 'Baixando o modelo de IA',
          p.verifying ? `${m.name} · conferindo o arquivo…` : `${m.name} · ${(p.loaded / 1048576).toFixed(0)} de ${(p.total / 1048576).toFixed(0)} MB · só na primeira vez`, p.loaded / p.total);
      } else if (p.phase === 'loading') showBusy('Detectando o objeto…', `O servidor está carregando ${m.name}`, null);
      else if (p.phase === 'run') showBusy('Detectando o objeto…', p.server ? `${m.name} no servidor local${p.device === 'cpu' ? ' · no processador leva até 1 minuto' : ''}${p.elapsed ? ` · ${p.elapsed} s` : ''}` : gpu && !engine.isGpuDisabled() && k === 'general' ? 'Usando a placa de vídeo' : 'Isso pode levar alguns segundos', null);
    };
    const res = m.server ? await engine.runServer(k, it.bitmap, onProgress) : await engine.runModel(k, it.bitmap, onProgress);
    it.coarse[k] = { data: res.data, w: res.w, h: res.h, solid: res.stats.solid };
  };

  // alta precisão: tenta o servidor local; se não responder, segue com os modelos do navegador
  let key = null;
  await serverInit;
  if (engine.serverOn()) {
    const hk = P.mode === 'portrait' ? 'hqPortrait' : 'hq';
    try { await runKey(hk); key = hk; }
    catch (err) {
      console.warn('[silhueta] servidor local', err);
      toast(`O servidor local não respondeu (${engine.serverBase()}). Usei o modelo do navegador.`, { error: true });
      refreshServerHint();
    }
  }
  if (key) { finishDetect(it, key); return; }
  key = await engine.resolveMode(P.mode);
  const failed = () => {
    it.status = 'error'; renderStrip();
    if (isActive()) { hideBusy(); dom.modelSpin.hidden = true; setStatus('Falhou', false); }
    toast('Não consegui carregar o modelo de IA. Verifique a conexão ou use o modo Cor.', { error: true });
  };

  try { await runKey(key); }
  catch (err) {
    console.error('[silhueta] modelo', key, err);
    if (key !== 'general') { failed(); return; }
    key = 'portrait';
    toast('O modelo de objetos não rodou neste navegador. Usei o de pessoas.', { error: true });
    try { await runKey(key); } catch (err2) { console.error('[silhueta] modelo', key, err2); failed(); return; }
  }

  // objeto não encontrado: no modo Auto, tenta o outro modelo e fica com o que achou mais
  let cover = coverageOf(it.coarse[key]);
  if (cover < 0.004 && P.mode === 'auto') {
    const alt = key === 'general' ? 'portrait' : 'general';
    try {
      await runKey(alt);
      const c2 = coverageOf(it.coarse[alt]);
      if (c2 > cover) { key = alt; cover = c2; toast('O primeiro modelo quase não achou o objeto; usei o outro.'); }
    } catch (err) { console.warn('[silhueta] modelo alternativo falhou', err); }
  }
  finishDetect(it, key);
}

/** Guarda a máscara escolhida no item e dispara o refinamento. */
function finishDetect(it, key) {
  if (coverageOf(it.coarse[key]) < 0.004) toast('Não encontrei um objeto claro nesta imagem. Tente os modos Pessoas, Objetos ou Cor.', { error: true });
  const isActive = () => it.id === S.active;
  it.coarseKey = key;
  if (engine.MODELS[key]?.server) refreshServerHint();
  const c = it.coarse[key];
  if (it.sent) worker.postMessage({ type: 'coarse', id: it.id, coarse: { data: c.data.slice(), w: c.w, h: c.h } });
  it.hair = null; it.edits = null;
  it.status = 'ready'; renderStrip();
  if (isActive()) { hideBusy(); dom.modelSpin.hidden = true; setStatus('Pronto'); syncUI(it); }
  requestMatte(it);
}

/** Fração da imagem que a IA marcou como objeto (≥ 50%). */
function coverageOf(c) {
  if (!c) return 0;
  if (c.solid != null) return c.solid;
  let n = 0; for (let i = 0; i < c.data.length; i++) if (c.data[i] >= 128) n++;
  return (c.solid = n / c.data.length);
}

/* ------------------------------------------------------------------ máscara */
let matteTimer = 0;
function requestMatte(it) {
  if (!it.sent || it.status === 'new') return;
  it.seq++;
  worker.postMessage({ type: 'matte', id: it.id, seq: it.seq, params: clone(it.params) });
  if (it.id === S.active) setWorking(true);
}
function requestMatteSoon(it) { clearTimeout(matteTimer); matteTimer = setTimeout(() => requestMatte(it), 60); }

function onMatte(m) {
  const it = byId(m.id);
  if (!it || m.seq !== it.seq) return;
  it.matte = { alpha: m.alpha, rgb: m.rgb, w: m.w, h: m.h, ms: m.ms, timing: m.timing };
  it.boundsCache = null;
  if (it.id === S.active) { setWorking(false); refreshSubject(it); }
}

function ensureBuffers(it) {
  if (it.subImage) return;
  it.subImage = new ImageData(it.pw, it.ph);
  it.subCanvas = makeCanvas(it.pw, it.ph);
  it.subCtx = it.subCanvas.getContext('2d', { willReadFrequently: false });
}

const hasHairStrokes = it => it.strokes.some(s => s.tool === 'hair');

function currentEdits(it) {
  if (!it.strokes.length) return null;
  if (!it.edits) it.edits = rasterizeStrokes(it.strokes, it.pw, it.ph, { rgba: it.prev.rgba, hair: it.hair });
  return it.edits;
}

function refreshSubject(it) {
  if (!it.matte) return;
  ensureBuffers(it);
  if (hasHairStrokes(it) && !it.hair) ensureHair(it).then(() => { it.edits = null; if (it.id === S.active) refreshSubject(it); });
  fillSubject(it.prev.rgba, it.matte.alpha, it.matte.rgb, it.params.decontam / 100, currentEdits(it), it.pw, it.ph, it.subImage.data, 0, 0, it.pw, it.ph);
  it.subCtx.putImageData(it.subImage, 0, 0);
  it.boundsCache = null;
  vp.setSubjectDark(isDark(it.subImage.data));
  recompose();
}

/** Luminância média do objeto (ponderada pelo alfa): decide se o xadrez da prévia fica claro ou escuro. */
function isDark(rgba) {
  let sum = 0, wsum = 0;
  for (let p = 0; p < rgba.length; p += 12) {
    const al = rgba[p + 3];
    if (al < 24) continue;
    sum += (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) * al; wsum += al;
  }
  return wsum > 0 && sum / wsum / 255 < 0.42;
}

function updateRegion(it, box) {
  const [x0, y0, x1, y1] = box;
  fillSubject(it.prev.rgba, it.matte.alpha, it.matte.rgb, it.params.decontam / 100, it.edits, it.pw, it.ph, it.subImage.data, x0, y0, x1, y1);
  it.subCtx.putImageData(it.subImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
  it.boundsCache = null;
  scheduleRecompose();
}

function ensureHair(it) {
  if (it.hair) return Promise.resolve();
  if (it.hairReq) return it.hairReq.promise;
  setWorking(true);
  const seq = (it.hairSeq = (it.hairSeq || 0) + 1);
  const promise = new Promise(resolve => { it.hairReq = { seq, resolve: () => { setWorking(false); resolve(); } }; });
  it.hairReq.promise = promise;
  worker.postMessage({ type: 'hair', id: it.id, seq, params: clone(it.params) });
  return promise;
}

/* ------------------------------------------------------------------ composição na tela */
let recomposeRaf = 0;
function scheduleRecompose() { if (!recomposeRaf) recomposeRaf = requestAnimationFrame(() => { recomposeRaf = 0; recompose(); }); }

const lookFor = it => ({ ...it.look, bg: { ...it.look.bg, image: it.bgImage || null } });

function boundsOf(it) {
  if (!it.boundsCache) it.boundsCache = { b: alphaBounds(it.subImage.data, it.pw, it.ph) };
  return it.boundsCache.b;
}

function recompose() {
  const it = activeItem();
  if (!it || !it.subCanvas || !it.matte) return;
  const look = lookFor(it);
  const scene = composeScene(it.subCanvas, look, it.prev.canvas, null);
  vp.setLayers(scene, it.prev.canvas);
  const framing = look.frame.trim || look.frame.ratio !== 'free';
  vp.setFrame(framing ? frameFor(boundsOf(it), it.pw, it.ph, look) : null);
  updateFootMeta(it);
}

function outputSize(it) {
  const look = it.look, f = it.matte && it.subImage && (look.frame.trim || look.frame.ratio !== 'free') ? frameFor(boundsOf(it), it.pw, it.ph, look) : null;
  const k = it.fw / it.pw;
  let w = f ? f.w * k : it.fw, h = f ? f.h * k : it.fh;
  const M = look.out.size === 'original' ? Infinity : Number(look.out.size), big = Math.max(w, h);
  if (big > M) { w = w * M / big; h = h * M / big; }
  return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
}

function updateFootMeta(it) {
  const [w, h] = outputSize(it);
  dom.footMeta.textContent = `${w} × ${h} px · ${it.look.out.format.toUpperCase()}`;
  dom.sizeOut.textContent = `${w} × ${h}`;
}

/* ------------------------------------------------------------------ pincéis */
const brushFrac = () => S.brush.size / 2 / 1500;                 // raio relativo ao lado maior
const brushPx = it => brushFrac() * Math.max(it.pw, it.ph);       // raio em px da prévia

let stroke = null;
function startStroke(p) {
  const it = activeItem();
  if (!it || !it.matte) return;
  if (S.tool === 'hair' && !it.hair) { ensureHair(it).then(() => toast('Cabelo pronto: pinte sobre os fios.')); return; }
  ensureBuffers(it);
  if (!it.edits) it.edits = currentEdits(it) || rasterizeStrokes([], it.pw, it.ph, {});
  stroke = { tool: S.tool, r: brushFrac(), hardness: S.brush.hard / 100, pts: [p.x / it.pw, p.y / it.ph], it };
  const tv = S.tool === 'restore' ? 1 : S.tool === 'erase' ? 0 : it.hair;
  updateRegion(it, stamp(it.edits, p.x, p.y, brushPx(it), stroke.hardness, tv));
}
function moveStroke(a, b) {
  if (!stroke) return;
  const it = stroke.it, tv = stroke.tool === 'restore' ? 1 : stroke.tool === 'erase' ? 0 : it.hair;
  stroke.pts.push(b.x / it.pw, b.y / it.ph);
  updateRegion(it, strokeSegment(it.edits, a.x, a.y, b.x, b.y, brushPx(it), stroke.hardness, tv));
}
function endStroke(cancel) {
  if (!stroke) return;
  const it = stroke.it, { it: _drop, ...rec } = stroke;
  stroke = null;
  if (cancel) { it.edits = null; refreshSubject(it); return; }
  it.strokes.push(rec); it.redo = [];
  syncHistory();
}

function wandAt(p, e) {
  const it = activeItem();
  if (!it || !it.matte) return;
  ensureBuffers(it);
  const rec = { tool: 'wand', mode: e.altKey ? 'keep' : 'erase', u: p.x / it.pw, v: p.y / it.ph, tol: S.wandTol / 100 };
  if (p.x < 0 || p.y < 0 || p.x >= it.pw || p.y >= it.ph) return;
  if (!it.edits) it.edits = currentEdits(it) || rasterizeStrokes([], it.pw, it.ph, {});
  const L = Math.max(it.pw, it.ph);
  const mask = floodRegion(it.prev.rgba, it.pw, it.ph, Math.round(p.x), Math.round(p.y), rec.tol, Math.max(1, L / 900));
  applyMask(it.edits, mask, rec.mode === 'keep' ? 1 : 0);
  it.strokes.push(rec); it.redo = [];
  refreshSubject(it); syncHistory();
}

function undo() {
  const it = activeItem(); if (!it || !it.strokes.length) return;
  it.redo.push(it.strokes.pop()); it.edits = null; refreshSubject(it); syncHistory();
}
function redo() {
  const it = activeItem(); if (!it || !it.redo.length) return;
  it.strokes.push(it.redo.pop()); it.edits = null; refreshSubject(it); syncHistory();
}
function syncHistory() {
  const it = activeItem();
  dom.undoBtn.disabled = !it || !it.strokes.length;
  dom.redoBtn.disabled = !it || !it.redo.length;
}

/* ------------------------------------------------------------------ cor sólida: escolher a cor no clique */
function pickKeyColor(p) {
  const it = activeItem();
  if (!it || it.params.mode !== 'color') return;
  const x = clamp(Math.round(p.x), 0, it.pw - 1), y = clamp(Math.round(p.y), 0, it.ph - 1), i = (y * it.pw + x) * 4;
  it.params.key.color = [it.prev.rgba[i], it.prev.rgba[i + 1], it.prev.rgba[i + 2]];
  it.params.key.seed = [x, y];
  syncUI(it); requestMatteSoon(it);
}

/* ------------------------------------------------------------------ painel: ligação dos controles */
const MODE_HINT = {
  auto: 'Escolhe o melhor modelo para o seu navegador.',
  portrait: 'MODNet: feito para retratos, ótimo em cabelo. Leve, 26 MB.',
  general: 'BiRefNet lite: objetos, produtos e animais. 94 MB com WebGPU, 183 MB sem.',
  color: 'Remove uma cor sólida (fundo de estúdio, tela verde). Sem IA e sem download.'
};

const HQ_HINT = {
  auto: 'Alta precisão ligada: BiRefNet completo, 1024 px, no servidor local.',
  portrait: 'Alta precisão: BiRefNet retrato no servidor local. Na primeira vez o servidor baixa mais 973 MB.',
  general: 'Alta precisão ligada: BiRefNet completo, 1024 px, no servidor local.'
};

function reflectOutput(path, value) {
  const out = $(`[data-out="${path}"]`);
  if (out) out.textContent = (FMT[path] || (v => v))(value);
}

function bindControls() {
  $$('[data-bind]').forEach(input => {
    const path = input.dataset.bind;
    input.addEventListener('input', () => {
      const it = activeItem(); if (!it) return;
      const v = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      setPath(target(it, path), path, v);
      if (input.type === 'range') paintRange(input);
      reflectOutput(path, v);
      boundChanged(it, path);
    });
  });
  $$('[data-seg]').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const it = activeItem(); if (!it) return;
    const path = seg.dataset.seg;
    setPath(target(it, path), path, b.dataset.v);
    boundChanged(it, path);
  }));
  $$('#bgSwatches .swatch').forEach(b => b.addEventListener('click', () => {
    const it = activeItem(); if (!it) return;
    it.look.bg.color = b.dataset.color; boundChanged(it, 'bg.color');
  }));
}

function boundChanged(it, path) {
  if (isLookPath(path)) {
    if (path.startsWith('out.')) { prefs.out = { ...(prefs.out || {}), ...it.look.out }; savePrefs(); }
    syncUI(it);
    if (path === 'bg.type' && it.look.bg.type === 'image' && !it.bgImage) pickBgImage();
    scheduleRecompose();
    return;
  }
  if (path === 'mode') {
    it.coarseKey = null; it.hair = null; it.edits = null;
    syncUI(it);
    queueDetect(it); return;
  }
  if (path === 'reach' || path.startsWith('key.')) { it.hair = null; it.edits = null; }
  if (path === 'decontam') { refreshSubject(it); syncUI(it); return; }
  syncUI(it);
  requestMatteSoon(it);
}

function syncUI(it) {
  if (!it) return;
  $$('[data-bind]').forEach(input => {
    const path = input.dataset.bind, v = getPath(target(it, path), path);
    if (input.type === 'checkbox') input.checked = !!v; else if (input.type !== 'color' || typeof v === 'string') input.value = v;
    if (input.type === 'range') paintRange(input);
    reflectOutput(path, v);
  });
  $$('[data-seg]').forEach(seg => {
    const v = String(getPath(target(it, seg.dataset.seg), seg.dataset.seg));
    $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  });
  const P = it.params, L = it.look;
  dom.keyBlock.hidden = P.mode !== 'color';
  dom.holeField.hidden = !P.fillHoles;
  dom.bgColor.hidden = L.bg.type !== 'color';
  dom.bgGradient.hidden = L.bg.type !== 'gradient';
  dom.bgBlur.hidden = L.bg.type !== 'blur';
  dom.bgImage.hidden = L.bg.type !== 'image';
  dom.shadowBlock.hidden = !L.shadow.on;
  dom.outlineBlock.hidden = !L.outline.on;
  dom.qualityField.hidden = L.out.format === 'png';
  dom.modeHint.textContent = engine.serverOn() && P.mode !== 'color' ? HQ_HINT[P.mode] : MODE_HINT[P.mode];
  dom.bgImageName.textContent = it.bgImageName || 'nenhuma';
  $$('#bgSwatches .swatch').forEach(b => b.classList.toggle('on', b.dataset.color.toLowerCase() === L.bg.color.toLowerCase()));
  $('#bgColorWrap').style.background = L.bg.color; $('#bgColorWrap').classList.add('filled');
  $('#gradAWrap').style.background = L.bg.color; $('#gradBWrap').style.background = L.bg.color2; $('#olWrap').style.background = L.outline.color;
  dom.exportHint.textContent = L.out.format === 'jpg'
    ? 'JPG não guarda transparência: o que estiver vazio fica branco (ou na cor do fundo).'
    : L.out.format === 'webp' ? 'WebP guarda a transparência e fica menor que PNG.' : 'PNG guarda a transparência sem perdas.';

  // cor-chave
  if (P.key.color) { dom.keyChip.style.background = `rgb(${P.key.color.join(',')})`; dom.keyText.textContent = 'Clique em outro ponto da imagem para trocar a cor.'; }
  else { dom.keyChip.style.background = ''; dom.keyText.textContent = 'Clique no fundo da imagem para escolher a cor.'; }

  // linha do modelo
  const key = it.coarseKey, m = key && engine.MODELS[key], st = key && (m.server ? engine.serverModelStatus(key) : engine.modelStatus(key));
  const where = !st ? 'em cache' : m.server ? `servidor local · ${st.device === 'directml' ? 'placa de vídeo' : 'processador'} · ${(st.ms / 1000).toFixed(1)} s`
    : st.device === 'webgpu' ? 'WebGPU' : 'processador';
  dom.modelLine.innerHTML = P.mode === 'color' ? '<b>Cor sólida</b> · sem IA'
    : m ? `<b>${m.name}</b> · ${where} · objeto: ${Math.round(coverageOf(it.coarse[key]) * 100)}% da imagem`
    : it.status === 'detecting' ? 'Preparando o modelo…' : '';
  syncCpuButton(key);
  syncHistory();
  updateFootMeta(it);
}

async function syncCpuButton(key) {
  const gpu = await engine.webgpuAvailable();
  dom.cpuBtn.hidden = !gpu;
  dom.cpuBtn.textContent = engine.isGpuDisabled() ? 'Voltar a usar a placa de vídeo' : 'Usar só o processador';
}

/* ------------------------------------------------------------------ ferramentas e visualização */
function setTool(t) {
  S.tool = t;
  $$('#tools .tbtn').forEach(b => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const brush = ['restore', 'erase', 'hair'].includes(t);
  dom.brushOpts.hidden = !(brush || t === 'wand');
  dom.sizeBox.hidden = !brush; dom.hardBox.hidden = !brush; dom.tolBox.hidden = t !== 'wand';
  vp.setTool(t === 'move' ? 'move' : t === 'wand' ? 'wand' : 'brush');
  dom.brushCursor.className = 'brush-cursor' + (t === 'erase' ? ' erase' : t === 'hair' ? ' hair' : '');
  if (t === 'hair') { const it = activeItem(); if (it && it.matte) ensureHair(it); }
  updateBrushSize();
}

function updateBrushSize() {
  const it = activeItem();
  dom.brushSizeOut.textContent = `${S.brush.size}`; dom.brushHardOut.textContent = `${S.brush.hard}%`; dom.wandTolOut.textContent = `${S.wandTol}%`;
  [dom.brushSize, dom.brushHard, dom.wandTol].forEach(paintRange);
  if (it) vp.setBrushRadius(brushPx(it));
}

function bindToolbar() {
  $$('#tools .tbtn').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  dom.brushSize.value = S.brush.size; dom.brushHard.value = S.brush.hard; dom.wandTol.value = S.wandTol;
  dom.brushSize.addEventListener('input', () => { S.brush.size = Number(dom.brushSize.value); prefs.brushSize = S.brush.size; savePrefs(); updateBrushSize(); });
  dom.brushHard.addEventListener('input', () => { S.brush.hard = Number(dom.brushHard.value); prefs.brushHard = S.brush.hard; savePrefs(); updateBrushSize(); });
  dom.wandTol.addEventListener('input', () => { S.wandTol = Number(dom.wandTol.value); prefs.wandTol = S.wandTol; savePrefs(); updateBrushSize(); });
  dom.undoBtn.addEventListener('click', undo);
  dom.redoBtn.addEventListener('click', redo);
  $('#cmpSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setCompare(b.dataset.v); });
  $('#bdSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#bdSeg button').forEach(x => x.classList.toggle('on', x === b)); vp.setBackdrop(b.dataset.v);
  });
  dom.zoomIn.addEventListener('click', () => vp.zoomBy(1.25));
  dom.zoomOut.addEventListener('click', () => vp.zoomBy(0.8));
  dom.zoomFit.addEventListener('click', () => vp.fit());
}

function setCompare(mode) {
  $$('#cmpSeg button').forEach(x => x.classList.toggle('on', x.dataset.v === mode));
  vp.setMode(mode);
}

/* ------------------------------------------------------------------ faixa de itens (lote) */
function renderStrip() {
  const strip = dom.strip;
  strip.innerHTML = '';
  S.items.forEach(it => {
    const b = el('button', { class: 'thumb' + (it.id === S.active ? ' on' : ''), type: 'button', title: it.name, 'aria-label': `Abrir ${it.name}` });
    b.append(el('img', { src: it.thumb, alt: '' }), el('i', { class: 'st' + (it.status === 'ready' ? ' ok' : '') }));
    const x = el('button', { class: 'x', type: 'button', title: 'Remover', 'aria-label': `Remover ${it.name}`, html: icon('x') });
    x.addEventListener('click', ev => { ev.stopPropagation(); removeItem(it.id); });
    b.append(x);
    b.addEventListener('click', () => activate(it.id));
    strip.append(b);
  });
  const add = el('button', { class: 'btn sm', type: 'button', html: icon('plus') + 'Adicionar' });
  add.addEventListener('click', choose);
  strip.append(add, el('span', { class: 'spacer' }), el('span', { class: 'count' }, `${S.items.length} ${S.items.length === 1 ? 'imagem' : 'imagens'}`));
  const many = S.items.length > 1;
  dom.zipBtn.hidden = !many; dom.applyAllBtn.hidden = !many;
}

function removeItem(id) {
  const i = S.items.findIndex(x => x.id === id);
  if (i < 0) return;
  const [it] = S.items.splice(i, 1);
  worker.postMessage({ type: 'drop', id });
  it.bitmap.close && it.bitmap.close();
  if (!S.items.length) { backToLanding(); return; }
  if (S.active === id) activate(S.items[Math.min(i, S.items.length - 1)].id); else renderStrip();
}

async function activate(id) {
  const it = byId(id); if (!it) return;
  stroke = null;
  S.active = id;
  sendItem(it);
  vp.setImage(it.pw, it.ph);
  vp.setLayers(it.matte && it.subCanvas ? it.subCanvas : it.prev.canvas, it.prev.canvas);
  dom.busyCard.hidden = true; setWorking(false);
  mountAmbient().style.backgroundImage = `url(${it.thumb})`; $('.ambient .photo').classList.add('on');
  setStatus(it.status === 'detecting' ? 'Detectando…' : it.status === 'error' ? 'Falhou' : 'Pronto', it.status === 'detecting');
  syncUI(it); renderStrip(); updateBrushSize();
  if (it.matte) { refreshSubject(it); }
  else if (it.status === 'new') queueDetect(it);
  else if (it.status === 'ready') requestMatte(it);
  else if (it.status === 'detecting') showBusy('Detectando o objeto…', 'Na fila', null);
}

/* ------------------------------------------------------------------ entrada de arquivos */
async function addFiles(files) {
  let opened = 0;
  for (const f of files) {
    try {
      const it = await makeItem(f);
      S.items.push(it);
      if (!S.active || S.items.length === 1) { showStudio(); await activate(it.id); }
      else { renderStrip(); queueDetect(it); }
      opened++;
    } catch (err) {
      console.error(err);
      toast(`Não consegui abrir “${f.name}”. Use PNG, JPG, WebP, GIF, BMP ou AVIF.`, { error: true });
    }
  }
  if (opened > 1) toast(`${opened} imagens adicionadas. Os ajustes valem por imagem.`);
}
const choose = async () => { const files = await pickFiles(); if (files.length) addFiles(files); };

function showStudio() {
  dom.landing.hidden = true; dom.studio.hidden = false;
  document.body.classList.add('is-studio');
  window.scrollTo(0, 0);
  requestAnimationFrame(() => vp.resize());
}
function backToLanding() {
  S.active = null;
  dom.studio.hidden = true; dom.landing.hidden = false;
  document.body.classList.remove('is-studio');
  $('.ambient .photo')?.classList.remove('on');
}

/* ------------------------------------------------------------------ fundo: imagem */
async function pickBgImage() {
  const it = activeItem(); if (!it) return;
  const [file] = await pickFiles({ multiple: false });
  if (!file) { if (!it.bgImage) { it.look.bg.type = 'none'; syncUI(it); scheduleRecompose(); } return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { it.bgImage = img; it.bgImageName = file.name; syncUI(it); recompose(); };
  img.onerror = () => toast('Não consegui abrir essa imagem de fundo.', { error: true });
  img.src = url;
}

/* ------------------------------------------------------------------ exportação */
function runExportJob(msg, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const job = ++jobSeq;
    jobs.set(job, { resolve, reject, onProgress });
    worker.postMessage({ ...msg, job }, transfer);
  });
}

async function ensureDetected(it) {
  if (it.status === 'ready' || (it.params.mode === 'color' && it.coarseKey === null && it.sent && it.status === 'ready')) return;
  await queueDetect(it);
}

/** Processa em tamanho real (ou no tamanho pedido) e devolve { blob, name, format, w, h }. */
async function exportItem(it, { formatOverride, onProgress } = {}) {
  await ensureDetected(it);
  const look = lookFor(it), out = { ...look.out };
  if (formatOverride) out.format = formatOverride;
  const M = out.size === 'original' ? Infinity : Number(out.size);
  const fullMax = Math.max(it.fw, it.fh);
  const framing = look.frame.trim || look.frame.ratio !== 'free';
  const work = framing || M === Infinity ? fullMax : Math.min(fullMax, M);
  const k = work / fullMax, wx = Math.max(1, Math.round(it.fw * k)), wy = Math.max(1, Math.round(it.fh * k));

  const oc = makeCanvas(wx, wy), octx = oc.getContext('2d', { willReadFrequently: true });
  octx.imageSmoothingQuality = 'high';
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, wx, wy);
  octx.drawImage(it.bitmap, 0, 0, wx, wy);
  const rgba = octx.getImageData(0, 0, wx, wy).data;
  const c = it.coarseKey ? it.coarse[it.coarseKey] : null;
  const coarse = c ? { data: c.data.slice(), w: c.w, h: c.h } : null;
  const transfer = [rgba.buffer]; if (coarse) transfer.push(coarse.data.buffer);

  const res = await runExportJob({ type: 'export', rgba, w: wx, h: wy, coarse, params: clone(it.params), strokes: clone(it.strokes) }, transfer, onProgress);
  const sub = makeCanvas(wx, wy);
  sub.getContext('2d').putImageData(new ImageData(res.rgba, wx, wy), 0, 0);
  const frame = framing ? frameFor(alphaBounds(res.rgba, wx, wy), wx, wy, look) : null;
  let scene = composeScene(sub, look, oc, frame);
  if (M !== Infinity) scene = resizeCanvas(scene, M);
  const enc = await encodeCanvas(scene, out.format, out.quality);
  return { blob: enc.blob, format: enc.format, fallback: enc.fallback, name: `${baseName(it.name)}-silhueta.${enc.format}`, w: scene.width, h: scene.height };
}

async function doDownload() {
  const it = activeItem(); if (!it) return;
  await withButton(dom.downloadBtn, 'Exportando…', async () => {
    const r = await exportItem(it);
    downloadBlob(r.blob, r.name);
    toast(`${r.name} · ${formatBytes(r.blob.size)}${r.fallback ? ' (o navegador não gera esse formato; salvei em PNG)' : ''}`);
  });
}

async function doCopy() {
  const it = activeItem(); if (!it) return;
  await withButton(dom.copyBtn, 'Copiando…', async () => {
    const r = await exportItem(it, { formatOverride: 'png' });
    if (await copyImage(r.blob)) toast('Imagem copiada. Cole em qualquer lugar.');
    else toast('Seu navegador não deixou copiar a imagem. Use Baixar.', { error: true });
  });
}

async function doZip() {
  if (S.items.length < 2) return;
  await withButton(dom.zipBtn, 'Gerando…', async () => {
    const entries = [], t = toast('Exportando 1 de ' + S.items.length + '…', { ms: 600000 });
    for (let i = 0; i < S.items.length; i++) {
      t.textContent = `Exportando ${i + 1} de ${S.items.length}…`;
      const r = await exportItem(S.items[i]);
      entries.push({ name: r.name, data: r.blob });
    }
    t.remove();
    downloadBlob(await makeZip(entries), 'silhueta.zip');
    toast(`${entries.length} imagens no ZIP.`);
  });
}

function applyAll() {
  const src = activeItem(); if (!src) return;
  for (const it of S.items) {
    if (it === src) continue;
    const modeChanged = it.params.mode !== src.params.mode;
    it.params = clone(src.params);
    it.look = clone(src.look);
    it.bgImage = src.bgImage; it.bgImageName = src.bgImageName;
    it.hair = null; it.edits = null;
    if (!it.sent) continue;
    if (modeChanged || src.params.mode === 'color') { it.coarseKey = null; queueDetect(it); } else requestMatte(it);
  }
  toast('Ajustes copiados para as outras imagens. Retoques de pincel não são copiados.');
}

async function withButton(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${label}`;
  try { await fn(); }
  catch (err) { console.error(err); toast('A exportação falhou. Tente um tamanho menor.', { error: true }); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

/* ------------------------------------------------------------------ atalhos e ajuda */
const SHORTCUTS = [
  ['Mover / zoom', ['V']], ['Restaurar', ['B']], ['Apagar', ['E']], ['Cabelo', ['H']], ['Varinha (Alt mantém)', ['W']],
  ['Tamanho do pincel', ['[', ']']], ['Desfazer / refazer', ['Ctrl', 'Z'], ['Ctrl', 'Shift', 'Z']],
  ['Comparar com o original', ['C']], ['Dividir antes / depois', ['S']], ['Ajustar à tela', ['0']], ['Zoom', ['+', '−']],
  ['Arrastar a imagem', ['Espaço'], ['botão do meio']], ['Baixar', ['Ctrl', 'S']], ['Colar imagem', ['Ctrl', 'V']]
];

function openHelp() {
  if ($('.modal-back')) return;
  const rows = SHORTCUTS.map(([label, ...combos]) => `<li><span>${label}</span><span class="keys">${combos.map(c => c.map(k => `<span class="kbd">${k}</span>`).join('')).join('<span style="opacity:.4;padding:0 2px">ou</span>')}</span></li>`).join('');
  const back = el('div', { class: 'modal-back', role: 'presentation' }, el('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Atalhos',
    html: `<h3>Atalhos</h3><p>Tudo o que dá para fazer sem tirar a mão do teclado.</p><ul class="help-list">${rows}</ul><div class="row end"><button class="btn primary" type="button">Fechar</button></div>` }));
  const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  $('button', back).addEventListener('click', close);
  document.addEventListener('keydown', esc, true);
  document.body.append(back);
}

function bindKeys() {
  let prevMode = null;
  window.addEventListener('keydown', e => {
    if (isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!activeItem()) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); doDownload(); return; }
    if (mod || e.altKey) return;
    const tools = { v: 'move', b: 'restore', e: 'erase', h: 'hair', w: 'wand' };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k === '[' || k === ']') { S.brush.size = clamp(S.brush.size + (k === ']' ? 6 : -6), 4, 260); dom.brushSize.value = S.brush.size; updateBrushSize(); return; }
    if (k === '0') { vp.fit(); return; }
    if (k === '+' || k === '=') { vp.zoomBy(1.25); return; }
    if (k === '-' || k === '_') { vp.zoomBy(0.8); return; }
    if (k === 's') { setCompare(vp.mode === 'split' ? 'result' : 'split'); return; }
    if (k === 'c' && !e.repeat) { prevMode = vp.mode; setCompare('original'); return; }
    if (k === '?') openHelp();
  });
  window.addEventListener('keyup', e => { if (e.key.toLowerCase() === 'c' && prevMode) { setCompare(prevMode); prevMode = null; } });
}

/* ------------------------------------------------------------------ demonstração (?demo=1) */
/** Imagem sintética (frasco sobre fundo liso) recortada pelo modo Cor: mostra o estúdio completo sem baixar modelo. */
async function loadDemo() {
  const W = 1200, H = 800, c = makeCanvas(W, H), x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#dfe3ea'); bg.addColorStop(1, '#c4cad6');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const body = x.createLinearGradient(380, 0, 820, 0); body.addColorStop(0, '#2b2f3a'); body.addColorStop(0.45, '#5a6173'); body.addColorStop(1, '#1d2029');
  x.fillStyle = body; x.beginPath(); x.roundRect(380, 250, 440, 470, 70); x.fill();
  x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.roundRect(410, 280, 46, 410, 24); x.fill();
  x.fillStyle = '#f2f2f4'; x.beginPath(); x.roundRect(470, 420, 280, 200, 22); x.fill();
  x.fillStyle = '#2b2f3a'; x.font = '700 54px Inter, Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText('SILHUETA', 610, 535);
  x.font = '500 24px Inter, Segoe UI, sans-serif'; x.fillStyle = '#6b7080'; x.fillText('Nº 07 · 50 ML', 610, 578);
  const cap = x.createLinearGradient(0, 150, 0, 270); cap.addColorStop(0, '#e9e3d6'); cap.addColorStop(1, '#b9b09c');
  x.fillStyle = cap; x.beginPath(); x.roundRect(500, 150, 200, 120, 26); x.fill();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const it = await makeItem(new File([blob], 'frasco.png', { type: 'image/png' }));
  it.params.mode = 'color'; it.params.key.tol = 10;
  S.items.push(it); showStudio(); await activate(it.id);
}

/* ------------------------------------------------------------------ servidor local (alta precisão) */
let serverSameOrigin = false, serverInit = Promise.resolve(), hintTimer = 0;
const downloadLink = text => `<a href="${engine.SERVER_DOWNLOAD}" target="_blank" rel="noopener">${text}</a>`;
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function bindServer() {
  const saved = prefs.server || {};
  engine.configureServer({ on: !!saved.on, url: saved.url || '' });
  dom.hqToggle.checked = engine.serverOn();
  dom.hqUrl.value = saved.url || '';
  syncServerUI();

  dom.hqToggle.addEventListener('change', () => {
    engine.configureServer({ on: dom.hqToggle.checked });
    prefs.server = { ...(prefs.server || {}), on: dom.hqToggle.checked }; savePrefs();
    syncServerUI(); refreshServerHint();
    const it = activeItem();
    if (it) syncUI(it);
    if (it && it.params.mode !== 'color') queueDetect(it);
  });
  dom.hqUrl.addEventListener('change', async () => {
    const url = dom.hqUrl.value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s/?#]+$/i.test(url)) { toast('Use um endereço como http://localhost:5174', { error: true }); return; }
    engine.configureServer({ url }); prefs.server = { ...(prefs.server || {}), url }; savePrefs();
    for (const x of S.items) { delete x.coarse.hq; delete x.coarse.hqPortrait; }
    const h = await refreshServerHint(), it = activeItem();
    if (h && engine.serverOn() && it && it.params.mode !== 'color') queueDetect(it);
  });

  // site aberto pelo próprio servidor em C#: a API está no mesmo endereço e a alta precisão já começa ligada
  const origin = await engine.sameOriginServer();
  if (origin) {
    serverSameOrigin = true;
    engine.configureServer({ url: origin, on: saved.on ?? true });
    dom.hqToggle.checked = engine.serverOn();
  }
  syncServerUI();
  if (engine.serverOn()) refreshServerHint();
}

function syncServerUI() {
  const on = engine.serverOn();
  dom.hqBlock.classList.toggle('on', on);
  dom.hqUrlField.hidden = !on || serverSameOrigin;
}

/** Mostra se o servidor está no ar e o estado do modelo (acompanha download e carregamento). */
async function refreshServerHint() {
  clearTimeout(hintTimer);
  if (!engine.serverOn()) {
    dom.hqHint.innerHTML = `BiRefNet completo em 1024 px rodando no seu computador: mais preciso em cabelo, bordas finas e ilustrações. Precisa do ${downloadLink('Silhueta Servidor')} aberto.`;
    return null;
  }
  const base = engine.serverBase();
  if (!engine.lastHealth()) dom.hqHint.innerHTML = '<span class="dot wait"></span>Procurando o servidor…';
  const h = await engine.probeServer();
  if (!engine.serverOn()) return h;
  if (!h) {
    const remote = location.protocol === 'https:' ? ' Se o navegador pedir acesso à rede local, permita.' : '';
    dom.hqHint.innerHTML = `<span class="dot off"></span>Servidor não encontrado em ${escHtml(base)}. ${downloadLink('Baixe o Silhueta Servidor')} (Windows, sem instalar nada), abra o <code>Silhueta-Servidor.exe</code> e deixe a janela aberta.${remote} Enquanto isso, uso o modelo do navegador.`;
    return null;
  }
  const it = activeItem(), want = it && it.params.mode === 'portrait' ? 'portrait' : 'general';
  const m = h.models.find(x => x.id === want) || h.models[0];
  const pct = m.total ? Math.round(m.downloaded / m.total * 100) : 0;
  const state = {
    ready: `pronto · ${m.device === 'directml' ? 'placa de vídeo' : 'processador'}`,
    downloading: `baixando o modelo · ${pct}% de ${Math.round(m.total / 1e6)} MB`,
    verifying: 'conferindo o modelo baixado', loading: 'carregando o modelo',
    downloaded: 'modelo baixado, carrega no primeiro uso', missing: `o modelo (${Math.round(m.total / 1e6)} MB) é baixado no primeiro uso`,
    error: `erro: ${escHtml(m.error || 'desconhecido')}`
  }[m.state] || m.state;
  const dot = m.state === 'ready' ? 'ok' : m.state === 'error' ? 'off' : 'wait';
  dom.hqHint.innerHTML = `<span class="dot ${dot}"></span>Conectado · <b>${escHtml(m.name)}</b> · ${state}. A foto vai só para ${serverSameOrigin ? 'este servidor' : escHtml(base)}, no seu computador.`;
  if (['downloading', 'verifying', 'loading'].includes(m.state)) hintTimer = setTimeout(refreshServerHint, 2000);
  return h;
}

/* ------------------------------------------------------------------ início */
function init() {
  mountHeader('remover');
  mountAmbient();
  mountLanding();
  for (const id of ['landing', 'studio', 'canvasWrap', 'view', 'brushCursor', 'statusChip', 'statusText', 'working', 'busyCard', 'busyTitle', 'busyBar', 'busySub',
    'zoomText', 'zoomIn', 'zoomOut', 'zoomFit', 'strip', 'brushOpts', 'sizeBox', 'hardBox', 'tolBox', 'brushSize', 'brushSizeOut', 'brushHard', 'brushHardOut', 'wandTol', 'wandTolOut',
    'undoBtn', 'redoBtn', 'cpuBtn', 'hqBlock', 'hqToggle', 'hqHint', 'hqUrl', 'hqUrlField','modeHint', 'modelLine', 'modelSpin', 'redetect', 'keyBlock', 'keyChip', 'keyText', 'holeField', 'bgColor', 'bgGradient', 'bgBlur', 'bgImage', 'bgImageBtn', 'bgImageName',
    'shadowBlock', 'outlineBlock', 'qualityField', 'sizeOut', 'exportHint', 'downloadBtn', 'copyBtn', 'applyAllBtn', 'zipBtn', 'footMeta']) dom[id] = document.getElementById(id);

  vp = new Viewport(dom.view, dom.brushCursor, {
    onView: (scale) => {
      const it = activeItem();
      if (it) dom.zoomText.textContent = `${Math.round(scale * it.pw / it.fw * 100)}%`;
      updateBrushSize();
    },
    onStrokeStart: startStroke, onStrokeMove: moveStroke, onStrokeEnd: endStroke, onWand: wandAt, onTap: pickKeyColor
  });

  if (!new URLSearchParams(location.search).has('gpu')) engine.setGpuDisabled(!!prefs.forceCpu);
  dom.cpuBtn.addEventListener('click', () => {
    const off = !engine.isGpuDisabled();
    prefs.forceCpu = off; savePrefs(); engine.setGpuDisabled(off);
    for (const x of S.items) { delete x.coarse.general; x.hair = null; x.edits = null; }
    const it = activeItem();
    if (it && it.params.mode !== 'color') queueDetect(it, true);
    toast(off ? 'A IA agora roda só no processador: mais lenta, mas estável.' : 'A IA volta a usar a placa de vídeo quando der.');
  });
  serverInit = bindServer().catch(err => console.warn('[silhueta] servidor local', err));
  bindControls(); bindToolbar(); bindKeys();
  setTool('move');
  dom.redetect.addEventListener('click', () => {
    const it = activeItem(); if (!it) return;
    const keep = { mode: it.params.mode, key: it.params.key };
    it.params = { ...clone(MATTE_DEFAULTS), ...keep };
    it.hair = null; it.edits = null;
    syncUI(it); requestMatte(it);
    toast('Ajustes de borda e cabelo voltaram ao padrão.');
  });
  dom.bgImageBtn.addEventListener('click', pickBgImage);
  dom.downloadBtn.addEventListener('click', doDownload);
  dom.copyBtn.addEventListener('click', doCopy);
  dom.zipBtn.addEventListener('click', doZip);
  dom.applyAllBtn.addEventListener('click', applyAll);
  $('#pickBtn').addEventListener('click', choose);
  $('#helpLink').addEventListener('click', e => { e.preventDefault(); openHelp(); });
  acceptDrops(addFiles);

  window.silhueta = { S, vp, engine, activeItem, addFiles, setTool, undo, redo, exportItem, worker, loadDemo };
  if (new URLSearchParams(location.search).has('demo')) loadDemo();
}

init();
