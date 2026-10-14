// Gera as partes estáticas das páginas (sprite de ícones, cabeçalho, ícone do app e arte do comparador)
// e grava dentro dos marcadores <!-- gen:nome --> ... <!-- /gen:nome --> dos arquivos HTML.
// Assim a página já aparece completa antes do JavaScript carregar (ou mesmo se ele não carregar).
//
// Uso:  npm run gen
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { markSvg, spriteMarkup, icon } from '../assets/js/icons.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ------------------------------------------------------------------ cabeçalho */
function header(active, base = '') {
  const href = h => (base ? base + h.slice(2) : h);
  const item = (id, h, label, ic) => `<a href="${href(h)}"${active === id ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return `<a class="brand" href="${href('./')}" aria-label="Silhueta, página inicial">${markSvg('hd')}<span>Silhueta</span></a>
    <nav class="nav" aria-label="Ferramentas">${item('remover', './', 'Remover fundo', 'cut')}${item('converter', './converter', 'Converter', 'convert')}</nav>
    <span class="spacer"></span>
    <div class="topbar-actions"><button class="btn icon ghost theme-btn" type="button" title="Aparência" aria-label="Aparência" aria-haspopup="menu">${icon('palette')}</button></div>`;
}

/* ------------------------------------------------------------------ arte do comparador (determinística) */
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function strands() {
  const r = rng(21), cx = 400, cy = 168;
  let out = '';
  for (let i = 0; i < 190; i++) {
    const a = Math.PI * (1.02 + r() * 0.96);
    const rx = 88 + r() * 8, ry = 96 + r() * 8;
    const x0 = cx + Math.cos(a) * rx, y0 = cy + Math.sin(a) * ry;
    const len = 18 + r() * 62, bend = (r() - 0.5) * 70;
    const nx = Math.cos(a), ny = Math.sin(a);
    const x1 = x0 + nx * len + bend * -ny * 0.4, y1 = y0 + ny * len + bend * nx * 0.4;
    const mx = x0 + nx * len * 0.5 + bend * -ny, my = y0 + ny * len * 0.5 + bend * nx;
    out += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke-width="${(0.7 + r() * 1.5).toFixed(2)}" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
  }
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1, y0 = 168 + r() * 40, x0 = cx + side * (84 + r() * 6);
    const len = 40 + r() * 70, bend = side * (6 + r() * 26);
    out += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}q${bend.toFixed(1)} ${(len * 0.55).toFixed(1)} ${(bend * 0.4).toFixed(1)} ${len.toFixed(1)}" stroke-width="${(0.7 + r() * 1.3).toFixed(2)}" opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

const SUBJECT = `<g id="demo-subject" transform="translate(70 0)"><path d="M214 450C224 352 318 306 400 306S576 352 586 450Z" fill="#55555c"/><path d="M368 262h64v52c-10 14-54 14-64 0Z" fill="#b4b4ba"/><ellipse cx="400" cy="152" rx="94" ry="102" fill="#4b4b54"/><ellipse cx="400" cy="194" rx="64" ry="78" fill="#d6d6dc"/><path d="M336 168C340 118 372 98 404 100c34 2 58 26 60 68-12-26-34-38-62-36-30 0-52 12-66 36Z" fill="#4b4b54"/><g fill="none" stroke="#4b4b54" stroke-linecap="round">${strands()}</g></g>`;

const demoBefore = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${SUBJECT}</defs></svg>
        <svg viewBox="0 0 800 430" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="demo-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d6b7a"/><stop offset=".55" stop-color="#8b7f8f"/><stop offset="1" stop-color="#b79b8a"/></linearGradient><filter id="demo-blur"><feGaussianBlur stdDeviation="9"/></filter></defs><rect width="800" height="430" fill="url(#demo-bg)"/><g filter="url(#demo-blur)" opacity=".85"><circle cx="110" cy="90" r="46" fill="#e9d7b8"/><circle cx="205" cy="300" r="38" fill="#9fc0c9"/><circle cx="660" cy="110" r="58" fill="#f0c9b5"/><circle cx="715" cy="320" r="42" fill="#a6b4d4"/><circle cx="545" cy="48" r="26" fill="#fff" opacity=".7"/><circle cx="60" cy="350" r="30" fill="#e8b9a4"/></g><g transform="translate(0,-14)"><use href="#demo-subject"/></g></svg>`;

const demoAfter = `<svg viewBox="0 0 800 430" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><pattern id="demo-ck" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" style="fill:var(--checker-a)"/><rect width="14" height="14" style="fill:var(--checker-b)"/><rect x="14" y="14" width="14" height="14" style="fill:var(--checker-b)"/></pattern></defs><rect width="800" height="430" fill="url(#demo-ck)"/><g transform="translate(0,-14)"><use href="#demo-subject"/></g></svg>`;

const knob = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5M15 7l5 5-5 5"/></svg>';

const NOTICE = "<div class=\"server-notice glass\" role=\"alert\"><div><b>Abra o Silhueta por um servidor local.</b> Abrir o arquivo direto do disco faz o navegador bloquear os scripts, por isso os botões não funcionam. Dê dois cliques em <code>iniciar.bat</code> (ou rode <code>npm run dev</code>) e use o endereço <code>http://localhost:5173</code>.</div></div>";

/* ------------------------------------------------------------------ gravação nos marcadores */
const pages = {
  'index.html': { header: header('remover'), heroicon: markSvg('hero'), 'demo-before': demoBefore, 'demo-after': demoAfter, knob },
  'converter.html': { header: header('converter') },
  'prototipos/index.html': { header: header('', '../') }
};

let changed = 0;
for (const [file, parts] of Object.entries(pages)) {
  const path = resolve(root, file);
  let html = await readFile(path, 'utf8');
  const all = { sprite: spriteMarkup(), notice: NOTICE, ...parts };
  for (const [name, markup] of Object.entries(all)) {
    const re = new RegExp(`(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`);
    if (!re.test(html)) { if (name !== 'sprite') console.warn(`  aviso: marcador gen:${name} não encontrado em ${file}`); continue; }
    html = html.replace(re, (_, a, b) => `${a}\n    ${markup}\n    ${b}`);
  }
  await writeFile(path, html);
  changed++;
}
console.log(`partes estáticas geradas em ${changed} arquivos`);
