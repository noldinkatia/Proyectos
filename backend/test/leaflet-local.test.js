import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../server.js';

// Leaflet servido por la propia app (public/vendor/leaflet), sin unpkg.
const publicDir = new URL('../../public/', import.meta.url);
const sri = async archivo => `sha256-${createHash('sha256').update(await readFile(new URL(archivo, publicDir))).digest('base64')}`;

test('las páginas cargan Leaflet local, con su hash de integridad y sin bloquear', async () => {
  const js = await sri('vendor/leaflet/leaflet.js');
  const css = await sri('vendor/leaflet/leaflet.css');
  // Los mismos hashes que tenía desde unpkg (Leaflet 1.9.4 sin modificar).
  assert.equal(js, 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=');
  assert.equal(css, 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=');
  for (const pagina of ['Rastreopy.html', 'app/index.html']) {
    const html = await readFile(new URL(pagina, publicDir), 'utf8');
    assert.ok(html.includes(`<link rel="stylesheet" href="/vendor/leaflet/leaflet.css" integrity="${css}">`), pagina);
    assert.ok(html.includes(`<script src="/vendor/leaflet/leaflet.js" integrity="${js}" defer></script>`), `${pagina}: con defer`);
    assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /unpkg/, pagina);
    // defer corre en orden de documento: Leaflet antes que los módulos de la página.
    assert.ok(html.indexOf('/vendor/leaflet/leaflet.js') < html.indexOf('<script type="module"'), pagina);
  }
  // Git no debe convertir finales de línea de estos archivos: el CSS original trae CRLF
  // y, normalizado a LF, su hash ya no coincidiría con el de la página (en el despliegue,
  // que se construye desde Git, el navegador bloquearía Leaflet).
  const atributos = await readFile(new URL('../../.gitattributes', import.meta.url), 'utf8');
  assert.match(atributos, /^public\/vendor\/\*\* -text\r?$/m);
  const licencia = await readFile(new URL('vendor/leaflet/LICENSE.txt', publicDir), 'utf8');
  assert.match(licencia, /BSD 2-Clause License/);
  assert.match(licencia, /Volodymyr Agafonkin/);
  // Las imágenes que referencia leaflet.css (rutas relativas).
  for (const imagen of ['layers.png', 'layers-2x.png', 'marker-icon.png']) {
    await readFile(new URL(`vendor/leaflet/images/${imagen}`, publicDir));
  }
});

test('la CSP ya no permite unpkg y el servidor entrega los archivos de Leaflet', async () => {
  const app = createApp({ db: { query: async () => ({ rows: [], rowCount: 0 }) }, mailer: { sendMail: async () => {} },
    jwtSecret: 'test-secret-with-at-least-thirty-two-characters', appUrl: 'https://rastreo.example' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.doesNotMatch(csp, /unpkg/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /img-src[^;]*tile\.openstreetmap\.org/, 'las teselas siguen permitidas');
    for (const [ruta, tipo] of [['/vendor/leaflet/leaflet.js', /javascript/], ['/vendor/leaflet/leaflet.css', /css/], ['/vendor/leaflet/images/layers.png', /png/]]) {
      const r = await fetch(`${base}${ruta}`);
      assert.equal(r.status, 200, ruta);
      assert.match(r.headers.get('content-type'), tipo, ruta);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
