/*
 * Silhueta · worker do pipeline
 * Mantém a imagem e a máscara de cada item em memória e responde a pedidos de recorte sem travar a página.
 */
import { computeMatte, hairMatte, buildSubject } from './pipeline.js';
import { rasterizeStrokes } from './edits.js';

const items = new Map();   // id → { ctx, cache, hair: { key, data } }

const keyOf = P => (P.mode === 'color' ? 'k' + JSON.stringify(P.key) : 'm') + '|' + P.reach;

self.onmessage = e => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'set':
        items.set(m.id, { ctx: { rgba: m.rgba, w: m.w, h: m.h, coarse: m.coarse, coarseId: 1 }, cache: {}, hair: null });
        break;

      case 'coarse': {
        const it = items.get(m.id);
        if (!it) break;
        it.ctx.coarse = m.coarse; it.ctx.coarseId++; it.cache = {}; it.hair = null;
        break;
      }

      case 'drop':
        items.delete(m.id);
        break;

      case 'matte': {
        const it = items.get(m.id);
        if (!it) break;
        const t0 = performance.now();
        for (const [k, o] of items) if (k !== m.id) o.cache = {};     // só o item aberto mantém cache
        const r = computeMatte(it.ctx, m.params, it.cache);
        const ms = Math.round(performance.now() - t0);
        const alpha = r.alpha.slice(), rgb = r.rgb ? r.rgb.slice() : null;
        self.postMessage({ type: 'matte', id: m.id, seq: m.seq, w: it.ctx.w, h: it.ctx.h, alpha, rgb, ms, timing: { ...r.timing } }, rgb ? [alpha.buffer, rgb.buffer] : [alpha.buffer]);
        break;
      }

      case 'hair': {
        const it = items.get(m.id);
        if (!it) break;
        computeMatte(it.ctx, m.params, it.cache);            // garante cache.m0
        const key = keyOf(m.params) + '|' + it.ctx.coarseId;
        if (!it.hair || it.hair.key !== key) it.hair = { key, data: hairMatte(it.ctx, m.params, it.cache.m0) };
        const data = it.hair.data.slice();
        self.postMessage({ type: 'hair', id: m.id, seq: m.seq, data }, [data.buffer]);
        break;
      }

      case 'export': {
        // imagem em tamanho real; não guarda nada depois de responder
        const ctx = { rgba: m.rgba, w: m.w, h: m.h, coarse: m.coarse, coarseId: 1 };
        const step = s => self.postMessage({ type: 'progress', job: m.job, stage: s });
        step('matte');
        const cache = {}, r = computeMatte(ctx, m.params, cache);
        let hair = null;
        if (m.strokes.some(s => s.tool === 'hair')) { step('cabelo'); hair = hairMatte(ctx, m.params, cache.m0); }
        step('retoques');
        const ed = m.strokes.length ? rasterizeStrokes(m.strokes, m.w, m.h, { rgba: m.rgba, hair }) : null;
        step('final');
        const out = buildSubject(m.rgba, r.alpha, r.rgb, m.params.decontam, ed, m.w, m.h);
        self.postMessage({ type: 'export', job: m.job, w: m.w, h: m.h, rgba: out }, [out.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, job: m.job, message: String(err && err.message || err) });
  }
};
