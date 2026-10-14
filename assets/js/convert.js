/*
 * Silhueta · conversor de formatos
 * PNG, JPG, WebP, AVIF (quando o navegador gera), GIF, BMP, ICO, PDF e SVG (vetorizado ou foto embutida).
 */
import { $, $$, el, clamp, toast, mountHeader, mountAmbient, paintRange, formatBytes, baseName, downloadBlob, copyText, pickFiles, acceptDrops } from './ui.js';
import { icon } from './icons.js';
import { makeCanvas, resizeCanvas } from './compose.js';
import { encodeBMP, encodeGIF, encodeICO, encodePDF, hexToRgb } from './encoders.js';
import { makeZip } from './zip.js';

/* ------------------------------------------------------------------ formatos */
const FORMATS = [
  { id: 'png',  name: 'PNG',  note: 'sem perdas, com transparência', mime: 'image/png' },
  { id: 'jpg',  name: 'JPG',  note: 'fotos, arquivo leve', mime: 'image/jpeg' },
  { id: 'webp', name: 'WebP', note: 'leve e com transparência', mime: 'image/webp' },
  { id: 'avif', name: 'AVIF', note: 'o mais leve, se o navegador gerar', mime: 'image/avif' },
  { id: 'gif',  name: 'GIF',  note: 'até 256 cores', mime: 'image/gif' },
  { id: 'bmp',  name: 'BMP',  note: 'sem compressão', mime: 'image/bmp' },
  { id: 'ico',  name: 'ICO',  note: 'ícone com vários tamanhos', mime: 'image/x-icon' },
  { id: 'svg',  name: 'SVG',  note: 'vetorizar ou embutir foto', mime: 'image/svg+xml' },
  { id: 'pdf',  name: 'PDF',  note: 'uma página com a imagem', mime: 'application/pdf' }
];
const HINTS = {
  png: 'Boa escolha para logos, capturas de tela e qualquer coisa com transparência.',
  jpg: 'Ótimo para fotos. Não guarda transparência: o que estiver vazio recebe a cor de fundo.',
  webp: 'Costuma ficar bem menor que PNG e JPG, e guarda transparência.',
  avif: 'Formato novo e muito eficiente. Nem todo navegador consegue gerar.',
  gif: 'Limitado a 256 cores e transparência de 1 bit. Serve para ícones e imagens simples.',
  bmp: 'Sem compressão: arquivos grandes, mas aceitos por sistemas antigos.',
  ico: 'Gera um arquivo .ico com os tamanhos que você marcar (favicon, atalhos).',
  svg: 'Vetorizar vira curvas escaláveis; Foto embute a imagem inteira dentro do SVG.',
  pdf: 'Uma página com a imagem. Transparência vira a cor de fundo.'
};
const SVG_HINT = {
  mono: 'Uma cor só, como ícones. Ótimo para logos e desenhos de traço.',
  color: 'Vetoriza por regiões de cor. Bom para logos e ilustrações.',
  embed: 'Mantém a foto como ela é dentro do SVG. Não vira curvas.'
};
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------------ opções */
const DEFAULTS = {
  format: 'webp', quality: 88, bg: '#ffffff', gifTransparent: true, gifDither: true, gifColors: '256',
  icoSizes: [16, 32, 48, 256], pdfPage: 'image',
  svgMode: 'mono', monoSrc: 'dark', monoColor: '#000000', colors: 6, detail: 60, smooth: 55, speckle: 12, embedFmt: 'png', traceSize: '512',
  resize: 'keep', resizeValue: 1024
};
const loadOpts = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('silhueta.conv') || '{}') }; } catch { return { ...DEFAULTS }; } };
const saveOpts = () => { try { localStorage.setItem('silhueta.conv', JSON.stringify(opts)); } catch { /* ignore */ } };
const opts = loadOpts();

const FMT_OUT = { quality: v => `${v}%`, detail: v => v, smooth: v => v, speckle: v => (Number(v) ? `${v}px` : 'desligado'), colors: v => v, resizeValue: v => (opts.resize === 'scale' ? `${v}%` : `${v} px`) };
const supported = {};   // formato → o navegador consegue gerar?

/* ------------------------------------------------------------------ arquivos */
const files = [];
let uid = 0, runToken = 0, timer = 0;
const dom = {};

const worker = new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' });
const traceJobs = new Map();
worker.onmessage = e => { const j = traceJobs.get(e.data.id); if (j) { traceJobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data); } };
const trace = (img, mode, o) => new Promise((resolve, reject) => { const id = ++uid; traceJobs.set(id, { resolve, reject }); worker.postMessage({ id, img, mode, opts: o }, [img.data.buffer]); });

/** Rasteriza um SVG num canvas com o lado maior em pelo menos `minSide` px. */
async function rasterizeSvg(file, minSide = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const nw = img.naturalWidth || 512, nh = img.naturalHeight || 512, s = Math.max(1, Math.min(4096, Math.max(minSide, Math.max(nw, nh))) / Math.max(nw, nh));
    const c = makeCanvas(nw * s, nh * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

async function readFile(file) {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const source = isSvg ? await rasterizeSvg(file) : await createImageBitmap(file);
  const th = makeCanvas(128, Math.max(1, Math.round(128 * source.height / source.width)));
  th.getContext('2d').drawImage(source, 0, 0, th.width, th.height);
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || file.type.split('/')[1] || '?').toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('x-icon', 'ico');
  return { id: ++uid, file, name: file.name, source, w: source.width, h: source.height, size: file.size, ext, thumb: th.toDataURL('image/png'), result: null, status: 'new' };
}

async function addFiles(list) {
  let added = 0;
  for (const f of list) {
    try { const it = await readFile(f); files.push(it); added++; renderAll(); }
    catch (err) { console.error(err); toast(`Não consegui abrir “${f.name}”. Esse formato não é lido pelo navegador.`, { error: true }); }
  }
  if (added) schedule(0);
}

/* ------------------------------------------------------------------ conversão */
function targetSize(it) {
  let w = it.w, h = it.h;
  if (opts.resize === 'max') { const s = Number(opts.resizeValue) / Math.max(w, h); w *= s; h *= s; }
  else if (opts.resize === 'scale') { const s = Number(opts.resizeValue) / 100; w *= s; h *= s; }
  return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
}

function drawSized(it, w, h) {
  const c = makeCanvas(w, h);
  if (w < it.w && h < it.h) {                                   // reduz com qualidade
    const full = makeCanvas(it.w, it.h); full.getContext('2d').drawImage(it.source, 0, 0);
    return resizeCanvas(full, Math.max(w, h));
  }
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(it.source, 0, 0, w, h);
  return c;
}

function flatten(canvas, bgHex) {
  const c = makeCanvas(canvas.width, canvas.height), x = c.getContext('2d');
  x.fillStyle = bgHex; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
  return c;
}

const toBlob = (canvas, mime, q) => new Promise(res => canvas.toBlob(res, mime, q));
const pixels = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);

async function convert(it) {
  const [w, h] = targetSize(it), fmt = opts.format, q = opts.quality / 100;
  const canvas = drawSized(it, w, h);
  const out = { w: canvas.width, h: canvas.height, ext: fmt, mime: FORMATS.find(f => f.id === fmt).mime };

  if (fmt === 'png' || fmt === 'webp' || fmt === 'avif') {
    out.blob = await toBlob(canvas, out.mime, q);
    if (!out.blob || out.blob.type !== out.mime) { if (fmt === 'png') throw new Error('o navegador não conseguiu gerar PNG'); throw new Error(`o navegador não gera ${fmt.toUpperCase()}`); }
  } else if (fmt === 'jpg') {
    out.blob = await toBlob(flatten(canvas, opts.bg), 'image/jpeg', q);
  } else if (fmt === 'bmp') {
    const d = pixels(canvas);
    out.blob = new Blob([encodeBMP(d.data, d.width, d.height, hexToRgb(opts.bg))], { type: 'image/bmp' });
  } else if (fmt === 'gif') {
    const d = pixels(opts.gifTransparent ? canvas : flatten(canvas, opts.bg));
    out.blob = new Blob([encodeGIF(d.data, d.width, d.height, { colors: Number(opts.gifColors), dither: opts.gifDither, bg: hexToRgb(opts.bg) })], { type: 'image/gif' });
  } else if (fmt === 'ico') {
    const sizes = (opts.icoSizes.length ? opts.icoSizes : [32]).slice().sort((a, b) => a - b), imgs = [];
    for (const s of sizes) {
      const sq = makeCanvas(s, s), k = Math.min(s / it.w, s / it.h), dw = it.w * k, dh = it.h * k, x = sq.getContext('2d');
      x.imageSmoothingQuality = 'high'; x.drawImage(it.source, (s - dw) / 2, (s - dh) / 2, dw, dh);
      imgs.push({ size: s, bytes: new Uint8Array(await (await toBlob(sq, 'image/png')).arrayBuffer()) });
    }
    out.blob = new Blob([encodeICO(imgs)], { type: 'image/x-icon' });
    out.w = out.h = sizes[sizes.length - 1];
  } else if (fmt === 'pdf') {
    const jpeg = await toBlob(flatten(canvas, opts.bg), 'image/jpeg', q);
    out.blob = new Blob([encodePDF(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height, { page: opts.pdfPage })], { type: 'application/pdf' });
  } else if (fmt === 'svg') {
    out.svgText = await makeSvg(it, canvas);
    out.blob = new Blob([out.svgText], { type: 'image/svg+xml' });
  }
  return out;
}

async function makeSvg(it, sized) {
  const side = Number(opts.traceSize);
  if (opts.svgMode === 'embed') {
    const c = resizeCanvas(sized, side), mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[opts.embedFmt];
    const src = opts.embedFmt === 'jpg' ? flatten(c, opts.bg) : c;
    const url = src.toDataURL(mime, opts.quality / 100);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${c.width} ${c.height}"><image width="${c.width}" height="${c.height}" xlink:href="${url}"/></svg>`;
  }
  const c = resizeCanvas(sized, side), d = pixels(c);
  const common = { detail: opts.detail, smooth: opts.smooth, speckle: opts.speckle, blur: 1 };
  const o = opts.svgMode === 'mono' ? { ...common, src: opts.monoSrc, thr: null, color: opts.monoColor } : { ...common, colors: opts.colors };
  return (await trace({ data: new Uint8ClampedArray(d.data), w: d.width, h: d.height }, opts.svgMode, o)).svg;
}

function schedule(delay = 220) {
  clearTimeout(timer);
  timer = setTimeout(runAll, delay);
}

async function runAll() {
  const token = ++runToken;
  for (const it of files) { it.status = 'working'; renderCard(it); }
  for (const it of files) {
    if (token !== runToken) return;
    try { it.result = await convert(it); it.status = 'done'; it.error = null; }
    catch (err) { console.error(err); it.result = null; it.status = 'error'; it.error = err.message; }
    if (token !== runToken) return;
    renderCard(it);
  }
  renderBulk();
}

/* ------------------------------------------------------------------ interface */
const kbText = n => formatBytes(n);
const outName = it => `${baseName(it.name)}.${it.result.ext}`;

async function dataUri(it) {
  if (it.result.svgText) return 'data:image/svg+xml;utf8,' + encodeURIComponent(it.result.svgText);
  return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(it.result.blob); });
}

function cardNode(it) {
  const card = el('article', { class: 'file glass', 'data-id': it.id });
  card.append(el('div', { class: 'thumb' }, el('img', { src: it.thumb, alt: '' })));
  const meta = el('div', { class: 'meta' }, el('div', { class: 'name', title: it.name }, it.name));
  const line = el('div', { class: 'line' }, el('span', { class: 'badge' }, it.ext), el('span', {}, `${it.w}×${it.h}`), el('span', {}, kbText(it.size)));
  if (it.status === 'working') line.append(el('span', { class: 'arrow' }, '→'), el('span', { class: 'spinner' }), 'convertendo…');
  else if (it.status === 'error') line.append(el('span', { class: 'err' }, `Não foi possível converter: ${it.error}`));
  else if (it.status === 'done') {
    const r = it.result, diff = r.blob.size / it.size - 1;
    line.append(el('span', { class: 'arrow' }, '→'), el('span', { class: 'badge to' }, r.ext), el('span', { class: 'new' }, `${r.w}×${r.h}`), el('span', { class: 'new' }, kbText(r.blob.size)),
      el('span', { class: diff <= 0 ? 'gain' : 'loss' }, `${diff <= 0 ? '−' : '+'}${Math.abs(Math.round(diff * 100))}%`));
  }
  meta.append(line);
  card.append(meta);

  const actions = el('div', { class: 'actions' });
  if (it.status === 'done') {
    const dl = el('button', { class: 'btn sm primary', type: 'button', html: icon('download') + 'Baixar' });
    dl.addEventListener('click', () => downloadBlob(it.result.blob, outName(it)));
    const cp = el('button', { class: 'btn sm', type: 'button', title: 'Copia o Data URI (texto) desta imagem', html: icon('copy') + 'Data URI' });
    cp.addEventListener('click', async () => { (await copyText(await dataUri(it))) ? toast('Data URI copiado.') : toast('Não consegui copiar.', { error: true }); });
    const pa = el('button', { class: 'btn sm', type: 'button', title: 'Copia o texto entre aspas, pronto para a propriedade Image do PowerApps', html: 'PowerApps' });
    pa.addEventListener('click', async () => { (await copyText(`"${await dataUri(it)}"`)) ? toast('Texto para o PowerApps copiado.') : toast('Não consegui copiar.', { error: true }); });
    actions.append(dl, cp, pa);
  }
  const rm = el('button', { class: 'btn sm ghost icon', type: 'button', title: 'Remover', 'aria-label': `Remover ${it.name}`, html: icon('x') });
  rm.addEventListener('click', () => { const i = files.indexOf(it); if (i >= 0) files.splice(i, 1); it.source.close && it.source.close(); renderAll(); });
  actions.append(rm);
  card.append(actions);
  return card;
}

function renderCard(it) {
  const old = dom.results.querySelector(`[data-id="${it.id}"]`);
  if (old) old.replaceWith(cardNode(it));
}

function renderBulk() {
  const done = files.filter(f => f.status === 'done');
  dom.bulk.hidden = files.length === 0;
  const total = done.reduce((s, f) => s + f.result.blob.size, 0), before = files.reduce((s, f) => s + f.size, 0);
  dom.bulkInfo.textContent = `${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}` + (done.length === files.length && files.length ? ` · ${kbText(before)} → ${kbText(total)}` : '');
  dom.zipBtn.hidden = files.length < 2;
}

function renderAll() {
  dom.results.innerHTML = '';
  files.forEach(f => dom.results.append(cardNode(f)));
  renderBulk();
}

/* ------------------------------------------------------------------ painel */
function buildFormats() {
  dom.fmtGrid.innerHTML = '';
  FORMATS.forEach(f => {
    const b = el('button', { class: 'fmt', type: 'button', role: 'radio', 'data-f': f.id, title: f.note }, el('b', {}, f.name), el('small', {}, f.note));
    b.addEventListener('click', () => { opts.format = f.id; saveOpts(); syncPanel(); schedule(); });
    dom.fmtGrid.append(b);
  });
  dom.icoSizes.innerHTML = '';
  ICO_SIZES.forEach(s => {
    const b = el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': 'false', 'data-s': s }, `${s}`);
    b.addEventListener('click', () => {
      const set = new Set(opts.icoSizes);
      set.has(s) ? set.delete(s) : set.add(s);
      opts.icoSizes = [...set].sort((a, c) => a - c); saveOpts(); syncPanel(); schedule();
    });
    dom.icoSizes.append(b);
  });
}

function syncPanel() {
  $$('.fmt', dom.fmtGrid).forEach(b => { b.setAttribute('aria-checked', String(b.dataset.f === opts.format)); b.disabled = supported[b.dataset.f] === false; });
  dom.fmtHint.textContent = HINTS[opts.format];
  let any = false;
  $$('[data-for]').forEach(b => { const on = b.dataset.for.split(' ').includes(opts.format); b.hidden = !on; any ||= on; });
  dom.noOpts.hidden = any;
  $$('#icoSizes .chip-btn').forEach(b => b.setAttribute('aria-pressed', String(opts.icoSizes.includes(Number(b.dataset.s)))));
  $$('[data-opt]').forEach(input => {
    const v = opts[input.dataset.opt];
    if (input.type === 'checkbox') input.checked = !!v; else input.value = v;
    if (input.type === 'range') paintRange(input);
    $$(`[data-out="${input.dataset.opt}"]`).forEach(out => { out.textContent = (FMT_OUT[input.dataset.opt] || (x => x))(v); });
  });
  $$('[data-seg]').forEach(seg => $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === String(opts[seg.dataset.seg]))));
  $$('[data-svg]').forEach(b => { b.hidden = !b.dataset.svg.split(' ').includes(opts.svgMode); });
  dom.svgHint.textContent = SVG_HINT[opts.svgMode];
  $$('#bgSwatches .swatch').forEach(b => b.classList.toggle('on', b.dataset.color.toLowerCase() === opts.bg.toLowerCase()));
  dom.bgWrap.style.background = opts.bg; dom.bgWrap.classList.add('filled');
  dom.monoWrap.style.background = opts.monoColor; dom.monoHex.textContent = opts.monoColor.toUpperCase();
  const sc = opts.resize === 'scale', field = dom.resizeField;
  field.hidden = opts.resize === 'keep';
  const range = $('#o-resize');
  range.min = sc ? 10 : 16; range.max = sc ? 400 : 4096;
  if (sc && opts.resizeValue > 400) opts.resizeValue = 100;
  if (!sc && opts.resizeValue < 16) opts.resizeValue = 1024;
  range.value = opts.resizeValue; paintRange(range);
  dom.resizeLabel.textContent = sc ? 'Escala' : 'Lado maior em pixels';
  $('[data-out="resizeValue"]').textContent = FMT_OUT.resizeValue(opts.resizeValue);
}

function bindPanel() {
  $$('[data-opt]').forEach(input => input.addEventListener('input', () => {
    const k = input.dataset.opt;
    opts[k] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    saveOpts(); syncPanel(); schedule(input.type === 'range' ? 280 : 120);
  }));
  $$('[data-seg]').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    opts[seg.dataset.seg] = b.dataset.v; saveOpts(); syncPanel(); schedule();
  }));
  $$('#bgSwatches .swatch').forEach(b => b.addEventListener('click', () => { opts.bg = b.dataset.color; saveOpts(); syncPanel(); schedule(); }));
}

async function zipAll() {
  const done = files.filter(f => f.status === 'done');
  if (!done.length) return;
  dom.zipBtn.disabled = true;
  try { downloadBlob(await makeZip(done.map(f => ({ name: outName(f), data: f.result.blob }))), 'silhueta-convertidas.zip'); toast(`${done.length} arquivos no ZIP.`); }
  catch (err) { console.error(err); toast('Não consegui montar o ZIP.', { error: true }); }
  finally { dom.zipBtn.disabled = false; }
}

/* ------------------------------------------------------------------ início */
async function detectSupport() {
  for (const f of FORMATS) {
    if (!['webp', 'avif'].includes(f.id)) continue;
    const c = makeCanvas(2, 2);
    supported[f.id] = await new Promise(res => c.toBlob(b => res(!!b && b.type === f.mime), f.mime));
  }
  if (supported[opts.format] === false) opts.format = 'png';
  syncPanel();
}

function init() {
  mountHeader('converter');
  mountAmbient();
  for (const id of ['dz', 'pickBtn', 'results', 'bulk', 'bulkInfo', 'clearBtn', 'zipBtn', 'fmtGrid', 'fmtHint', 'icoSizes', 'svgHint', 'bgWrap', 'monoWrap', 'monoHex', 'noOpts', 'resizeField', 'resizeLabel']) dom[id] = document.getElementById(id);
  buildFormats(); bindPanel(); syncPanel(); detectSupport();

  const choose = async () => { const list = await pickFiles(); if (list.length) addFiles(list); };
  dom.dz.addEventListener('click', e => { if (!e.target.closest('button')) choose(); });
  dom.pickBtn.addEventListener('click', choose);
  dom.dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
  dom.clearBtn.addEventListener('click', () => { files.length = 0; renderAll(); });
  dom.zipBtn.addEventListener('click', zipAll);
  acceptDrops(addFiles);
  window.silhuetaConv = { files, opts, addFiles, convert, schedule };
}

init();
