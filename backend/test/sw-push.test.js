import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Carga public/sw.js con un "self" falso y devuelve qué avisos muestra.
async function cargarServiceWorker({ rechazarPrimero = false } = {}) {
  const codigo = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const manejadores = {};
  const mostrados = [];
  const self = {
    location: { origin: 'https://rastreo.example' },
    addEventListener: (tipo, manejador) => { manejadores[tipo] = manejador; },
    registration: {
      async showNotification(titulo, opciones) {
        if (rechazarPrimero && !mostrados.length) {
          mostrados.push({ rechazado: true });
          throw new TypeError('opción no soportada');
        }
        mostrados.push({ titulo, opciones });
      }
    }
  };
  vm.runInNewContext(codigo, { self, caches: {}, fetch() {}, URL, Response, Date, console });
  const recibir = async datos => {
    const esperas = [];
    manejadores.push({
      data: datos === undefined ? null : { json: () => (typeof datos === 'string' ? JSON.parse(datos) : datos) },
      waitUntil: promesa => esperas.push(promesa)
    });
    await Promise.all(esperas);
    return mostrados.filter(item => !item.rechazado).at(-1);
  };
  return { recibir, mostrados };
}

test('service worker: la alerta oficial suena, vibra y queda en pantalla; la temprana es discreta con botón Ver', async () => {
  const { recibir } = await cargarServiceWorker();
  const oficial = await recibir({
    titulo: 'Alerta oficial · Luque', cuerpo: 'Persona desaparecida a unos 40 km.', url: '/app/#/caso/cas_1',
    tag: 'rastreo-caso-cas_1', discreta: false
  });
  assert.equal(oficial.titulo, 'Alerta oficial · Luque');
  assert.equal(oficial.opciones.silent, false);
  assert.equal(oficial.opciones.renotify, true);
  assert.equal(oficial.opciones.requireInteraction, true);
  assert.deepEqual([...oficial.opciones.vibrate], [200, 100, 200]);
  assert.equal(oficial.opciones.tag, 'rastreo-caso-cas_1');
  assert.equal(oficial.opciones.icon, '/icons/rastreopy-192.png');
  assert.equal(oficial.opciones.badge, '/icons/rastreopy-badge-96.png');
  assert.deepEqual([oficial.opciones.lang, oficial.opciones.dir], ['es', 'ltr']);
  assert.equal(oficial.opciones.data.url, '/app/#/caso/cas_1');

  const temprana = await recibir({
    titulo: 'Alerta en tu zona · Luque', cuerpo: 'Caso en revisión, aún no verificado. A unos 40 km.',
    url: '/app/#/alerta/cas_2', tag: 'rastreo-caso-cas_2', discreta: true,
    acciones: [{ accion: 'ver', titulo: 'Ver' }, { accion: 'mal nombre', titulo: 'X' }]
  });
  assert.equal(temprana.opciones.silent, true);
  assert.equal(temprana.opciones.renotify, false);
  assert.equal(temprana.opciones.requireInteraction, false);
  assert.equal(temprana.opciones.vibrate, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(temprana.opciones.actions)), [{ action: 'ver', title: 'Ver' }]);
});

test('service worker: todo push termina en un aviso visible, aunque los datos fallen o el navegador rechace una opción', async () => {
  const { recibir } = await cargarServiceWorker();
  const roto = await recibir('{no es json');
  assert.equal(roto.titulo, 'Rastreo PY');
  assert.equal(roto.opciones.body, 'Tenés una novedad en Rastreo PY.');
  const vacio = await recibir(undefined);
  assert.equal(vacio.titulo, 'Rastreo PY');
  const externo = await recibir({ titulo: 'Hola', url: 'https://otro.example/' });
  assert.equal(externo.opciones.data.url, '/app/', 'solo direcciones del propio sitio');

  const conRechazo = await cargarServiceWorker({ rechazarPrimero: true });
  const generico = await conRechazo.recibir({ titulo: 'Alerta oficial · Luque', discreta: false, url: '/app/#/caso/cas_1' });
  assert.equal(conRechazo.mostrados.length, 2);
  assert.equal(generico.titulo, 'Rastreo PY');
  assert.equal(generico.opciones.data.url, '/app/#/caso/cas_1');
});

test('el badge de Android existe, es de 96x96 y está en el caché del service worker', async () => {
  const png = await readFile(new URL('../../public/icons/rastreopy-badge-96.png', import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [96, 96]);
  assert.equal(png[25], 6, 'RGBA: con transparencia');
  const sw = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\/icons\/rastreopy-badge-96\.png'/);
});
