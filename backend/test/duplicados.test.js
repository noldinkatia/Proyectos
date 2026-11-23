import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { PGlite, types } from '@electric-sql/pglite';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { mensajePosibleDuplicado } from '../alertas.js';
import { initializeDatabase } from '../db.js';
import { comoPool } from '../demo-visual.js';
import { createApp } from '../server.js';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Reportes duplicados: el aviso "Posible reporte duplicado" legible (sin IDs) y el
// icono de la bandeja, que sale solo en el reporte más reciente (el que disparó el
// aviso), nunca en el original. La regla de detección (alertas.js) no cambia.
// Servidor sobre PGlite en memoria (sin PostgreSQL); interfaz con DOM falso.
const publicDir = new URL('../../public/', import.meta.url);
const secret = 'test-secret-with-at-least-thirty-two-characters';

test('mensaje: nombre, edad, ciudad y fecha del caso parecido, sin IDs', () => {
  const texto = mensajePosibleDuplicado(
    { id: 'cas_nuevo', nombre_completo: 'Mia Chamorro', edad: 25, ciudad: 'Asunción' },
    { id: 'cas_fe69dd10-aaaa', nombre_completo: 'Mía Chamorro', edad: 25, ciudad: 'Asunción', creado_en: new Date('2026-11-22T15:00:00Z') }
  );
  assert.equal(texto, 'El reporte de Mia Chamorro (25 años, Asunción) se parece al caso de Mía Chamorro (25 años, Asunción) reportado el 22/11. No se envió alerta temprana a la zona.');
  assert.doesNotMatch(texto, /cas_|[0-9a-f]{8}-/);
  // La fecha es la de Paraguay (UTC−3): las 01:00 UTC del 23 son el 22 a la noche.
  assert.match(mensajePosibleDuplicado({ nombre_completo: 'A', edad: 3, ciudad: 'Luque' },
    { nombre_completo: 'A', edad: 3, ciudad: 'Luque', creado_en: '2026-11-23T01:00:00Z' }), /reportado el 22\/11\./);
});

async function app() {
  const pg = await PGlite.create({ parsers: { [types.INT8]: valor => valor } });
  const db = comoPool(pg);
  await initializeDatabase(db);
  const hash = await bcrypt.hash('Clave-de-prueba-1', 4);
  const usuario = async (correo, rol) => (await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
    VALUES ($1, $2, $3, $4, TRUE, TRUE, CURRENT_TIMESTAMP) RETURNING id
  `, [correo, correo, hash, rol])).rows[0].id;
  await usuario('admin@gmail.com', 'administrador');
  await usuario('uno@gmail.com', 'ciudadano');
  await usuario('dos@gmail.com', 'ciudadano');
  const push = { disponible: false, programar() {} };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const pedir = async (metodo, ruta, token, cuerpo) => {
    const r = await fetch(`${api}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    return { status: r.status, data: await r.json() };
  };
  const token = async correo => (await pedir('POST', '/auth/login', null, { correo, contrasena: 'Clave-de-prueba-1' })).data.token;
  const reportar = (tk, nombre, { lat = -25.2867, lng = -57.6333, edad = 25 } = {}) => pedir('POST', '/casos', tk, {
    nombreCompleto: nombre, edad, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
    descripcionFisica: 'Alta', vestimenta: 'Remera', fechaHoraDesaparicion: new Date().toISOString(),
    ubicacion: { lat, lng, direccion: 'Asunción' },
    declaraMayorEdad: true, avisoPrivacidadAceptado: true, declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION
  });
  return { db, pedir, token, reportar, cerrar: async () => { await new Promise(r => server.close(r)); await db.end(); } };
}

test('servidor: el aviso legible va con el reporte nuevo y solo ese queda marcado en el panel', { timeout: 60_000 }, async () => {
  const a = await app();
  try {
    const original = await a.reportar(await a.token('uno@gmail.com'), 'Mia Chamorro');
    assert.equal(original.status, 201);
    // Otro ciudadano, mismo nombre (con tilde), edad ±1 y a pocos km: posible duplicado.
    const nuevo = await a.reportar(await a.token('dos@gmail.com'), 'Mía  Chamorro', { edad: 26, lat: -25.30 });
    assert.equal(nuevo.status, 201);
    // Y uno que no se parece (otro nombre): sin aviso.
    const distinto = await a.reportar(await a.token('dos@gmail.com'), 'Katia Noldin');
    assert.equal(distinto.status, 201);

    const { rows: avisos } = await a.db.query("SELECT caso_id, titulo, mensaje FROM notificaciones WHERE tipo = 'CASO_POSIBLE_DUPLICADO'");
    assert.equal(avisos.length, 1, 'un aviso por administrador, solo para el reporte nuevo');
    assert.equal(avisos[0].caso_id, nuevo.data.caso.id);
    assert.equal(avisos[0].titulo, 'Posible reporte duplicado');
    assert.match(avisos[0].mensaje, /^El reporte de Mía {2}Chamorro \(26 años, Asunción\) se parece al caso de Mia Chamorro \(25 años, Asunción\) reportado el \d{2}\/\d{2}\. No se envió alerta temprana a la zona\.$/);
    assert.doesNotMatch(avisos[0].mensaje, /cas_/, 'sin IDs');

    const panel = (await a.pedir('GET', '/admin/casos', await a.token('admin@gmail.com'))).data.casos;
    const marca = Object.fromEntries(panel.map(c => [c.id, c.posibleDuplicado]));
    assert.equal(marca[nuevo.data.caso.id], true, 'el más reciente');
    assert.equal(marca[original.data.caso.id], false, 'nunca el original');
    assert.equal(marca[distinto.data.caso.id], false);
    // Solo en el panel: la respuesta del dueño no lo trae.
    assert.ok(!('posibleDuplicado' in nuevo.data.caso));
  } finally {
    await a.cerrar();
  }
});

// ---------- Interfaz ----------
const { renderAdminView, iconoPosibleDuplicado, alternarAvisoDuplicado } = await import(new URL('js/admin.js', publicDir));
const { casoEnPanelHtml } = await import(new URL('js/notifications.js', publicDir));

const caso = (id, extra = {}) => ({
  id, estado: 'PENDIENTE', nombreCompleto: `Persona ${id}`, edad: 25, ciudad: 'Asunción', fechaCreacion: '2026-11-23T12:00:00Z', ...extra
});

function bandeja(casos) {
  const dom = instalarDom();
  try {
    globalThis.window.backendCaseData.casos = casos;
    const html = renderAdminView({ casos: [] }, [], []);
    return html.slice(html.indexOf('data-admin-panel="validation"'), html.indexOf('data-admin-panel="cases"'));
  } finally {
    dom.restaurar();
  }
}

const filas = html => Object.fromEntries([...html.matchAll(/<tr id="validation-case-([^"]+)">([\s\S]*?)<\/tr>/g)].map(([, id, fila]) => [id, fila]));

test('bandeja: columna sin título visible (solo para lectores de pantalla) entre Caso y Estado', () => {
  const html = bandeja([caso('c1')]);
  assert.match(html, /<thead><tr><th>Caso<\/th><th class="celda-alerta"><span class="sr-only">Alerta<\/span><\/th><th>Estado<\/th>/);
  const celdas = [...filas(html).c1.matchAll(/<td[^>]*data-label="([^"]+)"/g)].map(([, etiqueta]) => etiqueta);
  assert.deepEqual(celdas.slice(0, 3), ['Caso', 'Alerta', 'Estado']);
});

test('bandeja: el icono sale solo en el reporte marcado (el más reciente), no en el original', () => {
  const html = bandeja([caso('nuevo', { posibleDuplicado: true }), caso('original', { posibleDuplicado: false }), caso('otro')]);
  const porId = filas(html);
  assert.match(porId.nuevo, /<td class="celda-alerta" data-label="Alerta"><button type="button" class="aviso-duplicado"/);
  // Sin icono la celda queda vacía (en celular no ocupa lugar).
  for (const id of ['original', 'otro']) {
    assert.match(porId[id], /<td class="celda-alerta" data-label="Alerta"><\/td>/, id);
    assert.doesNotMatch(porId[id], /aviso-duplicado/, id);
  }
});

test('icono: botón con aria-label, globo "Posible duplicado", triángulo con "!" y sin JavaScript inline', () => {
  assert.equal(iconoPosibleDuplicado(caso('c', { posibleDuplicado: false })), '');
  const html = iconoPosibleDuplicado(caso('c', { posibleDuplicado: true }));
  assert.match(html, /^<button type="button" class="aviso-duplicado" aria-label="Posible duplicado" data-on-click="alternarAvisoDuplicado\(this\)">/);
  assert.match(html, /<span class="aviso-duplicado-globo" aria-hidden="true">Posible duplicado<\/span>/);
  assert.match(html, /<svg class="aviso-duplicado-icono"[^>]*aria-hidden="true"[^>]*><path d="M12 3\.5 2\.5 20h19L12 3\.5Z"\/><path d="M12 10v4\.5"\/><path d="M12 17\.5v\.01"\/><\/svg>/);
  assert.doesNotMatch(html, /\sonclick=|\stitle=/i);
});

test('icono: tocarlo muestra u oculta el globo (pantallas táctiles), uno abierto a la vez', () => {
  const clases = () => {
    const set = new Set();
    return { set, toggle: c => (set.has(c) ? (set.delete(c), false) : (set.add(c), true)), remove: c => set.delete(c) };
  };
  const a = { classList: clases() };
  const b = { classList: clases() };
  const anterior = globalThis.document;
  globalThis.document = { querySelectorAll: () => [a, b].filter(x => x.classList.set.has('abierto')) };
  try {
    assert.equal(alternarAvisoDuplicado(a), true);
    assert.equal(alternarAvisoDuplicado(b), true);
    assert.equal(a.classList.set.has('abierto'), false, 'se cierra el otro');
    assert.equal(alternarAvisoDuplicado(b), false, 'otro toque lo cierra');
  } finally {
    globalThis.document = anterior;
  }
});

test('centro de notificaciones: "Abrir en el panel" en los avisos de reporte nuevo y de posible duplicado', () => {
  for (const tipo of ['CASO_POSIBLE_DUPLICADO', 'CASO_PENDIENTE']) {
    assert.match(casoEnPanelHtml({ tipo, casoId: 'cas_1' }), /data-case-id="cas_1" data-on-click="abrirCasoDesdeAviso\(this\.dataset\.caseId\)">Abrir en el panel<\/button>/, tipo);
  }
  assert.equal(casoEnPanelHtml({ tipo: 'CASO_VALIDADO', casoId: 'cas_1' }), '');
  assert.equal(casoEnPanelHtml({ tipo: 'CASO_POSIBLE_DUPLICADO' }), '', 'sin caso no hay a dónde ir');
});
