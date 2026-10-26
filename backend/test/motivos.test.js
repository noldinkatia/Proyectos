import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';

// Motivos obligatorios en el servidor: uno de solo espacios se rechaza con 400 y
// los válidos se guardan sin espacios de más (el diálogo de la interfaz hace lo mismo).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

test('motivos de solo espacios: 400 en rechazo, cierre, devolución, pista y cierre del ciudadano', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const casos = [];
  let server;
  let adminId;
  let citizenId;
  try {
    await initializeDatabase(db);
    const adminEmail = `motivos.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    citizenId = (await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
      VALUES ('Reportante', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id`, [`motivos.citizen.${suffix}@gmail.com`])).rows[0].id;
    const crearCaso = async estado => {
      const id = `case_${suffix}_${casos.length}`;
      casos.push(id);
      await db.query(`INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, descripcion_fisica, vestimenta,
        fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id)
        VALUES ($1, 'Persona de prueba', 30, 'Otro', 'Asunción', 'Descripción', 'Vestimenta', CURRENT_TIMESTAMP, '',
          -25.2867, -57.6333, $2, $3)`, [id, estado, citizenId]);
      return id;
    };
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const admin = jwt.sign({ id: adminId, rol: 'administrador' }, secret);
    const citizen = jwt.sign({ id: citizenId, rol: 'ciudadano' }, secret);
    const post = async (ruta, token, cuerpo) => {
      const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      return { status: r.status, data: await r.json() };
    };

    const pendiente = await crearCaso('PENDIENTE');
    const validado = await crearCaso('VALIDADO');
    const pista = `clue_${suffix}`;
    await db.query(`INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud)
      VALUES ($1, $2, $3, 'Pista', CURRENT_TIMESTAMP, -25.29, -57.63)`, [pista, validado, citizenId]);

    const vacios = ['   ', '\n\t '];
    for (const motivo of vacios) {
      assert.equal((await post(`/admin/casos/${pendiente}/estado`, admin, { estado: 'RECHAZADO', motivo })).status, 400, 'rechazo');
      assert.equal((await post(`/admin/casos/${validado}/estado`, admin, { estado: 'CERRADO', motivo })).status, 400, 'cierre');
      assert.equal((await post(`/admin/casos/${validado}/estado`, admin, { estado: 'PENDIENTE', motivo })).status, 400, 'devolver a revisión');
      assert.equal((await post(`/admin/pistas/${pista}/estado`, admin, { estado: 'RECHAZADA', motivo })).status, 400, 'pista');
      assert.equal((await post(`/casos/${validado}/seguimiento`, citizen, { accion: 'CERRAR', motivo })).status, 400, 'cierre del ciudadano');
    }
    // "Devolver a revisión" ahora también exige el motivo (antes se aceptaba sin él).
    const sinMotivo = await post(`/admin/casos/${validado}/estado`, admin, { estado: 'PENDIENTE' });
    assert.equal(sinMotivo.status, 400);
    assert.equal(sinMotivo.data.error, 'Debe indicar qué debe corregirse antes de volver a validar el caso.');
    // Nada cambió de estado con los intentos inválidos.
    const estados = (await db.query('SELECT id, estado FROM casos WHERE id = ANY($1) ORDER BY id', [casos])).rows.map(r => r.estado);
    assert.deepEqual(estados, ['PENDIENTE', 'VALIDADO']);

    // Válidos: se guardan sin espacios de más.
    assert.equal((await post(`/admin/casos/${pendiente}/estado`, admin, { estado: 'RECHAZADO', motivo: '  Datos insuficientes  ' })).status, 200);
    assert.equal((await db.query('SELECT motivo_rechazo FROM casos WHERE id = $1', [pendiente])).rows[0].motivo_rechazo, 'Datos insuficientes');
    assert.equal((await post(`/admin/casos/${validado}/estado`, admin, { estado: 'CERRADO', motivo: ' Cierre de prueba ' })).status, 200);
    assert.equal((await db.query('SELECT motivo_cierre FROM casos WHERE id = $1', [validado])).rows[0].motivo_cierre, 'Cierre de prueba');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (casos.length) {
      await db.query('DELETE FROM cambios_estado_pista WHERE pista_id IN (SELECT id FROM pistas WHERE caso_id = ANY($1))', [casos]);
      for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso', 'pistas']) {
        await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [casos]);
      }
      await db.query('DELETE FROM casos WHERE id = ANY($1)', [casos]);
    }
    await db.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.end();
  }
});
