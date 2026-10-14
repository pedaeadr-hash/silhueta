/*
 * Silhueta · tema (script clássico, carregado no <head> para não piscar)
 * ?tema=lima aplica só naquela visita (usado na galeria de protótipos); escolher no menu grava a preferência.
 */
(function () {
  var THEMES = [
    { id: 'grafite', name: 'Grafite', note: 'preto, branco e cinza', dot: 'linear-gradient(135deg,#2b2b2f,#f5f5f7)' },
    { id: 'claro',   name: 'Claro',   note: 'vidro branco',           dot: 'linear-gradient(135deg,#ffffff,#c9c9d1)' },
    { id: 'lima',    name: 'Lima',    note: 'protótipo',              dot: '#d7ff3f' },
    { id: 'aurora',  name: 'Aurora',  note: 'protótipo',              dot: 'linear-gradient(135deg,#4d8dff,#9b6bff)' },
    { id: 'brasa',   name: 'Brasa',   note: 'protótipo',              dot: 'linear-gradient(135deg,#ff9a4d,#ff4d6d)' },
    { id: 'oceano',  name: 'Oceano',  note: 'protótipo',              dot: 'linear-gradient(135deg,#2ee6d6,#1f8bff)' },
    { id: 'duna',    name: 'Duna',    note: 'protótipo',              dot: 'linear-gradient(135deg,#ffb98a,#b9532f)' }
  ];
  var ids = THEMES.map(function (t) { return t.id; });
  var fromUrl = null, saved = null;
  try { fromUrl = new URLSearchParams(location.search).get('tema'); } catch (e) { /* ignore */ }
  try { saved = localStorage.getItem('silhueta.tema'); } catch (e) { /* ignore */ }
  var current = ids.indexOf(fromUrl) > -1 ? fromUrl : ids.indexOf(saved) > -1 ? saved : 'grafite';

  function apply(id) {
    document.documentElement.setAttribute('data-theme', id);
    var light = id === 'claro' || id === 'duna';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', light ? '#ececf0' : '#000000');
  }
  apply(current);

  window.SilhuetaTheme = {
    list: THEMES,
    get current() { return current; },
    set: function (id, persist) {
      if (ids.indexOf(id) < 0) return;
      current = id; apply(id);
      if (persist !== false) { try { localStorage.setItem('silhueta.tema', id); } catch (e) { /* ignore */ } }
      document.dispatchEvent(new CustomEvent('silhueta:tema', { detail: id }));
    }
  };
})();
