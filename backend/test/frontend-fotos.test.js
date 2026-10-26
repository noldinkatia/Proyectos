import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Fotos perezosas: las del inicio con loading="lazy" y las protegidas (panel,
// alertas) con IntersectionObserver.
const publicDir = new URL('../../public/', import.meta.url);

function imagen(url) {
  return { dataset: { photoUrl: url }, src: 'data:,', addEventListener() {}, remove() { this.quitada = true; } };
}

test('fotos protegidas: se piden recién cuando están por verse', async () => {
  const anteriores = { IO: globalThis.IntersectionObserver, fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, URL: globalThis.URL.createObjectURL };
  const pedidas = [];
  let observadorCreado;
  globalThis.IntersectionObserver = class {
    constructor(callback, opciones) { this.callback = callback; this.opciones = opciones; this.observadas = []; observadorCreado = this; }
    observe(el) { this.observadas.push(el); }
    unobserve(el) { this.observadas = this.observadas.filter(o => o !== el); }
  };
  globalThis.fetch = async url => { pedidas.push(url); return { ok: true, blob: async () => new Blob(['x']) }; };
  globalThis.sessionStorage = { getItem: () => 'tok' };
  globalThis.URL.createObjectURL = () => 'blob:foto';
  try {
    const { loadProtectedPhotos } = await import(new URL('js/api.js', publicDir));
    const fotos = [imagen('/api/admin/casos/a/foto'), imagen('/api/admin/casos/b/foto'), imagen('/api/admin/casos/c/foto')];
    await loadProtectedPhotos({ querySelectorAll: () => fotos });
    assert.deepEqual(pedidas, [], 'nada al abrir la vista');
    assert.equal(observadorCreado.opciones.rootMargin, '300px 0px');
    assert.equal(observadorCreado.observadas.length, 3);
    // Una entra en pantalla: solo esa se pide, y deja de observarse.
    observadorCreado.callback([{ target: fotos[1], isIntersecting: true }, { target: fotos[2], isIntersecting: false }]);
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(pedidas, ['/api/admin/casos/b/foto']);
    assert.equal(observadorCreado.observadas.length, 2);
    assert.equal(fotos[1].dataset.protectedLoaded, 'true');
  } finally {
    globalThis.IntersectionObserver = anteriores.IO;
    globalThis.fetch = anteriores.fetch;
    globalThis.sessionStorage = anteriores.sessionStorage;
    globalThis.URL.createObjectURL = anteriores.URL;
  }
});

test('las fotos del inicio usan loading="lazy" antes de asignar la dirección', async () => {
  const feed = (await readFile(new URL('js/feed.js', publicDir), 'utf8')).replace(/\r\n/g, '\n');
  const cuerpo = feed.slice(feed.indexOf('export function renderCasePhotos'), feed.indexOf('export function replaceWithMissingPhoto'));
  const lazy = cuerpo.indexOf("image.loading = 'lazy';");
  assert.ok(lazy > 0 && lazy < cuerpo.indexOf('image.src = photo;'), 'lazy antes de src');
  assert.match(cuerpo, /image\.decoding = 'async';/);
});
