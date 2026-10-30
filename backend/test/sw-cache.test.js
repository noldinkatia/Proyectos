import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Estrategia de caché del service worker: fuentes e íconos con caché primero; JS, CSS
// y páginas siguen yendo primero a la red; la API no pasa por el service worker.
async function cargar({ enCache = [] } = {}) {
  const codigo = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const manejadores = {};
  const pedidosRed = [];
  const guardados = new Map(enCache.map(ruta => [ruta, `caché:${ruta}`]));
  const opcionesMatch = [];
  const caches = {
    async match(request, opciones) { opcionesMatch.push(opciones); return guardados.get(new URL(request.url).pathname) ?? undefined; },
    async open() { return { put: async (request, response) => { guardados.set(new URL(request.url).pathname, response.cuerpo); } }; }
  };
  const fetch = async request => {
    const ruta = new URL(request.url).pathname;
    pedidosRed.push(ruta);
    return { ok: true, cuerpo: `red:${ruta}`, clone() { return this; } };
  };
  vm.runInNewContext(codigo, { self: { location: { origin: 'https://rastreo.example' }, addEventListener: (t, m) => { manejadores[t] = m; } }, caches, fetch, URL, Response, console });
  const pedir = async ruta => {
    let respuesta;
    manejadores.fetch({ request: { method: 'GET', url: `https://rastreo.example${ruta}`, mode: 'no-cors' }, respondWith: p => { respuesta = p; } });
    if (!respuesta) return { sinServiceWorker: true };
    const r = await respuesta;
    return typeof r === 'string' ? r : r.cuerpo;
  };
  return { pedir, pedidosRed, guardados, opcionesMatch };
}

test('fuentes e íconos: caché primero (ignoreVary), y si no están se piden y se guardan', async () => {
  const sw = await cargar({ enCache: ['/fonts/Inter-400.woff2', '/icons/rastreopy-192.png'] });
  assert.equal(await sw.pedir('/fonts/Inter-400.woff2'), 'caché:/fonts/Inter-400.woff2');
  assert.equal(await sw.pedir('/icons/rastreopy-192.png'), 'caché:/icons/rastreopy-192.png');
  assert.deepEqual(sw.pedidosRed, [], 'sin ir a la red');
  assert.deepEqual({ ...sw.opcionesMatch[0] }, { ignoreVary: true }, 'copiado: el objeto viene de otro contexto (vm)');
  assert.equal(await sw.pedir('/fonts/Sora-700.woff2'), 'red:/fonts/Sora-700.woff2');
  assert.equal(sw.guardados.get('/fonts/Sora-700.woff2'), 'red:/fonts/Sora-700.woff2', 'queda guardada');
  assert.equal(await sw.pedir('/fonts/Sora-700.woff2'), 'red:/fonts/Sora-700.woff2');
  assert.deepEqual(sw.pedidosRed, ['/fonts/Sora-700.woff2'], 'la segunda vez sale de la caché');
});

test('JS, CSS y páginas siguen yendo primero a la red aunque estén en caché; la API no pasa por el service worker', async () => {
  const sw = await cargar({ enCache: ['/js/app.js', '/styles.css', '/app/'] });
  for (const ruta of ['/js/app.js', '/styles.css', '/app/']) assert.equal(await sw.pedir(ruta), `red:${ruta}`, ruta);
  assert.deepEqual(sw.pedidosRed, ['/js/app.js', '/styles.css', '/app/']);
  assert.deepEqual(await sw.pedir('/api/casos'), { sinServiceWorker: true });
});
