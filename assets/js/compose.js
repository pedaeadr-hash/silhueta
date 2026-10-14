/*
 * Silhueta · composição final: fundo, sombra, contorno e moldura. Só usa Canvas 2D.
 * Medidas dos efeitos são "px numa imagem de 1500 px" e escalam com o tamanho real.
 */

export const LOOK_DEFAULTS = {
  bg: { type: 'none', color: '#ffffff', color2: '#cfd4dc', angle: 160, blur: 30, image: null },
  shadow: { on: false, opacity: 38, blur: 26, x: 0, y: 18, color: '#000000' },
  outline: { on: false, width: 10, color: '#ffffff' },
  frame: { trim: false, margin: 6, ratio: 'free' },
  out: { format: 'png', quality: 92, size: 'original' }
};

export const RATIOS = { free: null, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16 };

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

const unit = (w, h) => Math.max(w, h) / 1500;

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [0, '000000'];
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
}

/** Desfoque cross-browser: usa ctx.filter quando existe; senão reduz e amplia (aproxima bem). */
export function blurredCopy(src, radius) {
  const w = src.width, h = src.height, out = makeCanvas(w, h), ctx = out.getContext('2d');
  if (radius < 0.5) { ctx.drawImage(src, 0, 0); return out; }
  if ('filter' in ctx) {
    // desenha um pouco maior que o canvas para o desfoque não puxar transparência das bordas
    const pad = Math.ceil(radius * 2);
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2);
    ctx.filter = 'none';
    return out;
  }
  const f = Math.max(2, Math.round(radius / 2)), sw = Math.max(1, Math.round(w / f)), sh = Math.max(1, Math.round(h / f));
  const s = makeCanvas(sw, sh), sc = s.getContext('2d');
  sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, sw, sh);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(s, 0, 0, w, h);
  return out;
}

function coverRect(sw, sh, dw, dh) {
  const s = Math.max(dw / sw, dh / sh), w = sw * s, h = sh * s;
  return [(dw - w) / 2, (dh - h) / 2, w, h];
}

function drawBackground(ctx, fw, fh, bg, original) {
  if (bg.type === 'color') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, fw, fh); }
  else if (bg.type === 'gradient') {
    const a = (bg.angle - 90) * Math.PI / 180, cx = fw / 2, cy = fh / 2, r = Math.abs(Math.cos(a)) * fw / 2 + Math.abs(Math.sin(a)) * fh / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, bg.color); g.addColorStop(1, bg.color2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, fw, fh);
  } else if (bg.type === 'blur' && original) {
    const radius = bg.blur * unit(original.width, original.height);
    const blurred = blurredCopy(original, radius);
    ctx.drawImage(blurred, ...coverRect(blurred.width, blurred.height, fw, fh));
  } else if (bg.type === 'image' && bg.image) {
    ctx.drawImage(bg.image, ...coverRect(bg.image.naturalWidth || bg.image.width, bg.image.naturalHeight || bg.image.height, fw, fh));
  }
}

/** Silhueta preenchida com uma cor (para o contorno). */
function silhouette(sub, color) {
  const c = makeCanvas(sub.width, sub.height), x = c.getContext('2d');
  x.drawImage(sub, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Junta fundo + sombra + contorno + objeto.
 *   sub       canvas do objeto (RGBA) no tamanho w×h
 *   original  canvas da foto original (para o fundo desfocado)
 *   frame     retângulo de saída em coordenadas da imagem (pode passar das bordas); padrão = imagem inteira
 */
export function composeScene(sub, look, original, frame) {
  const w = sub.width, h = sub.height, u = unit(w, h);
  const f = frame || { x: 0, y: 0, w, h };
  const hasFx = look.bg.type !== 'none' || look.shadow.on || look.outline.on;
  if (!hasFx && !frame) return sub;

  const out = makeCanvas(f.w, f.h), ctx = out.getContext('2d');
  drawBackground(ctx, out.width, out.height, look.bg, original);
  ctx.translate(-f.x, -f.y);

  let body = sub;
  if (look.outline.on && look.outline.width > 0) {
    const R = look.outline.width * u, sil = silhouette(sub, look.outline.color);
    const pad = Math.ceil(R) + 2, c = makeCanvas(w + pad * 2, h + pad * 2), cx = c.getContext('2d');
    const rings = R > 12 ? [R, R * 0.66, R * 0.33] : [R, R * 0.5];
    for (const rr of rings) {
      const steps = Math.max(16, Math.min(72, Math.round(rr * 2.4)));
      for (let k = 0; k < steps; k++) { const a = k / steps * Math.PI * 2; cx.drawImage(sil, pad + Math.cos(a) * rr, pad + Math.sin(a) * rr); }
    }
    cx.drawImage(sil, pad, pad);
    cx.drawImage(sub, pad, pad);
    body = c;
    body._pad = pad;
  }
  const pad = body._pad || 0;

  if (look.shadow.on) {
    const s = look.shadow, BIG = w + f.w + 4000 + (f.x < 0 ? -f.x : 0);
    ctx.save();
    ctx.shadowColor = hexToRgba(s.color, s.opacity / 100);
    ctx.shadowBlur = s.blur * u;
    ctx.shadowOffsetX = s.x * u + BIG;
    ctx.shadowOffsetY = s.y * u;
    ctx.drawImage(body, -pad - BIG, -pad);
    ctx.restore();
  }
  ctx.drawImage(body, -pad, -pad);
  return out;
}

/** Retângulo de saída (coordenadas da imagem) a partir do objeto, da margem e da proporção. */
export function frameFor(bounds, w, h, look) {
  const fr = look.frame;
  if (!fr.trim && fr.ratio === 'free') return null;
  const u = unit(w, h);
  let b = bounds || { x: 0, y: 0, w, h };
  if (!fr.trim) b = { x: 0, y: 0, w, h };
  else {
    // inclui o que os efeitos desenham fora do objeto
    let ex = 0, ey = 0;
    if (look.outline.on) ex = ey = look.outline.width * u + 2;
    if (look.shadow.on) { ex = Math.max(ex, look.shadow.blur * u * 1.2 + Math.abs(look.shadow.x * u)); ey = Math.max(ey, look.shadow.blur * u * 1.2 + Math.abs(look.shadow.y * u)); }
    b = { x: b.x - ex, y: b.y - ey, w: b.w + ex * 2, h: b.h + ey * 2 };
  }
  const m = Math.max(b.w, b.h) * (fr.margin / 100);
  let x = b.x - m, y = b.y - m, fw = b.w + m * 2, fh = b.h + m * 2;
  const ratio = RATIOS[fr.ratio];
  if (ratio) {
    if (fw / fh < ratio) { const nw = fh * ratio; x -= (nw - fw) / 2; fw = nw; }
    else { const nh = fw / ratio; y -= (nh - fh) / 2; fh = nh; }
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(fw)), h: Math.max(1, Math.round(fh)) };
}

/** Reduz mantendo qualidade (passos de metade) até o lado maior ser `maxSide`. */
export function resizeCanvas(src, maxSide) {
  const big = Math.max(src.width, src.height);
  if (!maxSide || big <= maxSide) return src;
  const s = maxSide / big, tw = Math.max(1, Math.round(src.width * s)), th = Math.max(1, Math.round(src.height * s));
  let cur = src;
  while (cur.width / 2 > tw && cur.height / 2 > th) {
    const c = makeCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2)), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, c.width, c.height); cur = c;
  }
  const out = makeCanvas(tw, th), x = out.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th);
  return out;
}

export const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };

/** Codifica o canvas. JPG não tem transparência: o que for transparente vira branco. */
export async function encodeCanvas(canvas, format, quality) {
  let src = canvas;
  if (format === 'jpg') {
    src = makeCanvas(canvas.width, canvas.height);
    const x = src.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, src.width, src.height); x.drawImage(canvas, 0, 0);
  }
  const mime = MIME[format] || 'image/png';
  const blob = await new Promise(res => src.toBlob(res, mime, quality / 100));
  if (blob && blob.type === mime) return { blob, format };
  const png = await new Promise(res => canvas.toBlob(res, 'image/png'));
  return { blob: png, format: 'png', fallback: true };
}
