import assert from 'node:assert/strict';
import test from 'node:test';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Panel de administración, pestaña Pistas (DOM falso, sin servidor): "Estado" y
// "Acciones" en columnas separadas; aprobar (✓) y rechazar (✗) solo en pendientes.
const publicDir = new URL('../../public/', import.meta.url);
const { renderAdminView, accionesPistaHtml, etiquetaEstadoPista, adminModerateClue } = await import(new URL('js/admin.js', publicDir));

const pista = (id, estado, extra = {}) => ({
  id, estado, nombreCompleto: `Persona ${id}`, descripcion: 'Vista en la plaza', fechaHoraAvistamiento: '2026-11-20T12:00:00Z',
  ubicacion: { lat: -25.3, lng: -57.6, direccion: 'Asunción' }, fotosUrl: [], cambiosEstado: [], ...extra
});

// renderAdminView lee window.backendCaseData: se dibuja con el DOM falso.
function panel(pistas) {
  const dom = instalarDom();
  try {
    return renderAdminView({ casos: [] }, pistas, []);
  } finally {
    dom.restaurar();
  }
}

// Celdas de cada fila de la tabla de pistas, por data-label.
function filasPistas(html) {
  const tabla = html.slice(html.indexOf('<table class="tabla-pistas">'));
  return [...tabla.slice(0, tabla.indexOf('</table>')).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map(([, fila]) =>
    Object.fromEntries([...fila.matchAll(/<td data-label="([^"]+)">([\s\S]*?)<\/td>/g)].map(([, etiqueta, celda]) => [etiqueta, celda])));
}

test('pistas: dos columnas separadas, "Estado" y "Acciones"', () => {
  const html = panel([pista('p1', 'PENDIENTE')]);
  assert.match(html, /<thead><tr><th>Persona<\/th><th>Avistamiento y ubicación<\/th><th>Fotografías<\/th><th>Estado<\/th><th>Acciones<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(html, /Estado y acciones/);
  const [fila] = filasPistas(html);
  assert.deepEqual(Object.keys(fila), ['Persona', 'Avistamiento y ubicación', 'Fotografías', 'Estado', 'Acciones']);
  assert.doesNotMatch(fila.Estado, /<button/, 'el estado no tiene acciones');
  assert.doesNotMatch(fila.Acciones, /status-tag/, 'las acciones no tienen el estado');
});

test('pistas: la etiqueta de estado usa el estilo del panel con nombres en español', () => {
  assert.equal(etiquetaEstadoPista('PENDIENTE'), 'Pendiente');
  assert.equal(etiquetaEstadoPista('VALIDADA'), 'Aprobada');
  assert.equal(etiquetaEstadoPista('RECHAZADA'), 'Rechazada');
  const html = panel([
    pista('p1', 'PENDIENTE'),
    pista('p2', 'VALIDADA', { cambiosEstado: [{ estadoAnterior: 'PENDIENTE', estadoNuevo: 'VALIDADA', administrador: 'Admin', cambiadoEn: '2026-11-21T10:00:00Z' }] }),
    pista('p3', 'RECHAZADA', { cambiosEstado: [{ estadoAnterior: 'PENDIENTE', estadoNuevo: 'RECHAZADA', administrador: 'Admin', cambiadoEn: '2026-11-21T10:00:00Z', motivo: 'Sin datos' }] })
  ]);
  const [p1, p2, p3] = filasPistas(html);
  assert.match(p1.Estado, /<span class="status-tag status-PENDIENTE">Pendiente<\/span>/);
  assert.match(p2.Estado, /<span class="status-tag status-VALIDADA">Aprobada<\/span>/);
  assert.match(p2.Estado, /Pendiente → Aprobada · Admin/);
  assert.match(p3.Estado, /<span class="status-tag status-RECHAZADA">Rechazada<\/span>/);
  assert.match(p3.Estado, /Pendiente → Rechazada · Admin · .* · Sin datos/);
});

test('pistas: ✓ y ✗ con aria-label, title, data-on-click e icono; solo mientras está pendiente', () => {
  const pendiente = accionesPistaHtml(pista('p"1', 'PENDIENTE'));
  const botones = [...pendiente.matchAll(/<button ([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(botones.length, 2);
  const [[, aprobar, iconoAprobar], [, rechazar, iconoRechazar]] = botones;
  assert.match(aprobar, /class="btn btn-success btn-accion"/);
  assert.match(aprobar, /data-clue-id="p&quot;1" data-on-click="adminModerateClue\(this\.dataset\.clueId, 'VALIDADA'\)" aria-label="Aprobar pista" title="Aprobar pista"/);
  assert.match(rechazar, /class="btn btn-danger btn-accion"/);
  assert.match(rechazar, /data-clue-id="p&quot;1" data-on-click="adminModerateClue\(this\.dataset\.clueId, 'RECHAZADA'\)" aria-label="Rechazar pista" title="Rechazar pista"/);
  // Icono además del color (✓ y ✗), decorativo: el nombre lo da aria-label.
  assert.match(iconoAprobar, /<svg class="icono-accion"[^>]*aria-hidden="true"[^>]*><path d="M5 12\.5l4\.5 4\.5L19 7\.5"\/><\/svg>/);
  assert.match(iconoRechazar, /<svg class="icono-accion"[^>]*aria-hidden="true"[^>]*><path d="M6 6l12 12M18 6L6 18"\/><\/svg>/);
  assert.doesNotMatch(pendiente, /\sonclick=/i, 'sin JavaScript inline (CSP)');

  // Ya moderada: no ofrece nada (antes tampoco: el panel solo mostraba botones en PENDIENTE).
  for (const estado of ['VALIDADA', 'RECHAZADA']) {
    const html = accionesPistaHtml(pista('p2', estado));
    assert.doesNotMatch(html, /<button|adminModerateClue/, estado);
    assert.match(html, /Ya moderada/, estado);
  }
});

test('pistas: rechazar sigue pidiendo el motivo antes de llamar a la API', async () => {
  const pedidos = [];
  const dom = instalarDom();
  const anteriorFetch = globalThis.fetch;
  const dialogos = [];
  globalThis.document.body = { append: d => dialogos.push(d) };
  globalThis.document.createElement = () => {
    const d = {
      innerHTML: '', oyentes: {}, setAttribute() {},
      querySelector: () => ({ addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {} }),
      addEventListener(tipo, fn) { (this.oyentes[tipo] ||= []).push(fn); },
      showModal() {}, remove() {},
      close() { (this.oyentes.close || []).forEach(fn => fn()); }
    };
    return d;
  };
  globalThis.fetch = async (url, opciones = {}) => {
    pedidos.push({ url: String(url), metodo: opciones.method, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    // Rechazar: se abre el cuadro del motivo; cancelarlo no llama a la API.
    const rechazo = adminModerateClue('p1', 'RECHAZADA');
    assert.equal(dialogos.length, 1, 'pide el motivo');
    assert.match(dialogos[0].innerHTML, /Motivo del rechazo/);
    dialogos[0].close();
    await rechazo;
    assert.deepEqual(pedidos, [], 'cancelado: sin petición');
  } finally {
    globalThis.fetch = anteriorFetch;
    dom.restaurar();
  }
});
