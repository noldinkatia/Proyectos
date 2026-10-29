import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FIN, INICIO, PAGINAS, modulosDe } from '../ayuda-tests/modulos.js';

// modulepreload: cada página precarga en el <head> exactamente los módulos que importa.
// Si este test falla, regenerá la lista: node backend/ayuda-tests/modulos.js --escribir
const publicDir = new URL('../../public/', import.meta.url);

for (const [pagina, entradas] of Object.entries(PAGINAS)) {
  test(`${pagina}: la lista de modulepreload coincide con el grafo de imports`, async () => {
    const html = (await readFile(new URL(pagina, publicDir), 'utf8')).replace(/\r\n/g, '\n');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes(INICIO) && head.includes(FIN), 'el bloque va en el <head>');
    const bloque = head.slice(head.indexOf(INICIO), head.indexOf(FIN));
    const precargados = [...bloque.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]);
    const esperados = await modulosDe(entradas);
    assert.deepEqual(precargados, esperados, 'actualizar con: node backend/ayuda-tests/modulos.js --escribir');
    // Las entradas son los <script type="module"> de la página.
    const scripts = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(m => m[1]);
    assert.deepEqual(scripts, entradas);
    // Nada precargado de otro origen.
    assert.ok(precargados.every(m => m.startsWith('/')));
  });

  test(`${pagina}: tema-inicial.js y el CSS van antes que los modulepreload`, async () => {
    const html = (await readFile(new URL(pagina, publicDir), 'utf8')).replace(/\r\n/g, '\n');
    const head = html.slice(0, html.indexOf('</head>'));
    const inicioPrecarga = head.indexOf(INICIO);
    const tema = head.indexOf('<script src="/js/tema-inicial.js"></script>');
    assert.ok(tema !== -1 && tema < inicioPrecarga, 'tema-inicial.js antes de los modulepreload');
    const hojas = [...head.matchAll(/<link rel="stylesheet"[^>]*>/g)];
    assert.ok(hojas.length >= 2);
    for (const hoja of hojas) assert.ok(hoja.index < inicioPrecarga, hoja[0]);
    // Nada que frene el pintado después de la precarga.
    assert.doesNotMatch(head.slice(inicioPrecarga), /<link rel="stylesheet"|<script(?![^>]*\b(defer|type="module")\b)/);
  });
}

test('el grafo incluye los imports de varias líneas y las rutas absolutas de la app', async () => {
  const app = await modulosDe(PAGINAS['app/index.html']);
  for (const m of ['/js/app.js', '/app/app-movil.js', '/app/pwa.js', '/app/zona.js', '/js/dialogo.js', '/js/radio-alerta.js']) {
    assert.ok(app.includes(m), m);
  }
  const web = await modulosDe(PAGINAS['Rastreopy.html']);
  assert.ok(!web.includes('/app/app-movil.js'), 'la web no carga lo propio de la app');
});
