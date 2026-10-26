import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { respuestaLimite, segundosHasta } from '../auth-routes.js';
import { createDatabase, initializeDatabase } from '../db.js';
import { createApp } from '../server.js';
import { borrarUsuariosDePrueba } from '../ayuda-tests/limpieza.js';

// Respuestas 429 de la pantalla del código: reintentarEn (segundos hasta poder volver
// a intentar) sin cambiar los límites, y sin revelar si un correo tiene cuenta.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

test('segundosHasta y el handler de express-rate-limit agregan reintentarEn', () => {
  const ahora = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(segundosHasta(new Date(ahora + 41_200), ahora), 42, 'redondea hacia arriba');
  assert.equal(segundosHasta(ahora - 5000, ahora), 0, 'nunca negativo');
  assert.equal(segundosHasta(undefined, ahora), 0);
  let enviado;
  const res = { status(codigo) { this.codigo = codigo; return this; }, json(cuerpo) { enviado = cuerpo; } };
  respuestaLimite({ rateLimit: { resetTime: new Date(Date.now() + 90_000) } }, res, null,
    { statusCode: 429, message: { error: 'Demasiadas solicitudes.' } });
  assert.equal(res.codigo, 429);
  assert.equal(enviado.error, 'Demasiadas solicitudes.');
  assert.ok(enviado.reintentarEn >= 89 && enviado.reintentarEn <= 90, String(enviado.reintentarEn));
});

async function conServidor(fn) {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const correos = [];
  const mensajes = [];
  let server;
  try {
    await initializeDatabase(db);
    server = createApp({
      db, mailer: { sendMail: async mensaje => { mensajes.push(mensaje); } },
      jwtSecret: 'test-secret-with-at-least-thirty-two-characters', appUrl: 'https://rastreo.example'
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (ruta, cuerpo) => {
      const r = await fetch(`${base}/api${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      return { status: r.status, data: await r.json() };
    };
    const correo = nombre => { const c = `${nombre}.${suffix}@gmail.com`; correos.push(c); return c; };
    await fn({ db, post, correo, mensajes });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (correos.length) {
      await db.query('DELETE FROM solicitudes_codigo WHERE correo = ANY($1)', [correos]);
      await db.query('DELETE FROM codigos_verificacion WHERE correo = ANY($1)', [correos]);
      await borrarUsuariosDePrueba(db, 'correo = ANY($1)', [correos]);
    }
    await db.end();
  }
}

const registro = correo => ({ nombre_completo: 'Persona de Prueba', correo, contrasena: 'Password-test-1', acepto_terminos: true });

test('429 con reintentarEn: un minuto entre reenvíos y 5 envíos por hora', conPostgres, () => conServidor(async ({ db, post, correo }) => {
  const ana = correo('ana');
  assert.equal((await post('/auth/registro', registro(ana))).status, 200);
  const pronto = await post('/auth/registro/reenviar', { correo: ana });
  assert.equal(pronto.status, 429);
  assert.equal(pronto.data.error, 'Espere un minuto antes de pedir otro código.');
  assert.ok(pronto.data.reintentarEn >= 1 && pronto.data.reintentarEn <= 60, String(pronto.data.reintentarEn));

  // Límite por hora: los 5 envíos ya hechos (registro + reenvío) se simulan con la tabla.
  await db.query("UPDATE codigos_verificacion SET creado_en = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE correo = $1", [ana]);
  await db.query(`INSERT INTO solicitudes_codigo (correo, proposito, creado_en)
    SELECT $1, 'registro', CURRENT_TIMESTAMP - INTERVAL '10 minutes' FROM generate_series(1, 3)`, [ana]);
  const limite = await post('/auth/registro/reenviar', { correo: ana });
  assert.equal(limite.status, 429);
  assert.equal(limite.data.error, 'Se alcanzó el límite de 5 envíos por hora para este contacto.');
  // El envío más viejo es de hace ~10 min: se libera en ~50 min.
  assert.ok(limite.data.reintentarEn > 49 * 60 && limite.data.reintentarEn <= 50 * 60, String(limite.data.reintentarEn));
}));

test('recuperación: el 429 por hora es igual exista o no la cuenta (no revela correos)', conPostgres, () => conServidor(async ({ db, post, correo }) => {
  const conCuenta = correo('concuenta');
  const sinCuenta = correo('sincuenta');
  await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado)
    VALUES ('Con cuenta', $1, 'sin-uso', 'ciudadano', TRUE)`, [conCuenta]);
  const respuestas = [];
  for (const c of [conCuenta, sinCuenta]) {
    for (let i = 0; i < 5; i += 1) assert.equal((await post('/auth/restablecer/solicitar', { correo: c })).status, 200);
    const sexta = await post('/auth/restablecer/solicitar', { correo: c });
    assert.equal(sexta.status, 429);
    respuestas.push({ error: sexta.data.error, claves: Object.keys(sexta.data).sort(), espera: sexta.data.reintentarEn });
  }
  assert.deepEqual(respuestas[0].claves, respuestas[1].claves);
  assert.equal(respuestas[0].error, respuestas[1].error);
  for (const { espera } of respuestas) assert.ok(espera > 59 * 60 && espera <= 3600, String(espera));
}));

test('tras 5 intentos fallidos el 429 trae reintentarEn 0 y reenviar responde 400 (el registro vuelve a enviarse)', conPostgres, () => conServidor(async ({ post, correo, mensajes }) => {
  const bea = correo('bea');
  assert.equal((await post('/auth/registro', registro(bea))).status, 200);
  let ultima;
  for (let i = 0; i < 5; i += 1) ultima = await post('/auth/verificar', { correo: bea, codigo: '000000' });
  assert.equal(ultima.status, 429);
  assert.deepEqual(ultima.data, { error: 'Demasiados intentos. Solicite un código nuevo.', reintentarEn: 0 });
  // El código se borró: reenviar no tiene registro pendiente; el navegador vuelve a
  // mandar el mismo /auth/registro, que cuenta para el límite de 5 por hora.
  assert.equal((await post('/auth/registro/reenviar', { correo: bea })).status, 400);
  const otra = await post('/auth/registro', registro(bea));
  assert.equal(otra.status, 200);
  const codigo = mensajes.at(-1).text.match(/código de verificación es: (\d{6})/)[1];
  assert.equal((await post('/auth/verificar', { correo: bea, codigo })).status, 201);
}));
