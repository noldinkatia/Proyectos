import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { DECLARACION_CASILLA, DECLARACION_PUNTOS, DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';
import { borrarUsuariosDePrueba } from '../ayuda-tests/limpieza.js';

// Declaración de responsabilidad al publicar un reporte (migración 007).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };
const publicDir = new URL('../../public/', import.meta.url);

test('texto de la declaración: lenguaje simple, sin citar leyes ni artículos', () => {
  const texto = [...DECLARACION_PUNTOS, DECLARACION_CASILLA].join(' ');
  assert.match(texto, /verdadera/);
  assert.match(texto, /denuncia ante la Policía, o vas a hacerla cuanto antes/);
  assert.match(texto, /consecuencias legales/);
  assert.doesNotMatch(texto, /\bley\b|art[íi]culo|art\.|N\.º|\d{4}\/\d{4}/i);
  assert.match(DECLARACION_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('el modal se pide antes de enviar y con casilla obligatoria', async () => {
  const fuente = (await readFile(new URL('js/report.js', publicDir), 'utf8')).replace(/\r\n/g, '\n');
  const inicio = fuente.indexOf('export async function handleReportSubmit(');
  const cuerpo = fuente.slice(inicio, fuente.indexOf('\n}\n', inicio));
  const modal = cuerpo.indexOf('if (!await pedirDeclaracion()) return;');
  assert.ok(modal > 0, 'pide la declaración');
  assert.ok(modal < cuerpo.indexOf("apiRequest('/casos'"), 'antes de enviar');
  assert.match(cuerpo, /newCase\.declaracionAceptada = true;\s*newCase\.declaracionVersion = DECLARACION_VERSION;/);
  const pedir = fuente.slice(fuente.indexOf('export function pedirDeclaracion('), fuente.indexOf('\n}\n', fuente.indexOf('export function pedirDeclaracion(')));
  assert.match(pedir, /casilla: DECLARACION_CASILLA/);
  assert.match(pedir, /textoCancelar: 'Volver a revisar'/);
});

test('el servidor exige la declaración vigente y guarda hora del servidor y versión', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  let server;
  let adminId;
  let citizenId;
  const casos = [];
  try {
    await initializeDatabase(db);
    const adminEmail = `declaracion.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    citizenId = (await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
      VALUES ('Reportante', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id`, [`declaracion.citizen.${suffix}@gmail.com`])).rows[0].id;
    // Sin alerta temprana para no avisar a otros usuarios de la base de pruebas.
    await db.query(`INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, descripcion_fisica, vestimenta,
      fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id, alerta_temprana_en)
      VALUES ($1, 'Previo', 30, 'Otro', 'Asunción', 'x', 'x', CURRENT_TIMESTAMP, '', -25.2867, -57.6333, 'PENDIENTE', $2, CURRENT_TIMESTAMP)`,
    [`case_${suffix}_previo`, citizenId]);
    casos.push(`case_${suffix}_previo`);
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const citizen = jwt.sign({ id: citizenId, rol: 'ciudadano' }, secret);
    const admin = jwt.sign({ id: adminId, rol: 'administrador' }, secret);
    const pedir = async (metodo, ruta, token, cuerpo) => {
      const r = await fetch(`${base}${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      return { status: r.status, data: await r.json() };
    };
    const reporte = extra => ({
      nombreCompleto: `Declaración ${suffix}`, edad: 30, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción',
      descripcionFisica: 'Descripción', vestimenta: 'Vestimenta', fechaHoraDesaparicion: new Date().toISOString(),
      ubicacion: { lat: -25.2867, lng: -57.6333 }, declaraMayorEdad: true, avisoPrivacidadAceptado: true, ...extra
    });

    const sin = await pedir('POST', '/casos', citizen, reporte({}));
    assert.equal(sin.status, 400);
    assert.equal(sin.data.error, 'Para publicar el reporte tenés que aceptar la declaración de responsabilidad.');
    assert.equal((await pedir('POST', '/casos', citizen, reporte({ declaracionAceptada: 'true', declaracionVersion: DECLARACION_VERSION }))).status, 400, 'solo true');
    const vieja = await pedir('POST', '/casos', citizen, reporte({ declaracionAceptada: true, declaracionVersion: '2020-01-01' }));
    assert.equal(vieja.status, 400);
    assert.equal(vieja.data.error, 'La declaración de responsabilidad cambió. Recargá la página para leer la versión vigente.');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM casos WHERE nombre_completo = $1', [`Declaración ${suffix}`])).rows[0].n, 0, 'ninguno se creó');

    const antes = Date.now();
    // La hora la pone el servidor: lo que mande el navegador se ignora.
    const ok = await pedir('POST', '/casos', citizen, reporte({ declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION, declaracionAceptadaEn: '2000-01-01T00:00:00Z' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    const id = ok.data.caso.id;
    casos.push(id);
    const fila = (await db.query('SELECT declaracion_aceptada_en, declaracion_version FROM casos WHERE id = $1', [id])).rows[0];
    assert.equal(fila.declaracion_version, DECLARACION_VERSION);
    assert.ok(Math.abs(new Date(fila.declaracion_aceptada_en).getTime() - antes) < 60_000, 'hora del servidor');

    // La administración la ve; el reportante y el público, no.
    const panel = (await pedir('GET', '/admin/casos', admin)).data.casos.find(c => c.id === id);
    assert.equal(panel.declaracionVersion, DECLARACION_VERSION);
    assert.ok(panel.declaracionAceptadaEn);
    for (const respuesta of [ok.data, (await pedir('GET', '/mis-casos', citizen)).data]) {
      assert.doesNotMatch(JSON.stringify(respuesta), /declaracion/i);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const ids = (await db.query('SELECT id FROM casos WHERE reportado_por_usr_id = $1', [citizenId ?? -1])).rows.map(r => r.id);
    for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso']) {
      await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [ids]);
    }
    await db.query('DELETE FROM casos WHERE id = ANY($1)', [ids]);
    await db.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await borrarUsuariosDePrueba(db, 'id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.end();
  }
});
