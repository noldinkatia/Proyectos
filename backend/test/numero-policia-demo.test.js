import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

// Evento: los enlaces de llamada a la policía muestran "911" pero marcan un número
// de prueba (public/js/config.js, NUMERO_POLICIA_DEMO), para que nadie llame a la
// policía de verdad desde el prototipo. Volver a 911 después del evento.
const publicDir = new URL('../../public/', import.meta.url);
const { NUMERO_POLICIA_DEMO, TEXTO_POLICIA } = await import(new URL('js/config.js', publicDir));

test('una sola constante con el número de prueba; en pantalla se sigue viendo 911', () => {
  assert.equal(NUMERO_POLICIA_DEMO, '12345678910');
  assert.equal(TEXTO_POLICIA, '911');
});

test('ficha, alerta de zona y ventana de localizado: el mismo "Llamar al 911", que marca el número de prueba', async () => {
  const { renderCaseDetailHtml } = await import(new URL('js/feed.js', publicDir));
  const { renderAlertaView } = await import(new URL('js/alerta.js', publicDir));
  const { contenidoIndicarLocalizado } = await import(new URL('js/my-cases.js', publicDir));
  const ficha = renderCaseDetailHtml({
    id: 'c1', nombreCompleto: 'Persona', edad: 30, sexo: 'Femenino', ciudad: 'Asunción', descripcionFisica: 'Alta',
    vestimenta: 'Remera', estado: 'VALIDADO', fechaHoraDesaparicion: '2026-11-01T12:00:00Z', fotoUrl: ''
  });
  const alerta = renderAlertaView({ estado: 'PENDIENTE', datos: [], distanciaKm: 5 });
  for (const [nombre, html] of [['ficha', ficha], ['alerta', alerta], ['ventana de localizado', contenidoIndicarLocalizado()]]) {
    assert.match(html, /<a class="btn btn-outline btn-sm" href="tel:12345678910">Llamar al 911<\/a>/, nombre);
    assert.doesNotMatch(html, /tel:911/, nombre);
  }
});

// Todos los archivos de public/ (sin vendor/ ni binarios).
async function archivosDeTexto(dir = publicDir) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entrada.name + (entrada.isDirectory() ? '/' : ''), dir);
    if (entrada.isDirectory()) {
      if (entrada.name !== 'vendor') salida.push(...await archivosDeTexto(url));
    } else if (/\.(js|html|css|json|webmanifest|svg)$/.test(entrada.name)) {
      salida.push(url);
    }
  }
  return salida;
}

test('ningún enlace tel: de public/ marca el 911; el HTML estático usa el número de prueba', async () => {
  const conTel = [];
  for (const url of await archivosDeTexto()) {
    const texto = await readFile(url, 'utf8');
    assert.doesNotMatch(texto, /tel:\s*911/, url.pathname);
    if (/href="tel:/.test(texto)) conTel.push(url.pathname.split('/public/')[1]);
  }
  // El HTML estático no puede importar la constante: lleva el mismo valor y un comentario.
  for (const pagina of ['Rastreopy.html', 'offline.html']) {
    const html = await readFile(new URL(pagina, publicDir), 'utf8');
    assert.match(html, /<a href="tel:12345678910">911<\/a>/, pagina);
    assert.match(html, /NUMERO_POLICIA_DEMO \(public\/js\/config\.js\)\. Número de prueba para el evento; volver a 911 después\./, pagina);
  }
  assert.deepEqual(conTel.sort(), ['Rastreopy.html', 'js/alerta.js', 'js/feed.js', 'js/my-cases.js', 'offline.html']);
});
