/* Silhueta · utilitários de interface compartilhados pelas páginas */
import { injectSprite, icon, markSvg } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
}

export const baseName = name => (name || 'imagem').replace(/\.[^./\\]+$/, '');

/* ------------------------------------------------------------------ avisos */
let toastBox;
export function toast(message, opts = {}) {
  if (!toastBox) { toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const twin = [...toastBox.children].find(n => n.textContent === message && !n.classList.contains('out'));
  if (twin) return twin;                     // mesma mensagem já na tela: não repete
  const t = el('div', { class: 'toast glass' + (opts.error ? ' err' : '') }, message);
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, opts.ms || (opts.error ? 5200 : 2400));
  return t;
}

/* ------------------------------------------------------------------ arquivos */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

export async function copyImage(blob) {
  try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); return true; } catch { return false; }
}

/** Decodifica o arquivo para um ImageBitmap (respeita a rotação EXIF) com lado maior limitado. */
export async function decodeImage(file, maxSide = 4096) {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  let bmp;
  if (isSvg) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const s = img.naturalWidth ? Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
      const w = Math.max(1, Math.round((img.naturalWidth || 512) * Math.max(s, 1))), h = Math.max(1, Math.round((img.naturalHeight || 512) * Math.max(s, 1)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return { bitmap: await createImageBitmap(c), width: w, height: h, name: file.name };
    } finally { URL.revokeObjectURL(url); }
  }
  bmp = await createImageBitmap(file);
  const big = Math.max(bmp.width, bmp.height);
  if (big > maxSide) {
    const s = maxSide / big, r = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
    bmp.close(); bmp = r;
  }
  return { bitmap: bmp, width: bmp.width, height: bmp.height, name: file.name };
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg,.ico';

export function pickFiles({ multiple = true, accept = IMAGE_ACCEPT } = {}) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, multiple: multiple || null, style: 'display:none' });
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input); input.click();
  });
}

/** Arrastar-e-soltar na página inteira + colar com Ctrl+V. */
export function acceptDrops(onFiles) {
  let depth = 0, overlay = null;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const show = () => {
    if (overlay) return;
    overlay = el('div', { class: 'drop-overlay' }, el('div', { html: 'Solte para começar<small>PNG, JPG, WebP e outros formatos de imagem</small>' }));
    document.body.append(overlay);
  };
  const hide = () => { depth = 0; overlay?.remove(); overlay = null; };
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; show(); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) hide(); });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); hide();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || /\.(svg|ico|avif|bmp|gif)$/i.test(f.name));
    if (files.length) onFiles(files); else toast('Esse arquivo não parece ser uma imagem.', { error: true });
  });
  window.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input[type="text"], textarea')) return;
    const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); onFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `colada-${Date.now()}${i ? '-' + i : ''}.png`, { type: f.type })))); }
  });
}

/* ------------------------------------------------------------------ cabeçalho */
export const NAV = [
  { id: 'remover', href: './', label: 'Remover fundo', icon: 'cut' },
  { id: 'converter', href: './converter', label: 'Converter', icon: 'convert' }
];

export function mountHeader(active, { extra, base = '' } = {}) {
  injectSprite();
  const host = $('#topbar');
  let themeBtn = $('.theme-btn', host);
  if (!themeBtn) {                       // página sem cabeçalho estático: monta aqui
    const href = h => (base ? base + h.slice(2) : h);
    host.innerHTML = '';
    const brand = el('a', { class: 'brand', href: href('./'), 'aria-label': 'Silhueta, página inicial', html: markSvg('hd') + '<span>Silhueta</span>' });
    const nav = el('nav', { class: 'nav', 'aria-label': 'Ferramentas' }, NAV.map(n =>
      el('a', { href: href(n.href), 'aria-current': n.id === active ? 'page' : null, html: icon(n.icon) + `<span>${n.label}</span>` })));
    themeBtn = el('button', { class: 'btn icon ghost theme-btn', type: 'button', title: 'Aparência', 'aria-label': 'Aparência', 'aria-haspopup': 'menu', html: icon('palette') });
    host.append(brand, nav, el('span', { class: 'spacer' }), el('div', { class: 'topbar-actions' }, themeBtn));
  }
  host.className = 'topbar glass';
  if (extra) $('.topbar-actions', host).prepend(...[].concat(extra));
  themeMenu(themeBtn);
}

function themeMenu(btn) {
  let pop = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = e => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  btn.addEventListener('click', () => {
    if (pop) { close(); return; }
    pop = el('div', { class: 'popover glass', role: 'menu', style: 'right:0; top:calc(100% + 10px)' });
    pop.append(el('div', { class: 'cap' }, 'Aparência'));
    const T = window.SilhuetaTheme;
    T.list.forEach((t, i) => {
      if (i === 2) { pop.append(el('div', { class: 'sep' }), el('div', { class: 'cap' }, 'Protótipos de cor')); }
      const item = el('button', { class: 'item', type: 'button', role: 'menuitemradio', 'aria-checked': t.id === T.current ? 'true' : 'false',
        html: `<span class="dot" style="background:${t.dot}"></span><span>${t.name}</span>${icon('check', 'check')}` });
      item.addEventListener('click', () => { T.set(t.id); $$('.item', pop).forEach(x => x.setAttribute('aria-checked', String(x === item))); });
      pop.append(item);
    });
    btn.parentElement.style.position = 'relative';
    btn.parentElement.append(pop);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  });
}

/** Fundo com esferas suaves (e, no editor, a foto desfocada atrás do vidro). */
export function mountAmbient() {
  if ($('.ambient')) return $('.ambient .photo');
  const a = el('div', { class: 'ambient', 'aria-hidden': 'true' }, el('i', { class: 'orb a' }), el('i', { class: 'orb b' }), el('i', { class: 'orb c' }), el('div', { class: 'photo' }));
  document.body.prepend(a);
  return $('.photo', a);
}

/** Liga o preenchimento do slider (variável --p) e o valor mostrado. */
export function paintRange(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
}
