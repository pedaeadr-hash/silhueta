/* Silhueta · ícones (traço de 1.7 px, 24×24). Uso: icon('download') ou <svg class="ico"><use href="#i-download"/></svg> */

const PATHS = {
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m8.5 6.5 3.5-3.5 3.5 3.5M8.5 17.5l3.5 3.5 3.5-3.5M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5"/>',
  restore: '<path d="M14.5 5.5 18.5 9.5 10 18l-4.5.5L6 14z"/><path d="m13 7 4 4"/><path d="M4 21h6"/>',
  eraser: '<path d="m7 21-3.8-3.8a2.5 2.5 0 0 1 0-3.5l9-9a2.5 2.5 0 0 1 3.5 0l5.1 5.1a2.5 2.5 0 0 1 0 3.5L13 21"/><path d="M22 21H7"/><path d="m5 11 8 8"/>',
  hair: '<path d="M6 3.5c3 3-3 5 0 8.5s-3 5.500 0 8.500"/><path d="M12 3.500c3 3-3 5 0 8.500s-3 5.500 0 8.500"/><path d="M18 3.500c3 3-3 5 0 8.500s-3 5.500 0 8.500"/>',
  wand: '<path d="m4 20 10-10"/><path d="m14 10 2.5 2.5"/><path d="M15 4v3M13.500 5.500h3M19 9v3M17.500 10.500h3M6 4v2M5 5h2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.500a5.500 5.500 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.500a5.500 5.500 0 0 0 0 11H13"/>',
  eye: '<path d="M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12Z"/><circle cx="12" cy="12" r="2.800"/>',
  split: '<path d="M12 3v18"/><path d="M8 8.500 4.500 12 8 15.500M16 8.500l3.500 3.500-3.500 3.500"/>',
  sparkle: '<path d="M12 3.500 13.800 9l5.700 1.800-5.700 1.800L12 18l-1.800-5.400-5.700-1.800L10.200 9z"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  zoomin: '<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4.200-4.200M8.500 11h5M11 8.500v5"/>',
  zoomout: '<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4.200-4.200M8.500 11h5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.500 9 5 9-5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.400 0 2-1 1.600-2.100-.4-1.100.1-2.400 1.500-2.400H17a4 4 0 0 0 4-4C21 6.700 17 3 12 3Z"/><circle cx="7.800" cy="11" r="1"/><circle cx="10.500" cy="7.500" r="1"/><circle cx="15" cy="7.800" r="1"/>',
  keyboard: '<rect x="2.500" y="6" width="19" height="12" rx="2.500"/><path d="M6.500 10h.01M10 10h.01M14 10h.01M17.500 10h.01M7.500 14h9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l.9 12.100A1.500 1.500 0 0 0 8.400 20.500h7.200a1.500 1.500 0 0 0 1.500-1.400L18 7M9 7V4.500h6V7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.700"/><path d="m21 16-5-5-9 9"/>',
  convert: '<path d="M4 8h14l-3.500-3.500M20 16H6l3.500 3.500"/>',
  cut: '<path d="M4 4l16 16M20 4 4 20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  pipette: '<path d="m15 4 5 5-2 2-5-5z"/><path d="m13.500 7.500-9 9V20h3.500l9-9"/>',
  bolt: '<path d="M13 3 5 13.500h6L10 21l8-10.500h-6z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.500"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  folder: '<path d="M3.500 7.500A2.500 2.500 0 0 1 6 5h3.500l2 2.500H18A2.500 2.500 0 0 1 20.500 10v7A2.500 2.500 0 0 1 18 19.500H6A2.500 2.500 0 0 1 3.500 17z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>'
};

export function spriteMarkup() {
  const symbols = Object.entries(PATHS).map(([id, p]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${p}</symbol>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${symbols}</defs></svg>`;
}

export function injectSprite() {
  if (document.getElementById('i-upload')) return;
  const d = document.createElement('div');
  d.innerHTML = spriteMarkup();
  document.body.prepend(d.firstChild);
}

export const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Marca da Silhueta: quadrado de vidro com um busto recortado (metade sólida, metade tracejada). */
export const markSvg = (id = 'm') => `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--icon-a,#4a4a52)"/><stop offset="1" style="stop-color:var(--icon-b,#16161a)"/></linearGradient>
    <linearGradient id="${id}-hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="1" y="1" width="62" height="62" rx="16" fill="url(#${id}-bg)"/>
  <rect x="1.500" y="1.500" width="61" height="61" rx="15.500" fill="none" stroke="url(#${id}-hl)"/>
  <path d="M32 14.500a8.500 8.500 0 1 1 0 17 8.500 8.500 0 0 1 0-17ZM15.500 51c1.200-9 8-14 16.500-14s15.300 5 16.500 14z" style="fill:var(--icon-fg,#f5f5f7)" fill-opacity=".96" clip-path="inset(0 0 0 50%)"/>
  <path d="M32 14.500a8.500 8.500 0 0 0 0 17M15.500 51c1.200-9 8-14 16.500-14M15.500 51H32" fill="none" style="stroke:var(--icon-fg,#f5f5f7)" stroke-opacity=".9" stroke-width="2" stroke-dasharray="3.200 3.600" stroke-linecap="round"/>
</svg>`;
