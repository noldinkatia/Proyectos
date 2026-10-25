import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
  CAMPOS_POR_DEFECTO,
  avisoPushAlertaTemprana,
  distanciaAproximada,
  normalizarCamposAlerta,
  textoAlertaTemprana
} from '../../public/js/alerta-campos.js';
import { normalizarNombre } from '../alertas.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { dentroDelRadio, distanciaKm, RADIO_ALERTA_KM, ubicacionAproximada } from '../geocerca.js';
import { cargaPush, crearPush } from '../push.js';
import { createApp } from '../server.js';

const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Grados de latitud que corresponden a `km` hacia el norte o el sur (sobre un
// meridiano la distancia de Haversine es exactamente R · Δφ).
const gradosLatitud = km => km / 6371 * 180 / Math.PI;

// web-push simulado: guarda cada envío; un endpoint con "caducada" responde 410.
function webPushSimulado() {
  const envios = [];
  return {
    envios,
    setVapidDetails() {},
    async sendNotification(suscripcion, carga, opciones) {
      if (suscripcion.endpoint.includes('caducada')) {
        const error = new Error('Gone');
        error.statusCode = 410;
        throw error;
      }
      envios.push({ endpoint: suscripcion.endpoint, carga: JSON.parse(carga), opciones });
    }
  };
}

test('geocerca: Haversine y radio de 160 km con el borde incluido', () => {
  const [lat, lng] = [-25.2867, -57.6333];
  assert.ok(Math.abs(distanciaKm(lat, lng, lat + gradosLatitud(160), lng) - 160) < 1e-9);
  assert.equal(dentroDelRadio(distanciaKm(lat, lng, lat + gradosLatitud(160), lng)), true, 'justo en el borde');
  assert.equal(dentroDelRadio(distanciaKm(lat, lng, lat + gradosLatitud(159.99), lng)), true, 'dentro');
  assert.equal(dentroDelRadio(distanciaKm(lat, lng, lat - gradosLatitud(160.01), lng)), false, 'fuera');
  assert.equal(RADIO_ALERTA_KM, 160);
  // Asunción - Encarnación: unos 280 km en línea recta.
  assert.ok(Math.abs(distanciaKm(-25.2637, -57.5759, -27.3306, -55.8667) - 282) < 5);
  assert.equal(ubicacionAproximada(-25.28674), -25.29);
});

test('alerta temprana: solo campos permitidos, foto bloqueada para menores y texto sin datos de más', () => {
  assert.deepEqual(normalizarCamposAlerta(undefined), CAMPOS_POR_DEFECTO);
  assert.deepEqual(normalizarCamposAlerta(['contacto', 'numeroDenuncia', 'ubicacion', 'ciudad', 'ciudad', 7]), ['ciudad']);
  assert.deepEqual(normalizarCamposAlerta(['foto', 'sexo'], { edad: 16, tieneFoto: true }), ['sexo']);
  assert.deepEqual(normalizarCamposAlerta(['foto'], { edad: 30, tieneFoto: false }), []);
  assert.deepEqual(normalizarCamposAlerta(['foto'], { edad: 30, tieneFoto: true }), ['foto']);

  const caso = { nombreCompleto: 'María José Benítez', edad: 16, sexo: 'Femenino', departamento: 'Central', ciudad: 'Luque', barrio: 'Centro', descripcionFisica: 'Alta', vestimenta: 'Remera roja' };
  const texto = textoAlertaTemprana(caso, ['ciudad', 'iniciales', 'rangoEdad']);
  assert.equal(texto, 'Pendiente / En revisión – No verificada. Ciudad: Luque. Edad aproximada: entre 15 y 19 años. Iniciales: M. J. B.');
  assert.doesNotMatch(texto, /María|Benítez|Remera/);
  assert.equal(textoAlertaTemprana(caso, []), 'Pendiente / En revisión – No verificada.');
  assert.deepEqual(avisoPushAlertaTemprana(caso, ['ciudad', 'primerNombre'], 41.3),
    { titulo: 'Alerta en tu zona · Luque', cuerpo: 'Caso en revisión, aún no verificado. A unos 40 km.' });
  assert.deepEqual(avisoPushAlertaTemprana(caso, ['ciudad', 'barrio'], 3.4),
    { titulo: 'Alerta en tu zona · Luque', cuerpo: 'Caso en revisión, aún no verificado. Barrio Centro, a unos 3 km.' });
  assert.deepEqual(avisoPushAlertaTemprana(caso, ['barrio'], 0.4),
    { titulo: 'Alerta en tu zona · Centro', cuerpo: 'Caso en revisión, aún no verificado. A menos de 1 km.' });
  assert.deepEqual(avisoPushAlertaTemprana(caso, ['primerNombre']),
    { titulo: 'Alerta en tu zona', cuerpo: 'Caso en revisión, aún no verificado.' });
  assert.deepEqual([distanciaAproximada(160), distanciaAproximada('12.6'), distanciaAproximada(null)], ['a unos 160 km', 'a unos 15 km', '']);
  assert.equal(normalizarNombre('  MARÍA   josé  Benítez '), 'maria jose benitez');
});

test('push: la oficial destaca y la temprana es discreta, con zona, distancia y botón Ver; sin claves VAPID queda desactivado', async () => {
  const temprana = cargaPush('ALERTA_TEMPRANA', 'cas_1', { ciudad: 'Luque', barrio: 'Itapuamí', alerta_campos: ['iniciales'], nombre_completo: 'Ana Pérez' }, { distanciaKm: '38.2' });
  assert.equal(temprana.carga.titulo, 'Alerta en tu zona', 'sin ciudad ni barrio elegidos, no los muestra');
  assert.equal(temprana.carga.cuerpo, 'Caso en revisión, aún no verificado. A unos 40 km.');
  assert.equal(temprana.carga.discreta, true);
  assert.deepEqual(temprana.carga.acciones, [{ accion: 'ver', titulo: 'Ver' }]);
  assert.equal(temprana.carga.tag, 'rastreo-caso-cas_1');
  assert.equal(temprana.carga.url, '/app/#/alerta/cas_1');
  assert.equal(temprana.opciones.urgency, 'low');
  assert.ok(temprana.opciones.topic.length <= 32);
  assert.doesNotMatch(JSON.stringify(temprana), /Ana|Pérez|Luque|Itapuamí/);
  const conZona = cargaPush('ALERTA_TEMPRANA', 'cas_1', { ciudad: 'Luque', barrio: 'Itapuamí', alerta_campos: ['ciudad', 'barrio'] }, { distanciaKm: 7 });
  assert.equal(conZona.carga.titulo, 'Alerta en tu zona · Luque');
  assert.equal(conZona.carga.cuerpo, 'Caso en revisión, aún no verificado. Barrio Itapuamí, a unos 7 km.');
  const oficial = cargaPush('ALERTA_OFICIAL', 'cas_1', { ciudad: 'Luque' }, { distanciaKm: 52 });
  assert.equal(oficial.carga.tag, temprana.carga.tag, 'la oficial reemplaza a la temprana en el dispositivo');
  assert.equal(oficial.carga.discreta, false);
  assert.equal(oficial.carga.titulo, 'Alerta oficial · Luque');
  assert.equal(oficial.carga.cuerpo, 'Persona desaparecida a unos 50 km. Caso verificado por la administración: tocá para ver la ficha.');
  assert.equal(oficial.opciones.urgency, 'high');
  assert.equal(cargaPush('ALERTA_OFICIAL', 'cas_1').carga.titulo, 'Alerta oficial en tu zona');
  // Nada que parezca un mensaje masivo: sin emojis, signos repetidos ni mayúsculas sostenidas.
  for (const { carga } of [temprana, conZona, oficial, cargaPush('ALERTA_LOCALIZADO', 'cas_1')]) {
    const texto = `${carga.titulo} ${carga.cuerpo}`;
    assert.doesNotMatch(texto, /\p{Extended_Pictographic}|[!¡]|\b[A-ZÁÉÍÓÚÑ]{4,}\b/u, texto);
  }
  for (const tipo of ['ALERTA_RETRACTADA', 'ALERTA_CERRADO', 'CASO_VALIDADO']) assert.equal(cargaPush(tipo, 'cas_1'), null);

  const cliente = webPushSimulado();
  const sinClaves = crearPush({ cliente });
  assert.equal(sinClaves.disponible, false);
  assert.equal(sinClaves.clavePublica, null);
  sinClaves.programar({ query: () => assert.fail('no debe consultar la base') }, [{ id: '1', canal: 'push' }]);
  await sinClaves.esperar();
  assert.equal(cliente.envios.length, 0);

  const errores = [];
  const consola = console.error;
  console.error = (...args) => errores.push(args.join(' '));
  try {
    const invalidas = crearPush({ publicKey: 'clave-publica-secreta', privateKey: 'clave-privada-secreta', subject: 'mailto:a@b.c' });
    assert.equal(invalidas.disponible, false);
  } finally {
    console.error = consola;
  }
  assert.doesNotMatch(errores.join('\n'), /secreta/, 'no se imprimen las claves');
});

test('alertas de zona con PostgreSQL: radio, retractación, oficial, localizado, push y límites', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const cliente = webPushSimulado();
  const push = crearPush({ publicKey: 'BPublica', privateKey: 'privada', subject: 'mailto:test@rastreo.py', cliente });
  const userIds = [];
  const caseIds = [];
  let server;
  // Lejos de cualquier dato de otras pruebas: centro en el Chaco.
  const [lat0, lng0] = [-21.5, -60.5];

  try {
    await initializeDatabase(db);
    const adminEmail = `alertas.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    const adminId = (await db.query('SELECT id FROM usuarios WHERE correo = $1', [adminEmail])).rows[0].id;
    userIds.push(adminId);
    const crearUsuario = async nombre => {
      const { rows } = await db.query(`
        INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
        VALUES ($1, $2, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id
      `, [nombre, `${nombre}.${suffix}@gmail.com`]);
      userIds.push(rows[0].id);
      return rows[0].id;
    };
    const ubicar = (id, lat, lng) => db.query(
      'INSERT INTO alertas_zona (usuario_id, latitud, longitud) VALUES ($1, $2, $3)', [id, lat, lng]);
    const suscribir = (id, nombre) => db.query(
      'INSERT INTO suscripciones_push (usuario_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)',
      [id, `https://push.example/${nombre}-${suffix}`, 'BClave', 'auth']);

    const reportante = await crearUsuario('reportante');
    const reportante2 = await crearUsuario('reportante2');
    const reportante3 = await crearUsuario('reportante3');
    const dentro = await crearUsuario('dentro');
    const borde = await crearUsuario('borde');
    const fuera = await crearUsuario('fuera');
    const caducado = await crearUsuario('caducado');
    const desactiva = await crearUsuario('desactiva');
    const tardio = await crearUsuario('tardio');
    await ubicar(borde, lat0 + gradosLatitud(160), lng0);
    await ubicar(fuera, lat0 - gradosLatitud(160.01), lng0);
    await ubicar(caducado, lat0 + 0.2, lng0);
    await ubicar(desactiva, lat0 - 0.3, lng0);
    // El reportante también tiene alertas activas, junto al lugar del caso.
    await ubicar(reportante, lat0, lng0);
    await suscribir(borde, 'borde');
    await suscribir(caducado, 'caducada');
    await suscribir(reportante, 'reportante');

    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push })
      .listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = (id, rol = 'ciudadano') => jwt.sign({ id, rol }, secret);
    const api = async (method, path, id, body, rol) => {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${token(id, rol)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const reportar = async (id, nombre, edad, extra = {}) => {
      const result = await api('POST', '/casos', id, {
        nombreCompleto: nombre, edad, sexo: 'Femenino', departamento: 'Capital', ciudad: 'Asunción',
        descripcionFisica: 'Descripción de prueba', vestimenta: 'Campera azul',
        fechaHoraDesaparicion: new Date().toISOString(), ubicacion: { lat: lat0, lng: lng0 },
        declaraMayorEdad: true, autorizacionParental: edad < 18, avisoPrivacidadAceptado: true, ...extra
      });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      caseIds.push(result.body.caso.id);
      await push.esperar();
      return result.body.caso.id;
    };
    const avisos = async (casoId, tipo) => (await db.query(`
      SELECT id, usuario_id, mensaje, distancia_km, canal, push_resultado FROM notificaciones
      WHERE caso_id = $1 AND tipo = $2 ORDER BY usuario_id
    `, [casoId, tipo])).rows;
    const usuarios = filas => filas.map(fila => fila.usuario_id).sort((a, b) => a - b);
    const cambiarEstado = async (casoId, estado, extra = {}) => {
      const result = await api('POST', `/admin/casos/${casoId}/estado`, adminId, { estado, ...extra }, 'administrador');
      assert.equal(result.status, 200, JSON.stringify(result.body));
      await push.esperar();
    };

    // Activar por la API: consentimiento obligatorio y ubicación redondeada.
    assert.equal((await api('PUT', '/alertas-zona', dentro, { ubicacion: { lat: lat0, lng: lng0 + 0.5 } })).status, 400);
    assert.equal((await api('PUT', '/alertas-zona', dentro, { consentimiento: true, ubicacion: { lat: lat0, lng: lng0 + 0.5 }, suscripcion: { endpoint: 'http://inseguro' } })).status, 400);
    const activada = await api('PUT', '/alertas-zona', dentro, {
      consentimiento: true,
      ubicacion: { lat: lat0 + 0.004321, lng: lng0 + 0.5 },
      suscripcion: { endpoint: `https://push.example/dentro-${suffix}`, keys: { p256dh: 'BClave', auth: 'auth' } }
    });
    assert.equal(activada.status, 200);
    assert.equal(activada.body.push, true);
    const guardada = (await db.query('SELECT latitud, longitud FROM alertas_zona WHERE usuario_id = $1', [dentro])).rows[0];
    assert.equal(guardada.latitud, ubicacionAproximada(lat0 + 0.004321));
    const estadoZona = await api('GET', '/alertas-zona', dentro);
    assert.deepEqual([estadoZona.body.activa, estadoZona.body.dispositivos, estadoZona.body.push.disponible], [true, 1, true]);
    assert.equal(JSON.stringify(estadoZona.body).includes(String(guardada.latitud)), false, 'no devuelve coordenadas');
    assert.equal((await api('GET', '/alertas-zona', adminId, null, 'administrador')).status, 403);

    // 1) Alerta temprana: dentro y en el borde sí; fuera, el reportante y el admin no.
    const caso1 = await reportar(reportante, `Ana Prueba ${suffix}`, 30, { alertaCampos: ['ciudad', 'iniciales', 'numeroDenuncia'] });
    const tempranas = await avisos(caso1, 'ALERTA_TEMPRANA');
    assert.deepEqual(usuarios(tempranas), [dentro, borde, caducado, desactiva].sort((a, b) => a - b));
    for (const fila of tempranas) {
      assert.match(fila.mensaje, /^Pendiente \/ En revisión – No verificada\. Ciudad: Asunción\. Iniciales: A\. P\./);
      assert.doesNotMatch(fila.mensaje, /Ana|Prueba/);
    }
    assert.equal(Number(tempranas.find(fila => fila.usuario_id === borde).distancia_km), 160);
    assert.equal(tempranas.find(fila => fila.usuario_id === desactiva).canal, 'app', 'sin dispositivo: solo centro');
    assert.equal(tempranas.find(fila => fila.usuario_id === dentro).canal, 'push');
    assert.equal(tempranas.find(fila => fila.usuario_id === dentro).push_resultado, 'enviado');
    // Suscripción caducada: se borra y queda auditado.
    assert.equal(tempranas.find(fila => fila.usuario_id === caducado).push_resultado, 'caducado');
    assert.equal((await db.query('SELECT 1 FROM suscripciones_push WHERE usuario_id = $1', [caducado])).rows.length, 0);
    const enviosTempranos = cliente.envios.filter(envio => envio.carga.casoId === caso1);
    assert.deepEqual(enviosTempranos.map(envio => envio.endpoint).sort(), [`https://push.example/borde-${suffix}`, `https://push.example/dentro-${suffix}`]);
    for (const envio of enviosTempranos) {
      assert.equal(envio.carga.titulo, 'Alerta en tu zona · Asunción');
      assert.match(envio.carga.cuerpo, /^Caso en revisión, aún no verificado\. A unos (50|160) km\.$/);
      assert.equal(envio.carga.discreta, true);
      assert.equal(envio.opciones.urgency, 'low');
      assert.doesNotMatch(JSON.stringify(envio), /Ana|Prueba|-21\.|-60\./);
    }
    assert.equal(cliente.envios.some(envio => envio.endpoint.includes('reportante')), false, 'no al reportante');
    // Un único aviso por caso y destinatario: volver a programar las mismas no reenvía.
    const enviosAntesDeReprogramar = cliente.envios.length;
    push.programar(db, tempranas.filter(fila => fila.canal === 'push').map(fila => ({ id: fila.id, canal: 'push' })));
    await push.esperar();
    assert.equal(cliente.envios.length, enviosAntesDeReprogramar, 'no se reenvía');
    const admin = await db.query('SELECT tipo FROM notificaciones WHERE caso_id = $1 AND usuario_id = $2', [caso1, adminId]);
    assert.deepEqual(admin.rows.map(row => row.tipo), ['CASO_PENDIENTE']);

    // Vista mínima: solo quien recibió la alerta, con los campos elegidos.
    const vista = await api('GET', `/alertas/${caso1}`, dentro);
    assert.equal(vista.body.estado, 'PENDIENTE');
    assert.deepEqual(vista.body.datos.map(dato => dato.etiqueta), ['Ciudad', 'Iniciales']);
    assert.equal(vista.body.fotoUrl, '');
    assert.equal((await api('GET', `/alertas/${caso1}`, fuera)).status, 404);
    assert.equal((await api('GET', `/alertas/${caso1}/foto`, dentro)).status, 404);
    assert.equal((await api('GET', `/casos/${caso1}`, dentro)).status, 404, 'el caso pendiente sigue sin ser público');

    // 2) Rechazo: retractación solo en el centro y solo a los alertados.
    const enviosAntes = cliente.envios.length;
    await cambiarEstado(caso1, 'RECHAZADO', { motivo: 'Reporte de prueba' });
    const retractaciones = await avisos(caso1, 'ALERTA_RETRACTADA');
    assert.deepEqual(usuarios(retractaciones), usuarios(tempranas));
    assert.ok(retractaciones.every(fila => fila.canal === 'app' && fila.push_resultado === null));
    assert.equal(cliente.envios.length, enviosAntes, 'la retractación no sale como push');
    assert.equal((await api('GET', `/alertas/${caso1}`, dentro)).body.estado, 'RETRACTADA');
    assert.equal((await db.query('SELECT geocerca_activa FROM casos WHERE id = $1', [caso1])).rows[0].geocerca_activa, false);
    const centro = await api('GET', '/notificaciones', dentro);
    const retiro = centro.body.notificaciones.find(item => item.casoId === caso1 && item.tipo === 'ALERTA_RETRACTADA');
    assert.equal(retiro.canal, 'app');

    // 3) Límite por reportante: un segundo reporte dentro de 24 h no alerta.
    const casoLimite = await reportar(reportante, `Otra Persona ${suffix}`, 40);
    assert.equal((await avisos(casoLimite, 'ALERTA_TEMPRANA')).length, 0);
    assert.equal((await db.query('SELECT alerta_temprana_en FROM casos WHERE id = $1', [casoLimite])).rows[0].alerta_temprana_en, null);

    // 4) Validación: alerta oficial a la zona y a quien recibió la temprana; no a
    // quien desactivó (desactivar borra ubicación y dispositivos).
    const caso2 = await reportar(reportante2, `Lucía Gómez ${suffix}`, 25, { alertaCampos: ['ciudad', 'foto'], foto: 'data:image/jpeg;base64,/9j/2Q==' });
    // Ahora el reportante del caso 1 es un vecino más con alertas activas.
    assert.deepEqual(usuarios(await avisos(caso2, 'ALERTA_TEMPRANA')), [reportante, dentro, borde, caducado, desactiva].sort((a, b) => a - b));
    const conFoto = await api('GET', `/alertas/${caso2}`, dentro);
    assert.equal(conFoto.body.fotoUrl, `/api/alertas/${caso2}/foto`);
    assert.equal((await fetch(`${baseUrl}${conFoto.body.fotoUrl}`, { headers: { Authorization: `Bearer ${token(dentro)}` } })).status, 200);
    assert.equal((await api('DELETE', '/alertas-zona', desactiva)).status, 200);
    assert.equal((await db.query('SELECT 1 FROM alertas_zona WHERE usuario_id = $1', [desactiva])).rows.length, 0);
    await ubicar(tardio, lat0, lng0 - 1);
    await cambiarEstado(caso2, 'VALIDADO', {
      numeroDenuncia: 'DEN-PRUEBA', verificoDenuncia: true, datosCoherentes: true,
      duplicadosVerificados: true, menorValidado: true
    });
    const oficiales = await avisos(caso2, 'ALERTA_OFICIAL');
    assert.deepEqual(usuarios(oficiales), [reportante, dentro, borde, caducado, tardio].sort((a, b) => a - b));
    const envioOficial = cliente.envios.find(envio => envio.carga.casoId === caso2 && envio.carga.tipo === 'ALERTA_OFICIAL');
    assert.equal(envioOficial.carga.url, `/app/#/caso/${caso2}`);
    assert.equal(envioOficial.opciones.urgency, 'high');
    assert.equal(envioOficial.carga.discreta, false);
    assert.equal(envioOficial.carga.titulo, 'Alerta oficial · Asunción');
    assert.doesNotMatch(JSON.stringify(envioOficial), /Lucía|Gómez/);
    assert.equal((await api('GET', `/alertas/${caso2}`, dentro)).body.estado, 'PUBLICO');
    assert.equal((await api('GET', `/alertas/${caso2}/foto`, dentro)).status, 404, 'la foto de la alerta temprana ya no se sirve');
    // Volver a validar no repite la alerta oficial.
    await cambiarEstado(caso2, 'PENDIENTE', { motivo: 'Revisión' });
    await cambiarEstado(caso2, 'VALIDADO', {
      numeroDenuncia: 'DEN-PRUEBA', verificoDenuncia: true, datosCoherentes: true,
      duplicadosVerificados: true, menorValidado: true
    });
    assert.equal((await avisos(caso2, 'ALERTA_OFICIAL')).length, 5);

    // 5) Pistas: aviso al reportante sin repetirlo mientras no lo lea.
    for (const descripcion of ['Pista uno', 'Pista dos']) {
      const pista = await api('POST', `/casos/${caso2}/pistas`, dentro, {
        descripcion, fechaHoraAvistamiento: new Date().toISOString(), ubicacion: { lat: lat0, lng: lng0 }
      });
      assert.equal(pista.status, 201);
    }
    const avisoPista = await db.query(`
      SELECT mensaje FROM notificaciones WHERE caso_id = $1 AND usuario_id = $2 AND tipo = 'PISTA_RECIBIDA_REPORTANTE'
    `, [caso2, reportante2]);
    assert.equal(avisoPista.rows.length, 1);
    assert.doesNotMatch(avisoPista.rows[0].mensaje, /Pista uno|Pista dos/);
    assert.equal((await avisos(caso2, 'PISTA_RECIBIDA')).filter(fila => fila.usuario_id === adminId).length, 2);

    // 6) Duplicado crítico (contra un caso activo): mismo nombre sin tildes ni mayúsculas, edad ±1, cerca.
    const casoDuplicado = await reportar(reportante3, `LUCIA   gomez ${suffix}`, 26);
    assert.equal((await avisos(casoDuplicado, 'ALERTA_TEMPRANA')).length, 0);
    assert.ok((await avisos(casoDuplicado, 'CASO_POSIBLE_DUPLICADO')).some(fila => fila.usuario_id === adminId));

    // 7) Localizado: aviso a los alertados que no siguen el caso (dentro mandó
    // pistas y ya recibe CASO_LOCALIZADO) y la geocerca se apaga.
    await cambiarEstado(caso2, 'LOCALIZADO');
    assert.deepEqual(usuarios(await avisos(caso2, 'ALERTA_LOCALIZADO')), [reportante, borde, caducado, tardio].sort((a, b) => a - b));
    assert.ok((await avisos(caso2, 'CASO_LOCALIZADO')).some(fila => fila.usuario_id === dentro));
    assert.equal((await db.query('SELECT geocerca_activa FROM casos WHERE id = $1', [caso2])).rows[0].geocerca_activa, false);
    assert.ok(cliente.envios.some(envio => envio.carga.casoId === caso2 && envio.carga.tipo === 'ALERTA_LOCALIZADO'));
    assert.equal((await avisos(caso2, 'ALERTA_OFICIAL')).some(fila => fila.usuario_id === desactiva), false);

    // 8) Cerrar: solo en el centro de notificaciones.
    const caso3 = await reportar(reportante3, `Marta Ruiz ${suffix}`, 50);
    const enviosAntesCierre = cliente.envios.length;
    await cambiarEstado(caso3, 'CERRADO', { motivo: 'Cierre de prueba' });
    const cierres = await avisos(caso3, 'ALERTA_CERRADO');
    assert.ok(cierres.length > 0 && cierres.every(fila => fila.canal === 'app'));
    assert.equal(cierres.some(fila => fila.usuario_id === reportante3), false);
    assert.equal(cliente.envios.length, enviosAntesCierre, 'el cierre no sale como push');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.query('DELETE FROM notificaciones WHERE caso_id = ANY($1) OR usuario_id = ANY($2)', [caseIds, userIds]);
    await db.query('DELETE FROM cambios_estado_pista WHERE pista_id IN (SELECT id FROM pistas WHERE caso_id = ANY($1))', [caseIds]);
    await db.query('DELETE FROM pistas WHERE caso_id = ANY($1)', [caseIds]);
    await db.query('DELETE FROM suscripciones_caso WHERE caso_id = ANY($1)', [caseIds]);
    await db.query('DELETE FROM cambios_estado_caso WHERE caso_id = ANY($1)', [caseIds]);
    await db.query('DELETE FROM casos WHERE id = ANY($1)', [caseIds]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [userIds]);
    await db.end();
  }
});

test('el polling no repite como aviso del sistema lo que llegó por push ni la retractación o el cierre', async () => {
  const { mostrarComoAvisoDelSistema } = await import('../../public/js/notifications.js');
  assert.equal(mostrarComoAvisoDelSistema({ canal: 'push', tipo: 'ALERTA_TEMPRANA' }), false);
  assert.equal(mostrarComoAvisoDelSistema({ canal: 'app', tipo: 'ALERTA_RETRACTADA' }), false);
  assert.equal(mostrarComoAvisoDelSistema({ canal: 'app', tipo: 'ALERTA_CERRADO' }), false);
  assert.equal(mostrarComoAvisoDelSistema({ canal: 'app', tipo: 'ALERTA_TEMPRANA' }), true);
  assert.equal(mostrarComoAvisoDelSistema({ tipo: 'CASO_VALIDADO' }), true);
});

test('sin claves VAPID con PostgreSQL: las alertas quedan en el centro (canal app) y la foto de menores se descarta', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const cliente = webPushSimulado();
  const push = crearPush({ cliente });
  const userIds = [];
  let casoId;
  let server;
  const [lat0, lng0] = [-20.5, -61.5];
  try {
    await initializeDatabase(db);
    const crearUsuario = async nombre => {
      const { rows } = await db.query(`
        INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
        VALUES ($1, $2, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id
      `, [nombre, `${nombre}.sinclaves.${suffix}@gmail.com`]);
      userIds.push(rows[0].id);
      return rows[0].id;
    };
    const reportante = await crearUsuario('reportante');
    const vecino = await crearUsuario('vecino');
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push })
      .listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const api = async (method, path, id, body) => {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${jwt.sign({ id, rol: 'ciudadano' }, secret)}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const estado = await api('GET', '/alertas-zona', vecino);
    assert.deepEqual(estado.body.push, { disponible: false, clavePublica: null });
    const activada = await api('PUT', '/alertas-zona', vecino, {
      consentimiento: true, ubicacion: { lat: lat0, lng: lng0 },
      suscripcion: { endpoint: `https://push.example/vecino-${suffix}`, keys: { p256dh: 'BClave', auth: 'auth' } }
    });
    assert.equal(activada.body.push, false);

    const creado = await api('POST', '/casos', reportante, {
      nombreCompleto: `Menor Prueba ${suffix}`, edad: 15, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción',
      descripcionFisica: 'Descripción', vestimenta: 'Vestimenta', fechaHoraDesaparicion: new Date().toISOString(),
      ubicacion: { lat: lat0, lng: lng0 }, declaraMayorEdad: true, autorizacionParental: true, avisoPrivacidadAceptado: true,
      foto: 'data:image/jpeg;base64,/9j/2Q==', alertaCampos: ['foto', 'ciudad']
    });
    assert.equal(creado.status, 201);
    casoId = creado.body.caso.id;
    await push.esperar();
    const guardado = await db.query('SELECT alerta_campos FROM casos WHERE id = $1', [casoId]);
    assert.deepEqual(guardado.rows[0].alerta_campos, ['ciudad'], 'la foto de un menor no se guarda como elegida');
    const { rows } = await db.query(`
      SELECT canal, push_resultado FROM notificaciones WHERE caso_id = $1 AND usuario_id = $2 AND tipo = 'ALERTA_TEMPRANA'
    `, [casoId, vecino]);
    assert.deepEqual(rows, [{ canal: 'app', push_resultado: null }]);
    assert.equal(cliente.envios.length, 0);
    const vista = await api('GET', `/alertas/${casoId}`, vecino);
    assert.equal(vista.body.fotoUrl, '');
    assert.equal((await api('GET', `/alertas/${casoId}/foto`, vecino)).status, 404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (casoId) {
      await db.query('DELETE FROM notificaciones WHERE caso_id = $1', [casoId]);
      await db.query('DELETE FROM suscripciones_caso WHERE caso_id = $1', [casoId]);
      await db.query('DELETE FROM cambios_estado_caso WHERE caso_id = $1', [casoId]);
      await db.query('DELETE FROM casos WHERE id = $1', [casoId]);
    }
    await db.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [userIds]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [userIds]);
    await db.end();
  }
});

test('cerrar sesión da de baja la suscripción push de este dispositivo (servidor y navegador)', async () => {
  const llamadas = [];
  let desuscripta = false;
  const suscripcion = { endpoint: 'https://push.example/este-dispositivo', unsubscribe: async () => { desuscripta = true; return true; } };
  const anteriores = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    PushManager: globalThis.PushManager,
    sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => suscripcion } }) } }
  });
  globalThis.PushManager = class {};
  globalThis.sessionStorage = { getItem: () => 'token-de-prueba' };
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url, metodo: opciones.method, cuerpo: JSON.parse(opciones.body), autorizacion: opciones.headers.Authorization });
    return new Response(JSON.stringify({ eliminada: true }), { status: 200 });
  };
  try {
    const { darDeBajaEsteDispositivo } = await import('../../public/js/push-dispositivo.js');
    await darDeBajaEsteDispositivo();
    assert.deepEqual(llamadas, [{
      url: '/api/push/suscripcion', metodo: 'DELETE',
      cuerpo: { endpoint: 'https://push.example/este-dispositivo' }, autorizacion: 'Bearer token-de-prueba'
    }]);
    assert.equal(desuscripta, true);

    // Sin red: igual se desuscribe en el navegador.
    desuscripta = false;
    globalThis.fetch = async () => { throw new TypeError('sin red'); };
    const consola = console.error;
    console.error = () => {};
    try {
      await darDeBajaEsteDispositivo();
    } finally {
      console.error = consola;
    }
    assert.equal(desuscripta, true);

    // logout() llama a la baja antes de olvidar la sesión.
    const auth = await readFile(new URL('../../public/js/auth.js', import.meta.url), 'utf8');
    const cuerpoLogout = auth.slice(auth.indexOf('export async function logout()'));
    assert.ok(cuerpoLogout.indexOf('await darDeBajaEsteDispositivo()') > 0);
    assert.ok(cuerpoLogout.indexOf('await darDeBajaEsteDispositivo()') < cuerpoLogout.indexOf('olvidarSesion()'));
  } finally {
    if (anteriores.navigator) Object.defineProperty(globalThis, 'navigator', anteriores.navigator);
    else delete globalThis.navigator;
    globalThis.PushManager = anteriores.PushManager;
    globalThis.sessionStorage = anteriores.sessionStorage;
    globalThis.fetch = anteriores.fetch;
  }
});

test('DELETE /api/push/suscripcion borra solo ese endpoint de esa cuenta y no toca las alertas de zona', async () => {
  const consultas = [];
  const db = {
    async query(sql, values = []) {
      if (sql.includes('sesion_version FROM usuarios')) return { rows: [{ rol: 'ciudadano', sesion_version: 0 }] };
      consultas.push({ sql, values });
      return { rows: [], rowCount: 1 };
    }
  };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push: crearPush({}) })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/push/suscripcion`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: 42, rol: 'ciudadano' }, secret)}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { method: 'DELETE', body: JSON.stringify({ endpoint: 'https://x' }) })).status, 401);
    assert.equal((await fetch(url, { method: 'DELETE', headers, body: '{}' })).status, 400);
    const respuesta = await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ endpoint: 'https://push.example/a' }) });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(await respuesta.json(), { eliminada: true });
    assert.equal(consultas.length, 1);
    assert.match(consultas[0].sql, /DELETE FROM suscripciones_push WHERE usuario_id = \$1 AND endpoint = \$2/);
    assert.deepEqual(consultas[0].values, [42, 'https://push.example/a']);
    assert.equal(consultas.some(item => item.sql.includes('alertas_zona')), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('baja del dispositivo con PostgreSQL: solo ese endpoint, solo de su cuenta, alertas de zona intactas', {
  skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.'
}, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const userIds = [];
  let server;
  try {
    await initializeDatabase(db);
    for (const nombre of ['dueno', 'otro']) {
      const { rows } = await db.query(`
        INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos)
        VALUES ($1, $2, 'sin-uso', 'ciudadano', TRUE, TRUE) RETURNING id
      `, [nombre, `${nombre}.baja.${suffix}@gmail.com`]);
      userIds.push(rows[0].id);
    }
    const [dueno, otro] = userIds;
    await db.query('INSERT INTO alertas_zona (usuario_id, latitud, longitud) VALUES ($1, -25.3, -57.6)', [dueno]);
    const endpoint = nombre => `https://push.example/${nombre}-${suffix}`;
    for (const [id, nombre] of [[dueno, 'celular'], [dueno, 'tablet'], [otro, 'ajeno']]) {
      await db.query('INSERT INTO suscripciones_push (usuario_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)',
        [id, endpoint(nombre), 'BClave', 'auth']);
    }
    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push: crearPush({}) })
      .listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baja = async (id, valor) => (await fetch(`http://127.0.0.1:${server.address().port}/api/push/suscripcion`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt.sign({ id, rol: 'ciudadano' }, secret)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: valor })
    })).json();

    assert.deepEqual(await baja(dueno, endpoint('ajeno')), { eliminada: false }, 'no borra endpoints de otra cuenta');
    assert.deepEqual(await baja(dueno, endpoint('celular')), { eliminada: true });
    const quedan = await db.query('SELECT endpoint FROM suscripciones_push WHERE usuario_id = ANY($1) ORDER BY endpoint', [userIds]);
    assert.deepEqual(quedan.rows.map(row => row.endpoint), [endpoint('ajeno'), endpoint('tablet')]);
    assert.equal((await db.query('SELECT 1 FROM alertas_zona WHERE usuario_id = $1', [dueno])).rows.length, 1, 'las alertas de zona siguen activas');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [userIds]);
    await db.end();
  }
});
