import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { borrarUsuariosDePrueba } from '../ayuda-tests/limpieza.js';
import { HORAS_ENTRE_CONSULTAS, HORAS_PRIMER_SEGUIMIENTO } from '../case-shared.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { ESTADOS_CASO, TRANSICIONES_PERMITIDAS, mensajeTransicionNoPermitida, transicionPermitida } from '../estados-caso.js';
import { processDueFollowups, processLocatedClosures } from '../followups.js';
import { createApp } from '../server.js';

// Estados del caso: tabla de saltos permitidos (estados-caso.js), 409 para el resto,
// CHECK de la migración 010 y las horas del seguimiento en una sola constante.
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

const PERMITIDAS = [
  ['PENDIENTE', 'VALIDADO'], ['PENDIENTE', 'RECHAZADO'], ['PENDIENTE', 'LOCALIZADO'], ['PENDIENTE', 'CERRADO'],
  ['VALIDADO', 'EN_SEGUIMIENTO'], ['VALIDADO', 'LOCALIZADO'], ['VALIDADO', 'CERRADO'], ['VALIDADO', 'PENDIENTE'],
  ['EN_SEGUIMIENTO', 'VALIDADO'], ['EN_SEGUIMIENTO', 'LOCALIZADO'], ['EN_SEGUIMIENTO', 'CERRADO'], ['EN_SEGUIMIENTO', 'PENDIENTE'],
  ['LOCALIZADO', 'CERRADO'], ['LOCALIZADO', 'EN_SEGUIMIENTO'], ['LOCALIZADO', 'PENDIENTE'],
  ['CERRADO', 'PENDIENTE'], ['CERRADO', 'EN_SEGUIMIENTO'],
  ['RECHAZADO', 'PENDIENTE']
];
const PROHIBIDAS = [['RECHAZADO', 'LOCALIZADO'], ['CERRADO', 'VALIDADO'], ['VALIDADO', 'RECHAZADO'], ['PENDIENTE', 'EN_SEGUIMIENTO']];

test('tabla de transiciones: los seis estados, los 18 saltos de los flujos actuales y nada más', () => {
  assert.deepEqual(ESTADOS_CASO, ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO']);
  const tabla = Object.entries(TRANSICIONES_PERMITIDAS).flatMap(([desde, destinos]) => destinos.map(hacia => [desde, hacia]));
  assert.deepEqual(tabla.map(String).sort(), PERMITIDAS.map(String).sort());
  for (const desde of ESTADOS_CASO) {
    for (const hacia of ESTADOS_CASO) {
      const esperado = desde === hacia || PERMITIDAS.some(([a, b]) => a === desde && b === hacia);
      assert.equal(transicionPermitida(desde, hacia), esperado, `${desde} → ${hacia}`);
    }
  }
  // CERRADO y RECHAZADO solo vuelven a revisión (y CERRADO a seguimiento).
  assert.deepEqual(TRANSICIONES_PERMITIDAS.CERRADO, ['PENDIENTE', 'EN_SEGUIMIENTO']);
  assert.deepEqual(TRANSICIONES_PERMITIDAS.RECHAZADO, ['PENDIENTE']);
  assert.equal(mensajeTransicionNoPermitida('RECHAZADO', 'LOCALIZADO'),
    'Un caso Rechazado no puede pasar a Localizado. Desde Rechazado solo puede pasar a: En revisión.');
});

test('los botones del panel solo ofrecen saltos de la tabla', async () => {
  // Botones de la pestaña Casos (admin.js) por estado de origen, como los arma renderAdminView.
  const admin = await readFile(new URL('../../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /\$\{!\['CERRADO', 'LOCALIZADO', 'RECHAZADO'\]\.includes\(c\.estado\) \? `[^`]*adminMarkLocated[^`]*adminCloseCase/);
  assert.match(admin, /\$\{c\.estado !== 'PENDIENTE' \? `[^`]*adminReturnToReview/);
  assert.match(admin, /\$\{\['CERRADO', 'LOCALIZADO', 'RECHAZADO'\]\.includes\(c\.estado\) && c\.estado !== 'RECHAZADO' \? `[^`]*adminReopenCase/);
  for (const desde of ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO']) {
    assert.ok(transicionPermitida(desde, 'LOCALIZADO') && transicionPermitida(desde, 'CERRADO'), `${desde}: localizar y cerrar`);
  }
  for (const desde of ['VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO']) {
    assert.ok(transicionPermitida(desde, 'PENDIENTE'), `${desde}: devolver o reabrir en revisión`);
  }
  for (const desde of ['LOCALIZADO', 'CERRADO']) assert.ok(transicionPermitida(desde, 'EN_SEGUIMIENTO'), `${desde}: reabrir búsqueda`);
});

test('horas del seguimiento: una sola constante para 48 h y para 24 h', async () => {
  assert.equal(HORAS_PRIMER_SEGUIMIENTO, 48);
  assert.equal(HORAS_ENTRE_CONSULTAS, 24);
  for (const archivo of ['admin-routes.js', 'case-routes.js', 'followups.js']) {
    const codigo = await readFile(new URL(`../${archivo}`, import.meta.url), 'utf8');
    assert.doesNotMatch(codigo, /INTERVAL '(48|24) hours'|\b(48|24) horas/, `${archivo}: horas escritas a mano`);
  }
  const { avisoVentanaLocalizado } = await import(new URL('../../public/js/admin.js', import.meta.url));
  assert.equal(avisoVentanaLocalizado(24), 'La ficha de una persona adulta permanecerá visible hasta 24 horas y luego se retirará del acceso público. Si es una persona menor de edad, se retira enseguida.');
  assert.match(avisoVentanaLocalizado(1), /hasta 1 hora y/);
  assert.equal(avisoVentanaLocalizado(0), 'La ficha se retirará enseguida del acceso público.');
});

// Administrador, ciudadano y servidor de prueba; crearCaso(estado, columnas) inserta
// un caso del ciudadano. Todo se borra al terminar.
async function escenario(fn) {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const casos = [];
  let server;
  let adminId;
  let citizenId;
  try {
    await initializeDatabase(db);
    const adminEmail = `transiciones.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    citizenId = (await db.query(`
      INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
      VALUES ('Reportante de prueba', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id
    `, [`transiciones.citizen.${suffix}@gmail.com`])).rows[0].id;
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tokens = {
      admin: jwt.sign({ id: adminId, rol: 'administrador' }, secret),
      citizen: jwt.sign({ id: citizenId, rol: 'ciudadano' }, secret)
    };
    const pedir = async (ruta, token, body) => {
      const response = await fetch(`${base}${ruta}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };
    const crearCaso = async (estado, columnas = {}) => {
      const id = `trans_${suffix}_${casos.length}`;
      casos.push(id);
      await db.query(`
        INSERT INTO casos (
          id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
          fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id, localizado_en
        ) VALUES ($1, $2, 30, 'Otro', 'Asunción', 'Capital', 'Descripción de prueba', 'Vestimenta de prueba',
          CURRENT_TIMESTAMP, '', -25.2867, -57.6333, $3, $4,
          CASE WHEN $3 IN ('LOCALIZADO', 'CERRADO') THEN CURRENT_TIMESTAMP END)
      `, [id, `Persona transición ${casos.length}`, estado, citizenId]);
      const sets = Object.keys(columnas);
      if (sets.length) {
        await db.query(`UPDATE casos SET ${sets.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(columnas)]);
      }
      return id;
    };
    const caso = async id => (await db.query('SELECT * FROM casos WHERE id = $1', [id])).rows[0];
    const historial = async id => (await db.query(
      'SELECT estado_anterior, estado_nuevo FROM cambios_estado_caso WHERE caso_id = $1 ORDER BY id', [id])).rows;
    await fn({ db, pedir, tokens, crearCaso, caso, historial });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (casos.length) {
      for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso', 'pistas']) {
        await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [casos]);
      }
      await db.query('DELETE FROM casos WHERE id = ANY($1)', [casos]);
    }
    await borrarUsuariosDePrueba(db, 'id = ANY($1)', [[adminId, citizenId].filter(Boolean)]);
    await db.end();
  }
}

// Lo que pide cada estado de destino además del estado (motivo, lista de validación).
const cuerpo = hacia => ({
  estado: hacia,
  ...(['RECHAZADO', 'PENDIENTE', 'CERRADO'].includes(hacia) ? { motivo: 'Motivo de prueba' } : {}),
  ...(hacia === 'VALIDADO' ? { numeroDenuncia: 'DEN-TRANSICION', verificoDenuncia: true, datosCoherentes: true, duplicadosVerificados: true, menorValidado: true } : {})
});

const cercaDe = (fecha, horas) => Math.abs(new Date(fecha).getTime() - (Date.now() + horas * 3600 * 1000)) < 5 * 60 * 1000;

test('administración: cada salto permitido funciona y queda en el historial', conPostgres, () => escenario(async ({ pedir, tokens, crearCaso, caso, historial }) => {
  for (const [desde, hacia] of PERMITIDAS) {
    const id = await crearCaso(desde);
    const respuesta = await pedir(`/api/admin/casos/${id}/estado`, tokens.admin, cuerpo(hacia));
    assert.equal(respuesta.status, 200, `${desde} → ${hacia}: ${JSON.stringify(respuesta.data)}`);
    const guardado = await caso(id);
    assert.equal(guardado.estado, hacia, `${desde} → ${hacia}`);
    assert.deepEqual(await historial(id), [{ estado_anterior: desde, estado_nuevo: hacia }]);
    // Validar o reabrir la búsqueda programa la primera consulta a las 48 h.
    if (['VALIDADO', 'EN_SEGUIMIENTO'].includes(hacia) && !['VALIDADO', 'EN_SEGUIMIENTO'].includes(desde)) {
      assert.ok(cercaDe(guardado.proximo_seguimiento, HORAS_PRIMER_SEGUIMIENTO), `${desde} → ${hacia}: consulta a las 48 h`);
    }
  }
}));

test('administración: los saltos fuera de la tabla responden 409 y no cambian nada', conPostgres, () => escenario(async ({ db, pedir, tokens, crearCaso, caso, historial }) => {
  for (const [desde, hacia] of PROHIBIDAS) {
    const id = await crearCaso(desde);
    const antes = await caso(id);
    const respuesta = await pedir(`/api/admin/casos/${id}/estado`, tokens.admin, cuerpo(hacia));
    assert.equal(respuesta.status, 409, `${desde} → ${hacia}`);
    assert.equal(respuesta.data.error, mensajeTransicionNoPermitida(desde, hacia));
    assert.deepEqual(await caso(id), antes, `${desde} → ${hacia}: el caso queda igual`);
    assert.deepEqual(await historial(id), []);
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM notificaciones WHERE caso_id = $1', [id])).rows[0].count), 0, 'sin avisos');
  }
  assert.match((await pedir(`/api/admin/casos/${await crearCaso('CERRADO')}/estado`, tokens.admin, cuerpo('VALIDADO'))).data.error,
    /^Un caso Cerrado no puede pasar a Validado\. Desde Cerrado solo puede pasar a: En revisión, En seguimiento\.$/);

  // Repetir el mismo estado: 200, sin cambios ni historial (como antes).
  const id = await crearCaso('VALIDADO');
  assert.equal((await pedir(`/api/admin/casos/${id}/estado`, tokens.admin, cuerpo('VALIDADO'))).status, 200);
  assert.deepEqual(await historial(id), []);
}));

test('reportante y procesos automáticos: sus saltos están en la tabla y usan las horas compartidas', conPostgres, () => escenario(async ({ db, pedir, tokens, crearCaso, caso, historial }) => {
  // "Sigue activa" desde EN_SEGUIMIENTO vuelve a VALIDADO y reinicia la espera de 48 h.
  const sigue = await crearCaso('EN_SEGUIMIENTO', { seguimiento_etapa: 2 });
  assert.equal((await pedir(`/api/casos/${sigue}/seguimiento`, tokens.citizen, { accion: 'SIGUE_ACTIVA' })).status, 200);
  assert.equal((await caso(sigue)).estado, 'VALIDADO');
  assert.ok(cercaDe((await caso(sigue)).proximo_seguimiento, HORAS_PRIMER_SEGUIMIENTO));
  for (const [accion, hacia] of [['LOCALIZADO', 'LOCALIZADO'], ['CERRAR', 'CERRADO']]) {
    const id = await crearCaso('VALIDADO');
    assert.equal((await pedir(`/api/casos/${id}/seguimiento`, tokens.citizen, { accion, motivo: 'Motivo de prueba' })).status, 200);
    assert.equal((await caso(id)).estado, hacia);
  }

  // Primera consulta vencida: la segunda llega a las 24 h.
  const consulta = await crearCaso('VALIDADO', { seguimiento_etapa: 0, proximo_seguimiento: new Date(Date.now() - 1000) });
  // Tercera vencida: pasa a EN_SEGUIMIENTO.
  const vencido = await crearCaso('VALIDADO', { seguimiento_etapa: 1, seguimiento_intentos: 2, proximo_seguimiento: new Date(Date.now() - 1000) });
  await processDueFollowups(db);
  assert.ok(cercaDe((await caso(consulta)).proximo_seguimiento, HORAS_ENTRE_CONSULTAS), 'segunda consulta a las 24 h');
  assert.equal((await caso(vencido)).estado, 'EN_SEGUIMIENTO');

  const localizado = await crearCaso('LOCALIZADO', { localizado_en: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
  await processLocatedClosures(db);
  assert.equal((await caso(localizado)).estado, 'CERRADO');

  for (const id of [sigue, vencido, localizado]) {
    for (const { estado_anterior: desde, estado_nuevo: hacia } of await historial(id)) {
      assert.ok(transicionPermitida(desde, hacia), `${desde} → ${hacia} fuera de la tabla`);
    }
  }
  assert.equal((await pedir('/api/admin/casos', tokens.admin)).data.ventanaLocalizadosHoras, 24, 'el panel recibe VENTANA_LOCALIZADOS_HORAS');
}));

test('migración 010: CHECK con los seis estados, idempotente y se detiene con un mensaje si hay filas inválidas', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const sql = await readFile(new URL('../migrations/010_estado_caso_valido.sql', import.meta.url), 'utf8');
  const client = await db.connect();
  try {
    await initializeDatabase(db);
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint
      WHERE conname = 'casos_estado_valido' AND conrelid = 'casos'::regclass`);
    assert.equal(rows.length, 1);
    for (const estado of ESTADOS_CASO) assert.match(rows[0].definicion, new RegExp(`'${estado}'`));
    assert.equal((await client.query("SELECT archivo FROM schema_migrations WHERE version = '010'")).rows[0]?.archivo, '010_estado_caso_valido.sql');

    // Todo dentro de una transacción que se deshace: la base de tests queda igual.
    await client.query('BEGIN');
    await client.query(sql); // con la restricción ya creada no hace nada
    const insertar = estado => client.query(`
      INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
        fecha_hora_desaparicion, foto, latitud, longitud, estado)
      VALUES ($1, 'Prueba migración', 30, 'Otro', 'Asunción', 'Capital', 'x', 'x', CURRENT_TIMESTAMP, '', -25.3, -57.6, $2)
    `, [`mig010_${randomUUID()}`, estado]);
    await client.query('SAVEPOINT antes_del_insert');
    await assert.rejects(insertar('BORRADOR'), error => error.code === '23514' && error.constraint === 'casos_estado_valido');
    await client.query('ROLLBACK TO SAVEPOINT antes_del_insert');

    // Una base vieja con un estado inválido: la migración no crea nada y explica qué corregir.
    await client.query('ALTER TABLE casos DROP CONSTRAINT casos_estado_valido');
    await insertar('BORRADOR');
    await insertar('BORRADOR');
    await client.query('SAVEPOINT antes_de_migrar');
    await assert.rejects(client.query(sql), error => /Migración 010: hay casos con un estado que no es válido: 'BORRADOR' \(2\)\. Corregilos/.test(error.message));
    await client.query('ROLLBACK TO SAVEPOINT antes_de_migrar');
    assert.equal((await client.query("SELECT COUNT(*) FROM pg_constraint WHERE conname = 'casos_estado_valido'")).rows[0].count, '0');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.end();
  }
});
