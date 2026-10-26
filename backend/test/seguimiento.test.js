import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { processDueFollowups } from '../followups.js';
import { createApp } from '../server.js';

// Seguimiento de casos con PostgreSQL: consultas en dos intentos, respuestas del
// reportante y simulador del administrador.
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

// Administrador, ciudadano reportante y un servidor Express de prueba. crearCaso()
// agrega casos del ciudadano; todo se borra al terminar.
async function escenario(fn) {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const casos = [];
  let server;
  let adminId;
  let citizenId;
  try {
    await initializeDatabase(db);
    const adminEmail = `seguimiento.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    citizenId = (await db.query(`
      INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
      VALUES ('Reportante de prueba', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id
    `, [`seguimiento.citizen.${suffix}@gmail.com`])).rows[0].id;
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' })
      .listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokens = {
      admin: jwt.sign({ id: adminId, rol: 'administrador' }, secret),
      citizen: jwt.sign({ id: citizenId, rol: 'ciudadano' }, secret)
    };
    const pedir = async (metodo, ruta, { token, body } = {}) => {
      const response = await fetch(`${baseUrl}${ruta}`, {
        method: metodo,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };
    const crearCaso = async ({ edad = 30, estado = 'VALIDADO', ...columnas } = {}) => {
      const id = `case_${suffix}_${casos.length}`;
      casos.push(id);
      await db.query(`
        INSERT INTO casos (
          id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
          fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id, proximo_seguimiento
        ) VALUES ($1, $2, $3, 'Otro', 'Asunción', 'Capital', 'Descripción de prueba', 'Vestimenta de prueba',
          CURRENT_TIMESTAMP, 'data:image/jpeg;base64,/9j/2Q==', -25.2867, -57.6333, $4, $5,
          CURRENT_TIMESTAMP + INTERVAL '48 hours')
      `, [id, `Persona de prueba ${casos.length}`, edad, estado, citizenId]);
      const sets = Object.keys(columnas);
      if (sets.length) {
        await db.query(`UPDATE casos SET ${sets.map((columna, i) => `${columna} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...Object.values(columnas)]);
      }
      return id;
    };
    const caso = async id => (await db.query('SELECT * FROM casos WHERE id = $1', [id])).rows[0];
    const avisos = async (id, usuario = citizenId) => (await db.query(
      'SELECT titulo, mensaje, tipo, canal FROM notificaciones WHERE caso_id = $1 AND usuario_id = $2 ORDER BY id', [id, usuario]
    )).rows;
    const vencer = id => db.query(
      "UPDATE casos SET proximo_seguimiento = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1", [id]
    );
    await fn({ db, pedir, tokens, crearCaso, caso, avisos, vencer, adminId, citizenId });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (casos.length) {
      for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso', 'pistas']) {
        await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [casos]);
      }
      await db.query('DELETE FROM casos WHERE id = ANY($1)', [casos]);
    }
    await db.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.end();
  }
}

test('seguimiento en dos intentos: 48 h primera consulta, 24 h segunda, 24 h más "Sin actualizar"', conPostgres, () => escenario(async ({ db, crearCaso, caso, avisos, vencer, adminId }) => {
  const id = await crearCaso();

  await vencer(id);
  await processDueFollowups(db);
  let c = await caso(id);
  assert.equal(c.estado, 'VALIDADO');
  assert.equal(c.seguimiento_etapa, 1);
  assert.equal(c.seguimiento_intentos, 1);
  assert.ok(new Date(c.proximo_seguimiento) - Date.now() > 23.9 * 3600_000, 'espera 24 h');
  assert.deepEqual((await avisos(id)).map(a => [a.titulo, a.tipo]), [['Consulta de seguimiento', 'SEGUIMIENTO']]);

  // Sin respuesta en 24 h: segunda pregunta, mismo tipo (mismo componente y opciones).
  await vencer(id);
  await processDueFollowups(db);
  c = await caso(id);
  assert.equal(c.estado, 'VALIDADO', 'todavía no pasa a "Sin actualizar"');
  assert.equal(c.seguimiento_etapa, 1);
  assert.equal(c.seguimiento_intentos, 2);
  assert.deepEqual((await avisos(id)).map(a => [a.titulo, a.tipo]).at(-1), ['Segunda consulta de seguimiento', 'SEGUIMIENTO']);
  assert.equal((await avisos(id, adminId)).length, 0, 'la administración aún no recibe aviso');

  // Tampoco responde la segunda: "Sin actualizar" y aviso a la administración.
  await vencer(id);
  await processDueFollowups(db);
  c = await caso(id);
  assert.equal(c.estado, 'EN_SEGUIMIENTO');
  assert.equal(c.seguimiento_etapa, 2);
  assert.equal(c.proximo_seguimiento, null);
  assert.equal((await avisos(id)).at(-1).tipo, 'SEGUIMIENTO_VENCIDO');
  assert.deepEqual((await avisos(id, adminId)).map(a => a.tipo), ['CASO_SIN_ACTUALIZAR']);
  const historial = (await db.query('SELECT estado_anterior, estado_nuevo FROM cambios_estado_caso WHERE caso_id = $1', [id])).rows;
  assert.deepEqual(historial, [{ estado_anterior: 'VALIDADO', estado_nuevo: 'EN_SEGUIMIENTO' }]);
}));

test('"Sigue activo" reinicia la consulta (48 h, intentos en 0) y la prórroga ya no existe', conPostgres, () => escenario(async ({ db, pedir, tokens, crearCaso, caso, vencer }) => {
  const id = await crearCaso();
  await vencer(id);
  await processDueFollowups(db);
  await vencer(id);
  await processDueFollowups(db);
  assert.equal((await caso(id)).seguimiento_intentos, 2);

  const prorroga = await pedir('POST', `/api/casos/${id}/seguimiento`, { token: tokens.citizen, body: { accion: 'PRORROGA' } });
  assert.equal(prorroga.status, 400);
  assert.equal(prorroga.data.error, 'La respuesta de seguimiento no es válida.');

  const sigue = await pedir('POST', `/api/casos/${id}/seguimiento`, { token: tokens.citizen, body: { accion: 'SIGUE_ACTIVA' } });
  assert.equal(sigue.status, 200);
  const c = await caso(id);
  assert.equal(c.estado, 'VALIDADO');
  assert.equal(c.seguimiento_etapa, 0);
  assert.equal(c.seguimiento_intentos, 0);
  assert.ok(new Date(c.proximo_seguimiento) - Date.now() > 47.9 * 3600_000, 'próxima consulta en 48 h');
}));

test('simulador del administrador: tres avances recorren primera consulta, segunda y "Sin actualizar"', conPostgres, () => escenario(async ({ pedir, tokens, crearCaso, caso }) => {
  const id = await crearCaso();
  const pasos = [];
  for (let paso = 0; paso < 3; paso += 1) {
    const r = await pedir('POST', '/api/admin/simulador/avanzar-48h', { token: tokens.admin });
    assert.equal(r.status, 200);
    const c = await caso(id);
    pasos.push([c.estado, c.seguimiento_etapa, c.seguimiento_intentos]);
    assert.ok(Number.isInteger(r.data.segundasConsultas));
  }
  assert.deepEqual(pasos, [['VALIDADO', 1, 1], ['VALIDADO', 1, 2], ['EN_SEGUIMIENTO', 2, 2]]);
}));

test('la migración 006 deja los casos que esperaban la primera respuesta en el segundo intento', conPostgres, () => escenario(async ({ db, crearCaso, caso, vencer }) => {
  // Caso consultado antes de la migración: etapa 1 con el contador en 0.
  const id = await crearCaso({ seguimiento_etapa: 1 });
  await db.query("DELETE FROM schema_migrations WHERE version = '006'");
  await initializeDatabase(db);
  assert.equal((await caso(id)).seguimiento_intentos, 1);
  await vencer(id);
  await processDueFollowups(db);
  const c = await caso(id);
  assert.equal(c.estado, 'VALIDADO', 'recibe la segunda pregunta, no pasa directo a "Sin actualizar"');
  assert.equal(c.seguimiento_intentos, 2);
}));
