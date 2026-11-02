import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';
import { borrarUsuariosDePrueba } from '../ayuda-tests/limpieza.js';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Foto en la ficha (feed, Mis casos, panel) y vista previa antes de publicar.
// La ficha es una sola plantilla (renderCaseDetailHtml, feed.js) para la ficha
// pública, la del propio ciudadano y la vista previa del reporte.
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };
const publicDir = new URL('../../public/', import.meta.url);

const { renderCaseDetailHtml, openCaseDetail, openOwnCaseDetail } = await import(new URL('js/feed.js', publicDir));
const { estado } = await import(new URL('js/estado.js', publicDir));

const caso = extra => ({
  id: 'cas_1', nombreCompleto: 'Ana Prueba', edad: 30, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
  barrio: '', descripcionFisica: 'Alta', vestimenta: 'Remera', senasParticulares: '', estado: 'VALIDADO',
  fechaHoraDesaparicion: '2026-10-30T12:00:00Z', fotoUrl: '/api/casos/cas_1/foto', ...extra
});

test('ficha: muestra la foto del caso (pública con src, de sesión con data-protected-photo)', () => {
  const publica = renderCaseDetailHtml(caso());
  assert.match(publica, /<img class="case-detail-photo" src="\/api\/casos\/cas_1\/foto" alt="Fotografía de Ana Prueba"/);
  assert.match(publica, /shareCase\('cas_1'\)/, 'con los botones de la ficha pública');
  assert.match(publica, /status-VALIDADO">VALIDADO<\/span>/, 'la ficha pública muestra el estado real');

  const propia = renderCaseDetailHtml(caso({ fotoUrl: '/api/mis-casos/cas_1/foto' }), { fotoProtegida: true, acciones: false });
  assert.match(propia, /<img class="case-detail-photo" src="data:," data-photo-url="\/api\/mis-casos\/cas_1\/foto"[^>]*data-protected-photo>/);
  assert.doesNotMatch(propia, /shareCase|Enviar pista/, 'sin botones');

  assert.doesNotMatch(renderCaseDetailHtml(caso({ fotoUrl: '' })), /case-detail-photo/, 'sin foto no hay <img>');
});

test('ficha desde el feed y desde Mis casos: la foto llega al modal', () => {
  const dom = instalarDom();
  try {
    globalThis.window.backendCaseData.casos = [caso()];
    openCaseDetail('cas_1', { fromHistory: true });
    assert.match(dom.obtener('caseDetailContent').innerHTML, /src="\/api\/casos\/cas_1\/foto"/);
    assert.equal(dom.obtener('caseDetailModal').classList.contains('hidden'), false);

    // Mis casos: un caso en revisión, con la foto de sesión que devuelve /mis-casos.
    estado.misCasos = [caso({ id: 'cas_2', estado: 'PENDIENTE', fotoUrl: '/api/mis-casos/cas_2/foto' })];
    openOwnCaseDetail('cas_2');
    assert.match(dom.obtener('caseDetailContent').innerHTML, /data-photo-url="\/api\/mis-casos\/cas_2\/foto"[^>]*data-protected-photo/);
  } finally {
    estado.misCasos = [];
    dom.restaurar();
  }
});

test('panel: la revisión del caso muestra la foto pedida con la sesión de administración', async () => {
  const { adminAccept } = await import(new URL('js/admin.js', publicDir));
  const dom = instalarDom();
  try {
    globalThis.window.backendCaseData.casos = [caso({ estado: 'PENDIENTE', fotoUrl: '/api/admin/casos/cas_1/foto' })];
    adminAccept('cas_1');
    assert.match(dom.obtener('reviewCaseDetails').innerHTML, /data-photo-url="\/api\/admin\/casos\/cas_1\/foto"[^>]*data-protected-photo/);
  } finally {
    dom.restaurar();
  }
});

test('vista previa: nada se envía hasta "Confirmar y publicar", y un doble toque manda un solo reporte', async () => {
  const { handleReportSubmit, editarReporte, confirmarYPublicarReporte } = await import(new URL('js/report.js', publicDir));
  const dom = instalarDom({
    repNombre: 'Ana Prueba', repEdad: '30', repSexo: 'Femenino', repDepartamento: 'Capital', repCiudad: 'Asunción',
    repFisica: 'Alta', repVestimenta: 'Remera', replat: '-25.28', replng: '-57.63', repFechaHora: '2026-11-01T10:30'
  }, ['alertPreviewSection', 'reportPreview']);
  const pedidos = [];
  let responder;
  globalThis.fetch = (url, opciones) => {
    pedidos.push({ url, opciones });
    return new Promise(resolve => { responder = resolve; });
  };
  estado.reportPhotoPreviewUrl = 'blob:foto-elegida';
  const formulario = { elements: [], querySelectorAll: () => [] };
  const enviar = () => handleReportSubmit({ preventDefault() {}, currentTarget: formulario });
  try {
    await enviar();
    assert.equal(dom.obtener('alertPreviewSection').classList.contains('hidden'), false, 'primero, la alerta temprana');
    await enviar();
    assert.equal(dom.obtener('reportPreview').classList.contains('hidden'), false, 'después, la vista previa');
    assert.equal(dom.obtener('reportForm').classList.contains('hidden'), true);
    const ficha = dom.obtener('reportPreviewFicha').innerHTML;
    assert.match(ficha, /Ana Prueba/);
    assert.match(ficha, /<span class="status-tag status-PENDIENTE">EN REVISIÓN<\/span>/, 'la vista previa dice EN REVISIÓN');
    assert.match(ficha, /<img class="case-detail-photo" src="blob:foto-elegida"/, 'con la foto subida');
    assert.doesNotMatch(ficha, /shareCase|Enviar pista/);
    assert.deepEqual(pedidos, [], 'la vista previa no envía');

    editarReporte();
    assert.equal(dom.obtener('reportForm').classList.contains('hidden'), false, 'Editar vuelve al formulario');
    assert.equal(dom.obtener('repNombre').value, 'Ana Prueba', 'sin perder datos');
    await enviar();

    // Cancelar la declaración: no se envía y el botón vuelve a funcionar.
    await confirmarYPublicarReporte({ pedir: async () => false });
    assert.deepEqual(pedidos, []);
    assert.equal(dom.obtener('reportConfirmButton').disabled, false);

    // Doble toque: el segundo no hace nada mientras el primero está en curso.
    const primero = confirmarYPublicarReporte({ pedir: async () => true });
    const segundo = confirmarYPublicarReporte({ pedir: async () => true });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(pedidos.length, 1);
    assert.equal(dom.obtener('reportConfirmButton').disabled, true);
    const cuerpo = JSON.parse(pedidos[0].opciones.body);
    assert.equal(pedidos[0].url, '/api/casos');
    assert.equal(cuerpo.declaracionAceptada, true);
    assert.equal(cuerpo.declaracionVersion, DECLARACION_VERSION);
    // La hora del formulario (sin zona) viaja con la zona del navegador: la ficha
    // guardada muestra la misma hora que la vista previa.
    assert.equal(cuerpo.fechaHoraDesaparicion, new Date('2026-11-01T10:30').toISOString());
    responder({ ok: false, status: 500, json: async () => ({ error: 'Falla de prueba' }) });
    await Promise.all([primero, segundo]);
    assert.equal(pedidos.length, 1);
    assert.equal(dom.obtener('reportPreviewError').textContent, 'Falla de prueba');
    assert.equal(dom.obtener('reportConfirmButton').disabled, false, 'tras un error se puede reintentar');
  } finally {
    estado.reportPhotoPreviewUrl = '';
    estado.reportEnviando = false;
    dom.restaurar();
  }
});

test('foto con PostgreSQL: el dueño la ve en revisión, otro no; el público solo una vez publicada', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  let server;
  let adminId;
  const ciudadanos = [];
  try {
    await initializeDatabase(db);
    const adminEmail = `ficha.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    for (const nombre of ['duenio', 'otro']) {
      ciudadanos.push((await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
        VALUES ('Ciudadano', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id`, [`ficha.${nombre}.${suffix}@gmail.com`])).rows[0].id);
    }
    // Un caso previo con alerta temprana: el nuevo no avisa a otros usuarios de la base.
    await db.query(`INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, descripcion_fisica, vestimenta,
      fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id, alerta_temprana_en)
      VALUES ($1, 'Previo', 30, 'Otro', 'Asunción', 'x', 'x', CURRENT_TIMESTAMP, '', -25.2867, -57.6333, 'PENDIENTE', $2, CURRENT_TIMESTAMP)`,
    [`case_${suffix}_previo`, ciudadanos[0]]);
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const [duenio, otro] = ciudadanos.map(id => jwt.sign({ id, rol: 'ciudadano' }, secret));
    const admin = jwt.sign({ id: adminId, rol: 'administrador' }, secret);
    const pedir = (ruta, token, opciones = {}) => fetch(`${base}${ruta}`, {
      ...opciones, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }
    });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

    const creado = await pedir('/api/casos', duenio, { method: 'POST', body: JSON.stringify({
      nombreCompleto: `Ficha ${suffix}`, edad: 30, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción',
      descripcionFisica: 'Descripción', vestimenta: 'Vestimenta', fechaHoraDesaparicion: new Date().toISOString(),
      ubicacion: { lat: -25.2867, lng: -57.6333 }, declaraMayorEdad: true, avisoPrivacidadAceptado: true,
      declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION, foto: `data:image/png;base64,${png.toString('base64')}`
    }) });
    assert.equal(creado.status, 201);
    const id = (await creado.json()).caso.id;

    // Mis casos apunta a la foto de sesión, que el dueño ve aunque esté en revisión.
    const propio = (await (await pedir('/api/mis-casos', duenio)).json()).casos.find(c => c.id === id);
    assert.equal(propio.fotoUrl, `/api/mis-casos/${id}/foto`);
    const foto = await pedir(propio.fotoUrl, duenio);
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await foto.arrayBuffer()), png);
    assert.equal((await pedir(propio.fotoUrl, otro)).status, 404, 'otro ciudadano no la ve');
    assert.equal((await pedir(propio.fotoUrl)).status, 401, 'sin sesión tampoco');
    assert.equal((await pedir(`/api/casos/${id}/foto`)).status, 404, 'en revisión no es pública');

    // El panel la ve con su ruta.
    const panel = (await (await pedir('/api/admin/casos', admin)).json()).casos.find(c => c.id === id);
    assert.equal((await pedir(panel.fotoUrl, admin)).status, 200);

    // Publicado: la ficha pública trae la foto y se puede pedir sin sesión.
    await db.query("UPDATE casos SET estado = 'VALIDADO' WHERE id = $1", [id]);
    const publico = (await (await pedir(`/api/casos/${id}`)).json()).caso;
    assert.equal(publico.fotoUrl, `/api/casos/${id}/foto`);
    assert.equal((await pedir(publico.fotoUrl)).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const ids = (await db.query('SELECT id FROM casos WHERE reportado_por_usr_id = ANY($1)', [ciudadanos])).rows.map(r => r.id);
    for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso']) {
      await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [ids]);
    }
    await db.query('DELETE FROM casos WHERE id = ANY($1)', [ids]);
    await borrarUsuariosDePrueba(db, 'id = ANY($1)', [[adminId, ...ciudadanos].filter(Boolean)]);
    await db.end();
  }
});
