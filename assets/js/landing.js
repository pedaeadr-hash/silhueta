/* Silhueta · landing: comportamento do comparador antes/depois.
   A arte, o ícone e o cabeçalho já vêm no HTML (gerados por scripts/gen-static.mjs), então a página aparece completa mesmo sem JavaScript. */

export function mountLanding() {
  const demo = document.getElementById('demo'), range = document.getElementById('demoRange');
  if (!demo || !range) return;
  const set = v => demo.style.setProperty('--x', v + '%');
  range.addEventListener('input', () => set(range.value));

  // pequeno convite inicial: o divisor passeia uma vez
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let t0 = null;
  const tick = ts => {
    t0 ??= ts;
    const k = (ts - t0) / 2600;
    if (k >= 1 || range.matches(':active')) return;
    const v = 46 + Math.sin(k * Math.PI * 2) * 26 * (1 - k);
    range.value = v; set(v.toFixed(2)); requestAnimationFrame(tick);
  };
  setTimeout(() => requestAnimationFrame(tick), 1100);
}
