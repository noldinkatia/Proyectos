import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../server.js';

// OpenStreetMap (mosaicos y Nominatim) recibe solo el origen como Referer
// (strict-origin-when-cross-origin), porque su política de uso lo pide. El resto
// del sitio sigue con Referrer-Policy: no-referrer (helmet) y la misma CSP.
const publicDir = new URL('../../public/', import.meta.url);
const { addBaseTiles, REFERRER_OSM } = await import(new URL('js/map.js', publicDir));

test('constante: solo el origen, nunca la ruta', () => {
  assert.equal(REFERRER_OSM, 'strict-origin-when-cross-origin');
});

test('mosaicos: addBaseTiles (los tres mapas) pide OpenStreetMap con esa política', async () => {
  const anterior = globalThis.L;
  const capas = [];
  globalThis.L = {
    tileLayer(url, opciones) {
      const capa = { url, opciones, addTo() { return this; }, on() { return this; } };
      capas.push(capa);
      return capa;
    }
  };
  try {
    addBaseTiles({}, {});
  } finally {
    globalThis.L = anterior;
  }
  assert.equal(capas.length, 1);
  assert.equal(capas[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(capas[0].opciones.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.match(capas[0].opciones.attribution, /OpenStreetMap/, 'atribución');
  // Los tres mapas (inicio, reporte y pista) usan addBaseTiles, no una capa propia.
  for (const archivo of ['js/map.js', 'js/report.js', 'js/lead.js']) {
    const codigo = await readFile(new URL(archivo, publicDir), 'utf8');
    assert.match(codigo, /addBaseTiles\(map, mapEl\)/, archivo);
    assert.equal((codigo.match(/L\.tileLayer\(/g) || []).length, archivo === 'js/map.js' ? 1 : 0, `${archivo}: una sola capa de mosaicos`);
  }
  // Leaflet 1.9 aplica la opción en cada <img> del mosaico.
  const leaflet = await readFile(new URL('vendor/leaflet/leaflet.js', publicDir), 'utf8');
  assert.match(leaflet, /referrerPolicy&&\(\w+\.referrerPolicy=this\.options\.referrerPolicy\)/);
});

test('Nominatim: el fetch de ubicarZona lleva la misma política', async () => {
  const { ubicarZona } = await import(new URL('js/report.js', publicDir));
  const anterior = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, opciones) => {
    pedidos.push({ url: String(url), opciones });
    return new Response(JSON.stringify([{ lat: '-25.3', lon: '-57.6' }]), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await ubicarZona(['Asunción', 'Capital']), { lat: -25.3, lng: -57.6 });
  } finally {
    globalThis.fetch = anterior;
  }
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.equal(pedidos[0].opciones.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(pedidos[0].opciones.headers.Accept, 'application/json');
});

test('la política global no cambió: no-referrer en las páginas y la misma CSP', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', appUrl: 'http://127.0.0.1' })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const ruta of ['/', '/app/', '/api/casos']) {
      const respuesta = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`);
      assert.equal(respuesta.headers.get('referrer-policy'), 'no-referrer', ruta);
      const csp = respuesta.headers.get('content-security-policy');
      assert.match(csp, /img-src 'self' data: blob: https:\/\/images\.unsplash\.com https:\/\/tile\.openstreetmap\.org;/, ruta);
      assert.match(csp, /connect-src 'self' https:\/\/nominatim\.openstreetmap\.org/, ruta);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  // Ni una <meta name="referrer"> en las páginas que cambie la política de todo el documento.
  for (const pagina of ['Rastreopy.html', 'app/index.html', 'offline.html']) {
    assert.doesNotMatch(await readFile(new URL(pagina, publicDir), 'utf8'), /<meta[^>]+name="referrer"/i, pagina);
  }
  // La política de OSM solo está en esos dos lugares (map.js y report.js).
  const enJs = [];
  for (const archivo of ['js/map.js', 'js/report.js', 'js/lead.js', 'js/feed.js', 'js/api.js', 'js/app.js']) {
    const codigo = await readFile(new URL(archivo, publicDir), 'utf8');
    if (/referrerPolicy:/.test(codigo)) enJs.push(archivo);
  }
  assert.deepEqual(enJs, ['js/map.js', 'js/report.js']);
});
