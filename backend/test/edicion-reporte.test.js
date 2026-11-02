import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';
import { borrarUsuariosDePrueba } from '../ayuda-tests/limpieza.js';

// Edición directa del reporte por quien lo hizo mientras está en revisión
// (PUT /api/mis-casos/:id, migración 009).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

// En el mar, lejos de cualquier usuario de la base de pruebas: la alerta temprana
// del reporte no le llega a nadie.
const LUGAR = { lat: -60.12345, lng: -30.54321 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('edición del reporte con PostgreSQL: dueño y PENDIENTE, sin alerta nueva, con historial y tope', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  let server;
  let adminId;
  const ciudadanos = [];
  try {
    await initializeDatabase(db);
    const adminEmail = `edicion.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    for (const nombre of ['duenio', 'otro']) {
      ciudadanos.push((await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
        VALUES ('Ciudadano', $1, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id`, [`edicion.${nombre}.${suffix}@gmail.com`])).rows[0].id);
    }
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const [duenio, otro] = ciudadanos.map(id => jwt.sign({ id, rol: 'ciudadano' }, secret));
    const admin = jwt.sign({ id: adminId, rol: 'administrador' }, secret);
    const pedir = async (metodo, ruta, token, cuerpo) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    const reporte = extra => ({
      nombreCompleto: `Edición ${suffix}`, edad: 30, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción', barrio: '',
      descripcionFisica: 'Descripción', vestimenta: 'Remera roja', senasParticulares: '',
      fechaHoraDesaparicion: '2026-11-01T13:30:00.000Z', ubicacion: { ...LUGAR }, numeroDenuncia: '',
      declaraMayorEdad: true, avisoPrivacidadAceptado: true, autorizacionParental: false,
      alertaCampos: ['departamento', 'ciudad', 'foto'],
      declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION, ...extra
    });
    const fila = async id => (await db.query('SELECT * FROM casos WHERE id = $1', [id])).rows[0];
    const notificacionesDel = async id => (await db.query('SELECT COUNT(*)::int AS n FROM notificaciones WHERE caso_id = $1', [id])).rows[0].n;

    const creado = await pedir('POST', '/casos', duenio, reporte({ foto: `data:image/png;base64,${PNG}` }));
    assert.equal(creado.status, 201, JSON.stringify(creado.data));
    const id = creado.data.caso.id;
    // La alerta temprana salió hace 25 h: el reportante ya podría mandar otra.
    await db.query("UPDATE casos SET alerta_temprana_en = CURRENT_TIMESTAMP - INTERVAL '25 hours', declaracion_aceptada_en = '2026-10-01T12:00:00Z' WHERE id = $1", [id]);
    const original = await fila(id);
    const avisosAntes = await notificacionesDel(id);

    // Solo el dueño, con sesión de ciudadano.
    assert.equal((await pedir('PUT', `/mis-casos/${id}`, null, reporte({ vestimenta: 'Campera' }))).status, 401);
    assert.equal((await pedir('PUT', `/mis-casos/${id}`, otro, reporte({ vestimenta: 'Campera' }))).status, 403, 'otro ciudadano');
    assert.equal((await pedir('PUT', `/mis-casos/${id}`, admin, reporte({ vestimenta: 'Campera' }))).status, 403, 'la administración no edita como reportante');
    assert.equal((await pedir('PUT', '/mis-casos/cas_no_existe', duenio, reporte({ vestimenta: 'Campera' }))).status, 403);
    // La declaración se vuelve a pedir.
    const sinDeclaracion = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ vestimenta: 'Campera', declaracionAceptada: undefined }));
    assert.equal(sinDeclaracion.status, 400);
    assert.equal((await fila(id)).ediciones_reportante, 0);

    // Guardar sin cambios (lo que manda el formulario precargado): 400, no cuenta y el pin no se mueve.
    const igual = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ fechaHoraDesaparicion: '2026-11-01T13:30:00.000Z' }));
    assert.equal(igual.status, 400);
    assert.equal(igual.data.error, 'No hay cambios para guardar.');
    const trasIgual = await fila(id);
    assert.equal(trasIgual.ediciones_reportante, 0);
    assert.equal(trasIgual.modificado_en, null);
    assert.deepEqual([Number(trasIgual.latitud), Number(trasIgual.longitud)], [LUGAR.lat, LUGAR.lng]);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM ediciones_caso WHERE caso_id = $1', [id])).rows[0].n, 0);

    // Edición 1: ropa y pin.
    const antesDeEditar = Date.now();
    const uno = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ vestimenta: 'Campera azul', ubicacion: { lat: -60.2, lng: -30.6 } }));
    assert.equal(uno.status, 200, JSON.stringify(uno.data));
    assert.equal(uno.data.caso.estado, 'PENDIENTE');
    assert.equal(uno.data.caso.edicionesDisponibles, 4);
    const trasUno = await fila(id);
    assert.equal(trasUno.estado, 'PENDIENTE');
    assert.equal(trasUno.creado_en.getTime(), original.creado_en.getTime(), 'mantiene la fecha de creación');
    assert.equal(trasUno.proximo_seguimiento.getTime(), original.proximo_seguimiento.getTime(), 'no reinicia el seguimiento');
    assert.equal(trasUno.alerta_temprana_en.getTime(), original.alerta_temprana_en.getTime(), 'no toca la alerta temprana');
    assert.equal(trasUno.declaracion_aceptada_en.getTime(), original.declaracion_aceptada_en.getTime(), 'conserva la declaración original');
    assert.equal(trasUno.ediciones_reportante, 1);
    assert.ok(Math.abs(trasUno.modificado_en.getTime() - antesDeEditar) < 60_000);
    const [edicion] = (await db.query('SELECT * FROM ediciones_caso WHERE caso_id = $1', [id])).rows;
    assert.deepEqual(edicion.cambios, [
      { campo: 'vestimenta', anterior: 'Remera roja', nuevo: 'Campera azul' },
      { campo: 'latitud', anterior: LUGAR.lat, nuevo: -60.2 },
      { campo: 'longitud', anterior: LUGAR.lng, nuevo: -30.6 }
    ]);
    assert.equal(edicion.usuario_id, ciudadanos[0]);
    assert.equal(edicion.declaracion_version, DECLARACION_VERSION, 'la declaración que volvió a aceptar');
    assert.ok(Math.abs(edicion.declaracion_aceptada_en.getTime() - antesDeEditar) < 60_000, 'con la hora del servidor');

    // Ediciones 2 y 3: adulto → menor (exige la autorización y saca la foto de la
    // alerta) y menor → adulto.
    assert.equal((await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ vestimenta: 'Campera azul', ubicacion: { lat: -60.2, lng: -30.6 }, edad: 15 }))).status, 400, 'menor sin autorización');
    const menor = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ vestimenta: 'Campera azul', ubicacion: { lat: -60.2, lng: -30.6 }, edad: 15, autorizacionParental: true }));
    assert.equal(menor.status, 200, JSON.stringify(menor.data));
    assert.deepEqual(menor.data.caso.alertaCampos, ['departamento', 'ciudad'], 'sin foto en la alerta de una persona menor');
    const adulto = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ vestimenta: 'Campera azul', ubicacion: { lat: -60.2, lng: -30.6 }, edad: 30 }));
    assert.equal(adulto.status, 200, JSON.stringify(adulto.data));

    // Ediciones 4 y 5: la foto se reemplaza y se quita (sin guardar su contenido).
    const editadoBase = { vestimenta: 'Campera azul', ubicacion: { lat: -60.2, lng: -30.6 } };
    const reemplazo = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ ...editadoBase, fotoAccion: 'reemplazar', foto: `data:image/png;base64,${PNG}` }));
    assert.equal(reemplazo.status, 200);
    const quitada = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ ...editadoBase, fotoAccion: 'quitar' }));
    assert.equal(quitada.status, 200);
    assert.equal(quitada.data.caso.fotoUrl, '');
    assert.equal(quitada.data.caso.edicionesDisponibles, 0);

    // Tope: la sexta edición se rechaza con un mensaje claro y no cuenta.
    const sexta = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ ...editadoBase, vestimenta: 'Otra' }));
    assert.equal(sexta.status, 409);
    assert.match(sexta.data.error, /Ya editaste este reporte 5 veces/);
    assert.equal((await fila(id)).ediciones_reportante, 5);

    // Ninguna edición mandó avisos ni tocó la alerta temprana; el límite de 24 h no
    // se reinició: un reporte nuevo del mismo ciudadano sí genera su alerta.
    assert.equal(await notificacionesDel(id), avisosAntes, 'sin notificaciones nuevas');
    assert.equal((await fila(id)).alerta_temprana_en.getTime(), original.alerta_temprana_en.getTime());
    const otroCaso = await pedir('POST', '/casos', duenio, reporte({ nombreCompleto: `Otro ${suffix}`, alertaCampos: ['departamento'] }));
    assert.equal(otroCaso.status, 201);
    assert.notEqual((await fila(otroCaso.data.caso.id)).alerta_temprana_en, null, 'editar no cuenta para el límite de 24 h');

    // Panel: el caso sigue Pendiente, con "modificado" y el antes y el después.
    const panel = async () => (await pedir('GET', '/admin/casos', admin)).data.casos.find(c => c.id === id);
    const enPanel = await panel();
    assert.equal(enPanel.estado, 'PENDIENTE');
    assert.ok(enPanel.modificadoEn);
    assert.equal(enPanel.edicionesReportante, 5);
    assert.equal(enPanel.ediciones.length, 5);
    const [quitar, reemplazar, aAdulto, aMenor, primera] = enPanel.ediciones;
    assert.deepEqual(primera.cambios.map(c => c.campo), ['vestimenta', 'latitud', 'longitud']);
    assert.deepEqual(aMenor.cambios, [
      { campo: 'edad', anterior: 30, nuevo: 15 },
      { campo: 'autorizacionParental', anterior: false, nuevo: true },
      { campo: 'alertaCampos', anterior: ['departamento', 'ciudad', 'foto'], nuevo: ['departamento', 'ciudad'] }
    ]);
    assert.deepEqual(aAdulto.cambios, [
      { campo: 'edad', anterior: 15, nuevo: 30 },
      { campo: 'autorizacionParental', anterior: true, nuevo: false },
      { campo: 'alertaCampos', anterior: ['departamento', 'ciudad'], nuevo: ['departamento', 'ciudad', 'foto'] }
    ]);
    assert.deepEqual(reemplazar.cambios, [{ campo: 'foto', anterior: 'con foto', nuevo: 'reemplazada' }]);
    assert.deepEqual(quitar.cambios, [
      { campo: 'alertaCampos', anterior: ['departamento', 'ciudad', 'foto'], nuevo: ['departamento', 'ciudad'] },
      { campo: 'foto', anterior: 'con foto', nuevo: 'quitada' }
    ]);
    assert.doesNotMatch(JSON.stringify(enPanel.ediciones), /base64|iVBOR/, 'nunca el contenido de la foto');
    assert.equal(primera.declaracionVersion, DECLARACION_VERSION);
    // El reportante y el público no ven el historial de ediciones.
    assert.doesNotMatch(JSON.stringify((await pedir('GET', '/mis-casos', duenio)).data), /"ediciones"|declaracion/i);

    // Validado: el historial queda y el reportante ya no puede editar.
    const validado = await pedir('POST', `/admin/casos/${id}/estado`, admin, {
      estado: 'VALIDADO', numeroDenuncia: 'DEN-PRUEBA', verificoDenuncia: true, datosCoherentes: true,
      duplicadosVerificados: true, menorValidado: true
    });
    assert.equal(validado.status, 200, JSON.stringify(validado.data));
    const trasValidar = await panel();
    assert.equal(trasValidar.estado, 'VALIDADO');
    assert.equal(trasValidar.ediciones.length, 5, 'el aviso queda como historial');
    assert.ok(trasValidar.modificadoEn);
    await db.query('UPDATE casos SET ediciones_reportante = 0 WHERE id = $1', [id]);
    const tarde = await pedir('PUT', `/mis-casos/${id}`, duenio, reporte({ ...editadoBase, vestimenta: 'Otra' }));
    assert.equal(tarde.status, 403, 'fuera de PENDIENTE no se edita');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const ids = (await db.query('SELECT id FROM casos WHERE reportado_por_usr_id = ANY($1)', [ciudadanos])).rows.map(r => r.id);
    for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso', 'ediciones_caso']) {
      await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [ids]);
    }
    await db.query('DELETE FROM casos WHERE id = ANY($1)', [ids]);
    await borrarUsuariosDePrueba(db, 'id = ANY($1)', [[adminId, ...ciudadanos].filter(Boolean)]);
    await db.end();
  }
});
