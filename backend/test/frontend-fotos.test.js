import assert from 'node:assert/strict';
import test from 'node:test';

// Fotos perezosas: las del inicio y las protegidas (panel, alertas) se piden recién
// cuando están a 300 px de verse (IntersectionObserver de api.js). loading="lazy" no
// alcanza: Chrome empieza a pedir a 1250-2500 px y en el inicio se pedían todas.
const publicDir = new URL('../../public/', import.meta.url);

// Un solo observador para todo el módulo (api.js lo crea una vez y lo reusa).
let observador = null;
class ObservadorFalso {
  constructor(callback, opciones) { this.callback = callback; this.opciones = opciones; this.observados = []; observador = this; }
  observe(el) { this.observados.push(el); }
  unobserve(el) { this.observados = this.observados.filter(o => o !== el); }
  entrar(el) { this.callback([{ target: el, isIntersecting: true }]); }
}
const ioAnterior = globalThis.IntersectionObserver;
globalThis.IntersectionObserver = ObservadorFalso;
test.after(() => { globalThis.IntersectionObserver = ioAnterior; });

const { loadProtectedPhotos } = await import(new URL('js/api.js', publicDir));
const { renderCasePhotos } = await import(new URL('js/feed.js', publicDir));

function imagen(url) {
  return { dataset: { photoUrl: url }, src: 'data:,', addEventListener() {}, remove() { this.quitada = true; } };
}

test('fotos protegidas: se piden recién cuando están por verse', async () => {
  const anteriores = { fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, URL: globalThis.URL.createObjectURL };
  const pedidas = [];
  globalThis.fetch = async url => { pedidas.push(url); return { ok: true, blob: async () => new Blob(['x']) }; };
  globalThis.sessionStorage = { getItem: () => 'tok' };
  globalThis.URL.createObjectURL = () => 'blob:foto';
  try {
    const fotos = [imagen('/api/admin/casos/a/foto'), imagen('/api/admin/casos/b/foto'), imagen('/api/admin/casos/c/foto')];
    await loadProtectedPhotos({ querySelectorAll: () => fotos });
    assert.deepEqual(pedidas, [], 'nada al abrir la vista');
    assert.equal(observador.opciones.rootMargin, '300px 0px');
    assert.equal(observador.observados.length, 3);
    // Una entra en pantalla: solo esa se pide, y deja de observarse.
    observador.callback([{ target: fotos[1], isIntersecting: true }, { target: fotos[2], isIntersecting: false }]);
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(pedidas, ['/api/admin/casos/b/foto']);
    assert.equal(observador.observados.length, 2);
    assert.equal(fotos[1].dataset.protectedLoaded, 'true');
    for (const foto of fotos) observador.unobserve(foto);
  } finally {
    globalThis.fetch = anteriores.fetch;
    globalThis.sessionStorage = anteriores.sessionStorage;
    globalThis.URL.createObjectURL = anteriores.URL;
  }
});

test('fotos del inicio: la <img> se crea y se pide recién cuando la tarjeta está por verse', () => {
  const anterior = globalThis.document;
  const marcadores = {};
  for (const id of ['a', 'b', 'c']) {
    marcadores[`case-photo-${id}`] = { id, isConnected: true, replaceWith(el) { this.reemplazo = el; this.isConnected = false; } };
  }
  const creadas = [];
  globalThis.document = {
    getElementById: id => marcadores[id] || null,
    createElement: () => { const img = { addEventListener() {} }; creadas.push(img); return img; }
  };
  try {
    renderCasePhotos([
      { id: 'a', foto: '/api/casos/a/foto', nombreCompleto: 'Persona A' },
      { id: 'b', foto: '/api/casos/b/foto', nombreCompleto: 'Persona B' },
      { id: 'c', foto: null, nombreCompleto: 'Sin foto' }
    ]);
    assert.equal(creadas.length, 0, 'ninguna foto pedida al dibujar el inicio');
    assert.deepEqual(observador.observados.map(m => m.id), ['a', 'b'], 'se observan los marcadores con foto');

    observador.entrar(marcadores['case-photo-b']);
    assert.equal(creadas.length, 1);
    assert.equal(marcadores['case-photo-b'].reemplazo.src, '/api/casos/b/foto');
    assert.equal(marcadores['case-photo-a'].reemplazo, undefined, 'la que sigue lejos no se pide');
    assert.deepEqual(observador.observados.map(m => m.id), ['a']);

    // Si el inicio se volvió a dibujar y el marcador ya no está, no se pide.
    marcadores['case-photo-a'].isConnected = false;
    observador.entrar(marcadores['case-photo-a']);
    assert.equal(creadas.length, 1);
  } finally {
    globalThis.document = anterior;
  }
});

test('sin IntersectionObserver (navegadores viejos) las fotos del inicio se piden en el acto', () => {
  const anteriores = { document: globalThis.document, io: globalThis.IntersectionObserver };
  const marcador = { isConnected: true, replaceWith(el) { this.reemplazo = el; } };
  globalThis.document = { getElementById: () => marcador, createElement: () => ({ addEventListener() {} }) };
  globalThis.IntersectionObserver = undefined;
  try {
    renderCasePhotos([{ id: 'z', foto: '/api/casos/z/foto', nombreCompleto: 'Persona Z' }]);
    assert.equal(marcador.reemplazo.src, '/api/casos/z/foto');
  } finally {
    globalThis.document = anteriores.document;
    globalThis.IntersectionObserver = anteriores.io;
  }
});
