/*
 * Silhueta · área de visualização: zoom, arrastar, comparar antes/depois e ferramentas de pincel.
 * Trabalha em "pixels da imagem de prévia"; quem usa converte para coordenadas normalizadas.
 */

export class Viewport {
  constructor(canvas, cursorEl, handlers = {}) {
    this.canvas = canvas;
    this.cursor = cursorEl;
    this.h = handlers;
    this.ctx = canvas.getContext('2d');
    this.iw = 0; this.ih = 0;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.layers = { result: null, original: null };
    this.mode = 'result';           // result | original | split
    this.split = 0.5;
    this.backdrop = 'checker';      // checker | dark | light
    this.frame = null;              // retângulo tracejado da moldura
    this.tool = 'move';             // move | brush | wand
    this.brushRadius = 20;          // px da imagem
    this.pointers = new Map();
    this.drag = null;
    this.space = false;
    this.raf = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.tile = null;
    this.userMoved = false;
    this.subjectDark = false;       // objeto escuro: o xadrez fica claro para ele aparecer

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('pointerleave', () => { if (!this.drag) this.cursor.hidden = true; });
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', e => { if (this.tool === 'move') { this.fit(); e.preventDefault(); } });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) { this.space = true; this.canvas.style.cursor = 'grab'; if (e.target === document.body) e.preventDefault(); } });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { this.space = false; this.updateCursorStyle(); } });
    document.addEventListener('silhueta:tema', () => { this.tile = null; this.requestDraw(); });
    this.resize();
  }

  /* ---------------------------------------------------------------- configuração */
  setImage(iw, ih) {
    const first = this.iw !== iw || this.ih !== ih;
    this.iw = iw; this.ih = ih;
    if (first) { this.userMoved = false; this.fit(); } else this.requestDraw();
  }
  setLayers(result, original) { this.layers.result = result; this.layers.original = original || this.layers.original; this.requestDraw(); }
  setMode(m) { this.mode = m; this.requestDraw(); }
  setBackdrop(b) { this.backdrop = b; this.requestDraw(); }
  setSubjectDark(d) { if (d !== this.subjectDark) { this.subjectDark = d; this.tile = null; this.requestDraw(); } }
  setFrame(r) { this.frame = r; this.requestDraw(); }
  setTool(t) { this.tool = t; this.updateCursorStyle(); this.cursor.hidden = true; }
  setBrushRadius(r) { this.brushRadius = r; this.updateCursorSize(); }

  updateCursorStyle() {
    this.canvas.style.cursor = this.space || this.tool === 'move' ? 'grab' : this.tool === 'wand' ? 'crosshair' : 'none';
  }
  updateCursorSize() {
    const d = Math.max(4, this.brushRadius * 2 * this.scale);
    this.cursor.style.width = this.cursor.style.height = `${d}px`;
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cw = Math.max(1, Math.floor(r.width)); this.ch = Math.max(1, Math.floor(r.height));
    this.canvas.width = Math.round(this.cw * this.dpr); this.canvas.height = Math.round(this.ch * this.dpr);
    this.canvas.style.width = this.cw + 'px'; this.canvas.style.height = this.ch + 'px';
    if (this.iw && !this.userMoved) this.fit(); else this.requestDraw();
  }

  /* ---------------------------------------------------------------- transformações */
  fitScale() {
    const pad = Math.min(48, this.cw * 0.06);
    return Math.min((this.cw - pad * 2) / this.iw, (this.ch - pad * 2) / this.ih);
  }
  fit() {
    if (!this.iw) return;
    this.scale = this.fitScale();
    this.tx = (this.cw - this.iw * this.scale) / 2; this.ty = (this.ch - this.ih * this.scale) / 2;
    this.userMoved = false;
    this.notify(); this.requestDraw();
  }
  setScale(s, cx = this.cw / 2, cy = this.ch / 2) {
    const min = this.fitScale() * 0.3, max = 40;
    s = Math.min(max, Math.max(min, s));
    const ix = (cx - this.tx) / this.scale, iy = (cy - this.ty) / this.scale;
    this.scale = s; this.tx = cx - ix * s; this.ty = cy - iy * s;
    this.userMoved = true;
    this.notify(); this.requestDraw();
  }
  zoomBy(f, cx, cy) { this.setScale(this.scale * f, cx, cy); }
  toImage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.tx) / this.scale, y: (clientY - r.top - this.ty) / this.scale };
  }
  notify() { this.updateCursorSize(); this.h.onView && this.h.onView(this.scale, this.scale / this.fitScale()); }

  /* ---------------------------------------------------------------- entrada */
  wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const k = e.ctrlKey ? 0.012 : 0.0016;
    this.zoomBy(Math.exp(-e.deltaY * k * (e.deltaMode === 1 ? 16 : 1)), e.clientX - r.left, e.clientY - r.top);
  }

  down(e) {
    if (!this.iw) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {                          // pinça
      this.endStroke(true);
      const [a, b] = [...this.pointers.values()];
      this.drag = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    const r = this.canvas.getBoundingClientRect(), px = e.clientX - r.left;
    if (this.mode === 'split' && Math.abs(px - (this.tx + this.split * this.iw * this.scale)) < 16) { this.drag = { type: 'split' }; return; }
    if (this.tool === 'move' || this.space || e.button === 1) {
      this.drag = { type: 'pan', x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: 0, button: e.button };
      this.canvas.style.cursor = 'grabbing'; return;
    }
    if (e.button !== 0) return;
    const p = this.toImage(e.clientX, e.clientY);
    if (this.tool === 'wand') { this.h.onWand && this.h.onWand(p, e); return; }
    this.drag = { type: 'stroke', last: p };
    this.h.onStrokeStart && this.h.onStrokeStart(p, e);
  }

  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.drag) { this.hover(e); return; }
    const d = this.drag;
    if (d.type === 'pan') { d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y)); this.tx = d.tx + e.clientX - d.x; this.ty = d.ty + e.clientY - d.y; this.userMoved = true; this.requestDraw(); }
    else if (d.type === 'split') {
      const r = this.canvas.getBoundingClientRect();
      this.split = Math.min(1, Math.max(0, (e.clientX - r.left - this.tx) / (this.iw * this.scale)));
      this.h.onSplit && this.h.onSplit(this.split); this.requestDraw();
    } else if (d.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = this.canvas.getBoundingClientRect(), cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      this.tx += (a.x + b.x) / 2 - d.cx; this.ty += (a.y + b.y) / 2 - d.cy;
      this.zoomBy(dist / d.d, cx, cy);
      d.d = dist; d.cx = (a.x + b.x) / 2; d.cy = (a.y + b.y) / 2;
    } else if (d.type === 'stroke') {
      this.hover(e);
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = this.toImage(ev.clientX, ev.clientY);
        this.h.onStrokeMove && this.h.onStrokeMove(d.last, p);
        d.last = p;
      }
    }
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.type === 'stroke') this.endStroke();
    if (d.type === 'pan' && d.moved < 4 && d.button === 0 && !this.space && this.tool === 'move') this.h.onTap && this.h.onTap(this.toImage(e.clientX, e.clientY), e);
    if (d.type === 'pinch' && this.pointers.size >= 2) return;
    this.drag = null;
    this.updateCursorStyle();
  }

  endStroke(cancel) {
    if (this.drag && this.drag.type === 'stroke') { this.h.onStrokeEnd && this.h.onStrokeEnd(!!cancel); this.drag = null; }
  }

  hover(e) {
    if (this.tool === 'move' || this.space) { this.cursor.hidden = true; return; }
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.tool === 'wand') { this.cursor.hidden = true; return; }
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  /* ---------------------------------------------------------------- desenho */
  requestDraw() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  checker() {
    if (this.tile) return this.tile;
    const cs = getComputedStyle(document.documentElement);
    let a = cs.getPropertyValue('--checker-a').trim() || '#19191c', b = cs.getPropertyValue('--checker-b').trim() || '#232327';
    if (this.subjectDark) { a = '#c9cbd2'; b = '#e7e8ec'; }           // objeto escuro sobre xadrez escuro some
    const t = document.createElement('canvas'); t.width = t.height = 24;
    const x = t.getContext('2d'); x.fillStyle = a; x.fillRect(0, 0, 24, 24); x.fillStyle = b; x.fillRect(0, 0, 12, 12); x.fillRect(12, 12, 12, 12);
    return (this.tile = this.ctx.createPattern(t, 'repeat'));
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!this.iw) return;
    const x = this.tx, y = this.ty, w = this.iw * this.scale, h = this.ih * this.scale;
    const res = this.layers.result, orig = this.layers.original;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = this.backdrop === 'dark' ? '#0c0c0e' : this.backdrop === 'light' ? '#f2f2f5' : this.checker();
    ctx.fillRect(x, y, w, h);
    ctx.imageSmoothingEnabled = this.scale < 3;
    ctx.imageSmoothingQuality = 'high';
    const showOrig = this.mode === 'original', showSplit = this.mode === 'split';
    if (res && !showOrig) ctx.drawImage(res, x, y, w, h);
    if (orig && (showOrig || showSplit)) {
      ctx.save();
      if (showSplit) { ctx.beginPath(); ctx.rect(x, y, w * this.split, h); ctx.clip(); }
      ctx.drawImage(orig, x, y, w, h);
      ctx.restore();
    }
    ctx.restore();

    if (showSplit) {
      const sx = x + w * this.split;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y + h); ctx.stroke();
      ctx.fillStyle = 'rgba(30,30,34,.85)'; ctx.strokeStyle = 'rgba(255,255,255,.5)';
      const cy = y + h / 2;
      ctx.beginPath(); ctx.arc(sx, cy, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(sx - 4, cy - 5); ctx.lineTo(sx - 8, cy); ctx.lineTo(sx - 4, cy + 5); ctx.moveTo(sx + 4, cy - 5); ctx.lineTo(sx + 8, cy); ctx.lineTo(sx + 4, cy + 5); ctx.stroke();
      ctx.restore();
    }

    if (this.frame) {
      const f = this.frame;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
      ctx.strokeRect(x + f.x * this.scale, y + f.y * this.scale, f.w * this.scale, f.h * this.scale);
      ctx.restore();
    }
  }
}

export function isTyping(e) {
  const t = e.target;
  return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !(t.type === 'range' || t.type === 'checkbox'));
}
