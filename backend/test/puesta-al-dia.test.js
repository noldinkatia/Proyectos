import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PGlite, types } from '@electric-sql/pglite';
import { textoAlertaTemprana } from '../../public/js/alerta-campos.js';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { HORAS_PUESTA_AL_DIA, MAXIMO_PUESTA_AL_DIA, ponerAlDiaAlertasTempranas } from '../alertas.js';
import { mensajeRevision, motivoDeRevision, toOwnerCase, toPublicCase } from '../case-shared.js';
import { initializeDatabase } from '../db.js';
import { comoPool } from '../demo-visual.js';
import { createApp } from '../server.js';

// Puesta al día de la alerta temprana (backend/alertas.js) y motivo de rechazo o
// de devolución a revisión en "Mis casos". Sin PostgreSQL: las condiciones de la
// consulta corren sobre PGlite en memoria (lo mismo que npm run demo-visual) y
// la API pública, sobre una base simulada.
const secret = 'test-secret-with-at-least-thirty-two-characters';
const publicDir = new URL('../../public/', import.meta.url);
const ZONA = { lat: -25.2867, lng: -57.6333 };
// Grados de latitud hacia el norte que equivalen a `km` (Haversine sobre un meridiano).
const norte = km => ZONA.lat + km / 6371 * 180 / Math.PI;

async function baseEnMemoria() {
  const pg = await PGlite.create({ parsers: { [types.INT8]: valor => valor } });
  const db = comoPool(pg);
  await initializeDatabase(db);
  const contrasena = await bcrypt.hash('Clave-de-prueba-1', 4);
  const usuario = async (correo, { rol = 'ciudadano', verificado = true } = {}) => (await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
    VALUES ($1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP) RETURNING id
  `, [`Prueba ${correo}`, correo, contrasena, rol, verificado])).rows[0].id;
  const zona = (usuarioId, lat = ZONA.lat, lng = ZONA.lng) => db.query(
    'INSERT INTO alertas_zona (usuario_id, latitud, longitud) VALUES ($1, $2, $3)', [usuarioId, lat, lng]);
  let orden = 0;
  // Caso en revisión con alerta temprana enviada, a `km` al norte de la zona,
  // creado hace `horas` (cada uno un poco más viejo que el anterior si no se dice).
  const caso = async (id, reportante, { km = 10, horas = null, estado = 'PENDIENTE', conAlerta = true, campos = ['ciudad', 'sexo'] } = {}) => {
    orden += 1;
    const creado = new Date(Date.now() - (horas ?? orden / 60) * 3600 * 1000);
    await db.query(`
      INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
        fecha_hora_desaparicion, latitud, longitud, estado, reportado_por_usr_id, creado_en, alerta_temprana_en, alerta_campos)
      VALUES ($1, $2, 30, 'Femenino', 'Asunción', 'Capital', 'Alta', 'Remera', $3, $4, $5, $6, $7, $3, $8, $9)
    `, [id, `Persona ${id}`, creado, norte(km), ZONA.lng, estado, reportante, conAlerta ? creado : null, JSON.stringify(campos)]);
  };
  return { db, usuario, zona, caso, cerrar: () => db.end() };
}

const alertasDe = async (db, usuarioId) => (await db.query(`
  SELECT caso_id, titulo, mensaje, tipo, canal, distancia_km, push_resultado FROM notificaciones
  WHERE usuario_id = $1 ORDER BY caso_id
`, [usuarioId])).rows;

test('puesta al día: solo casos en revisión, con alerta temprana, ajenos, a 160 km o menos y de las últimas 24 h', { timeout: 60_000 }, async () => {
  const base = await baseEnMemoria();
  try {
    const { db } = base;
    const reportante = await base.usuario('reporta@gmail.com');
    const vecino = await base.usuario('vecino@gmail.com');
    const sinZona = await base.usuario('sin-zona@gmail.com');
    const sinVerificar = await base.usuario('sin-verificar@gmail.com', { verificado: false });
    const admin = await base.usuario('admin@gmail.com', { rol: 'administrador' });
    for (const id of [vecino, sinVerificar, admin]) await base.zona(id);

    await base.caso('cas_ok', reportante, { km: 159.9, campos: ['ciudad', 'barrio'] });
    await base.caso('cas_propio', vecino);
    await base.caso('cas_sin_alerta', reportante, { conAlerta: false });
    await base.caso('cas_lejos', reportante, { km: 160.5 });
    await base.caso('cas_viejo', reportante, { horas: HORAS_PUESTA_AL_DIA + 0.5 });
    await base.caso('cas_validado', reportante, { estado: 'VALIDADO' });
    await base.caso('cas_rechazado', reportante, { estado: 'RECHAZADO' });
    // Ya tiene una notificación de este caso (de otro tipo): no se repite.
    await base.caso('cas_avisado', reportante);
    await db.query(`INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo) VALUES ($1, 'cas_avisado', 'x', 'x', 'PISTA_VALIDADA')`, [vecino]);

    assert.deepEqual(await ponerAlDiaAlertasTempranas(db, sinZona), { nuevas: 0 }, 'sin zona no recibe nada');
    assert.deepEqual(await ponerAlDiaAlertasTempranas(db, sinVerificar), { nuevas: 0 }, 'cuenta sin verificar');
    assert.deepEqual(await ponerAlDiaAlertasTempranas(db, admin), { nuevas: 0 }, 'administración');
    assert.deepEqual(await alertasDe(db, sinZona), []);

    assert.deepEqual(await ponerAlDiaAlertasTempranas(db, vecino), { nuevas: 1 });
    const alertas = (await alertasDe(db, vecino)).filter(fila => fila.tipo === 'ALERTA_TEMPRANA');
    assert.deepEqual(alertas.map(fila => fila.caso_id), ['cas_ok'], 'propio, sin alerta, lejos, viejo, no pendiente y ya avisado quedan fuera');
    const [alerta] = alertas;
    assert.equal(alerta.canal, 'app', 'nunca push');
    assert.equal(alerta.push_resultado, null);
    assert.equal(alerta.titulo, 'Alerta en tu zona: caso en revisión');
    assert.equal(Number(alerta.distancia_km), 159.9);
    // Mismo texto que la alerta temprana normal, con los campos que eligió el reportante.
    assert.equal(alerta.mensaje, textoAlertaTemprana({ ciudad: 'Asunción', barrio: '' }, ['ciudad', 'barrio']));

    // Idempotente: otra ejecución no duplica.
    assert.deepEqual(await ponerAlDiaAlertasTempranas(db, vecino), { nuevas: 0 });
    assert.equal((await alertasDe(db, vecino)).filter(fila => fila.tipo === 'ALERTA_TEMPRANA').length, 1);
  } finally {
    await base.cerrar();
  }
});

test('puesta al día: como máximo 5, los más recientes', { timeout: 60_000 }, async () => {
  const base = await baseEnMemoria();
  try {
    const reportante = await base.usuario('reporta@gmail.com');
    const vecino = await base.usuario('vecino@gmail.com');
    await base.zona(vecino);
    // cas_1 es el más reciente; cas_7, el más viejo.
    for (let n = 1; n <= 7; n += 1) await base.caso(`cas_${n}`, reportante, { horas: n });
    assert.equal(MAXIMO_PUESTA_AL_DIA, 5);
    assert.deepEqual(await ponerAlDiaAlertasTempranas(base.db, vecino), { nuevas: 5 });
    assert.deepEqual((await alertasDe(base.db, vecino)).map(fila => fila.caso_id), ['cas_1', 'cas_2', 'cas_3', 'cas_4', 'cas_5']);
    // Una segunda vez trae los que quedaron (siguen dentro de las 24 h).
    assert.deepEqual(await ponerAlDiaAlertasTempranas(base.db, vecino), { nuevas: 2 });
    assert.deepEqual(await ponerAlDiaAlertasTempranas(base.db, vecino), { nuevas: 0 });
  } finally {
    await base.cerrar();
  }
});

test('puesta al día por la API: al iniciar sesión y al guardar la zona; la ficha de alerta se abre', { timeout: 60_000 }, async () => {
  const base = await baseEnMemoria();
  const envios = [];
  const push = { disponible: true, clavePublica: 'clave', programar: (_db, lista) => envios.push(...lista), esperar: async () => {} };
  const server = createApp({ db: base.db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const pedir = async (metodo, ruta, token, cuerpo) => {
    const respuesta = await fetch(`${api}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    return { status: respuesta.status, data: await respuesta.json() };
  };
  const ingresar = async correo => (await pedir('POST', '/auth/login', null, { correo, contrasena: 'Clave-de-prueba-1' })).data;
  try {
    const reportante = await base.usuario('reporta@gmail.com');
    const vecino = await base.usuario('vecino@gmail.com');
    await base.usuario('nueva@gmail.com');
    await base.usuario('otro-reporta@gmail.com');
    await base.usuario('admin@gmail.com', { rol: 'administrador' });
    await base.zona(vecino);
    await base.caso('cas_a', reportante);
    await base.caso('cas_b', reportante, { km: 120 });

    // (a) Inicio de sesión de quien ya tenía la zona activa.
    const primero = await ingresar('vecino@gmail.com');
    assert.deepEqual(primero.puestaAlDia, { nuevas: 2 });
    assert.deepEqual((await ingresar('vecino@gmail.com')).puestaAlDia, { nuevas: 0 }, 'el segundo ingreso no repite');
    assert.deepEqual((await ingresar('admin@gmail.com')).puestaAlDia, { nuevas: 0 });

    // El centro de notificaciones las marca como puesta al día (no salen como aviso del sistema).
    const { data: { notificaciones } } = await pedir('GET', '/notificaciones', primero.token);
    assert.equal(notificaciones.length, 2);
    assert.ok(notificaciones.every(item => item.tipo === 'ALERTA_TEMPRANA' && item.canal === 'app' && item.puestaAlDia === true));

    // La ficha de alerta ahora se abre (alertaDelUsuario encuentra la fila).
    const ficha = await pedir('GET', '/alertas/cas_a', primero.token);
    assert.equal(ficha.status, 200);
    assert.equal(ficha.data.estado, 'PENDIENTE');

    // (b) Activar la zona después del reporte: PUT /alertas-zona.
    const nueva = await ingresar('nueva@gmail.com');
    assert.deepEqual(nueva.puestaAlDia, { nuevas: 0 }, 'todavía sin zona');
    const activar = await pedir('PUT', '/alertas-zona', nueva.token, { consentimiento: true, ubicacion: ZONA });
    assert.equal(activar.status, 200);
    assert.deepEqual(activar.data.puestaAlDia, { nuevas: 2 });
    const otraVez = await pedir('PUT', '/alertas-zona', nueva.token, { consentimiento: true, ubicacion: ZONA });
    assert.deepEqual(otraVez.data.puestaAlDia, { nuevas: 0 }, 'actualizar la zona no duplica');
    assert.equal((await pedir('GET', '/alertas/cas_b', nueva.token)).status, 200);
    assert.deepEqual(envios, [], 'nada sale por push');

    // La alerta temprana normal (al reportar) no se marca como puesta al día. Otro
    // reportante: el primero ya llegó al límite de una alerta temprana cada 24 h.
    const reporte = await pedir('POST', '/casos', (await ingresar('otro-reporta@gmail.com')).token, {
      nombreCompleto: 'Persona Nueva', edad: 40, sexo: 'Masculino', ciudad: 'Asunción', departamento: 'Capital',
      descripcionFisica: 'Alta', vestimenta: 'Camisa', fechaHoraDesaparicion: new Date().toISOString(),
      ubicacion: { lat: ZONA.lat, lng: ZONA.lng, direccion: 'Asunción' },
      declaraMayorEdad: true, avisoPrivacidadAceptado: true, declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION
    });
    if (reporte.status === 201) {
      const normales = (await pedir('GET', '/notificaciones', primero.token)).data.notificaciones
        .filter(item => item.casoId === reporte.data.caso.id);
      assert.equal(normales.length, 1);
      assert.equal(normales[0].puestaAlDia, false);
    } else {
      assert.fail(`no se pudo crear el reporte de prueba: ${JSON.stringify(reporte.data)}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await base.cerrar();
  }
});

test('interfaz: un solo aviso con la cantidad, y la puesta al día no sale como aviso del sistema', async () => {
  const { mostrarComoAvisoDelSistema, textoPuestaAlDia } = await import(new URL('js/notifications.js', publicDir));
  assert.equal(textoPuestaAlDia(0), '');
  assert.equal(textoPuestaAlDia(undefined), '');
  assert.equal(textoPuestaAlDia(1), 'Hay 1 caso en revisión cerca de tu zona. Revisalo en el centro de notificaciones.');
  assert.equal(textoPuestaAlDia(3), 'Hay 3 casos en revisión cerca de tu zona. Revisalos en el centro de notificaciones.');
  assert.equal(mostrarComoAvisoDelSistema({ tipo: 'ALERTA_TEMPRANA', canal: 'app', puestaAlDia: true }), false);
  assert.equal(mostrarComoAvisoDelSistema({ tipo: 'ALERTA_TEMPRANA', canal: 'app', puestaAlDia: false }), true);
});

// ---------- Motivo de rechazo y de devolución a revisión ----------

test('motivo de devolución: se arma y se lee con el mismo formato', () => {
  const mensaje = mensajeRevision('Ana Pérez', 'Falta el número de denuncia.');
  assert.equal(mensaje, 'El reporte de Ana Pérez volvió a revisión. Observación: Falta el número de denuncia.');
  assert.equal(motivoDeRevision(mensaje), 'Falta el número de denuncia.');
  assert.equal(mensajeRevision('Ana Pérez', ''), 'El reporte de Ana Pérez volvió a revisión.');
  assert.equal(motivoDeRevision('El reporte de Ana Pérez volvió a revisión.'), null);
  assert.equal(motivoDeRevision(null), null);
});

const DUENO = 10;
const OTRO = 42;
const MOTIVO_RECHAZO = 'MOTIVO-RECHAZO-SECRETO';
const MOTIVO_REVISION = 'MOTIVO-REVISION-SECRETO';
const filaCaso = (id, estado, extra = {}) => ({
  id, nombre_completo: `Persona ${id}`, edad: 30, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
  barrio: '', descripcion_fisica: 'Alta', vestimenta: 'Remera', senas_particulares: '',
  fecha_hora_desaparicion: new Date('2026-11-01T12:00:00Z'), latitud: -25.3, longitud: -57.6, direccion: 'Asunción',
  estado, creado_en: new Date('2026-11-01T13:00:00Z'), localizado_en: null, seguimiento_etapa: 0, tiene_foto: false,
  total_registros: 1, numero_denuncia: '', reportado_por_usr_id: DUENO, motivo_rechazo: null, ...extra
});

async function apiSimulada() {
  const rechazado = filaCaso('cas_rech', 'RECHAZADO', { motivo_rechazo: MOTIVO_RECHAZO });
  const devuelto = filaCaso('cas_dev', 'PENDIENTE');
  const validado = filaCaso('cas_val', 'VALIDADO', { motivo_rechazo: MOTIVO_RECHAZO });
  const db = {
    async query(sql, values = []) {
      if (sql.includes('sesion_version FROM usuarios')) return { rows: [{ rol: 'ciudadano', sesion_version: 0 }] };
      if (sql.includes('WHERE reportado_por_usr_id = $1')) return { rows: values[0] === DUENO ? [rechazado, devuelto, validado] : [] };
      if (sql.includes("tipo = 'CASO_REVISION'")) {
        // La base simulada respeta el filtro por usuario y por caso.
        return { rows: values[0] === DUENO && values[1].includes('cas_dev')
          ? [{ caso_id: 'cas_dev', mensaje: mensajeRevision('Persona cas_dev', MOTIVO_REVISION) }] : [] };
      }
      if (sql.includes('FROM casos')) return { rows: [validado] };
      return { rows: [] };
    }
  };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const pedir = async (ruta, usuario) => {
    const headers = usuario ? { Authorization: `Bearer ${jwt.sign({ id: usuario, rol: 'ciudadano' }, secret)}` } : {};
    const respuesta = await fetch(`${base}${ruta}`, { headers });
    return { status: respuesta.status, texto: await respuesta.text() };
  };
  return { pedir, cerrar: () => new Promise(resolve => server.close(resolve)) };
}

test('motivos: el dueño los ve en "Mis casos"; la API pública y otros ciudadanos no', async () => {
  const app = await apiSimulada();
  try {
    const propios = await app.pedir('/mis-casos', DUENO);
    assert.equal(propios.status, 200);
    const casos = Object.fromEntries(JSON.parse(propios.texto).casos.map(caso => [caso.id, caso]));
    assert.equal(casos.cas_rech.motivoRechazo, MOTIVO_RECHAZO);
    assert.equal(casos.cas_dev.motivoRevision, MOTIVO_REVISION);
    assert.equal(casos.cas_val.motivoRevision, null, 'solo mientras está en revisión');
    assert.equal(casos.cas_rech.motivoRevision, null);

    const ajenos = await app.pedir('/mis-casos', OTRO);
    assert.deepEqual(JSON.parse(ajenos.texto).casos, []);
    for (const usuario of [null, OTRO]) {
      for (const ruta of ['/casos', '/casos/cas_val']) {
        const { status, texto } = await app.pedir(ruta, usuario);
        assert.equal(status, 200, ruta);
        assert.ok(!texto.includes(MOTIVO_RECHAZO), `${ruta} sin el motivo de rechazo`);
        assert.ok(!texto.includes(MOTIVO_REVISION), `${ruta} sin el motivo de revisión`);
        assert.doesNotMatch(texto, /motivoRechazo|motivoRevision/);
      }
    }
  } finally {
    await app.cerrar();
  }
});

test('motivos: las serializaciones pública y del dueño no los llevan; la interfaz los muestra', async () => {
  const fila = filaCaso('cas_rech', 'RECHAZADO', { motivo_rechazo: MOTIVO_RECHAZO });
  assert.ok(!JSON.stringify(toPublicCase(fila)).includes(MOTIVO_RECHAZO));
  // toOwnerCase tampoco: "Mis casos" lo agrega aparte (case-routes.js), solo para el dueño.
  assert.ok(!JSON.stringify(toOwnerCase(fila)).includes(MOTIVO_RECHAZO));

  const { renderMyCasesView } = await import(new URL('js/my-cases.js', publicDir));
  const base = { id: 'c1', nombreCompleto: 'Ana', edad: 30, ciudad: 'Asunción', fechaCreacion: '2026-11-01T12:00:00Z' };
  const html = renderMyCasesView([
    { ...base, id: 'c1', estado: 'RECHAZADO', motivoRechazo: 'Datos <incompletos>' },
    { ...base, id: 'c2', estado: 'PENDIENTE', motivoRevision: 'Corregí la foto' },
    { ...base, id: 'c3', estado: 'PENDIENTE', motivoRevision: null }
  ], []);
  assert.match(html, /Motivo del rechazo:<\/strong> Datos &lt;incompletos&gt;/);
  assert.match(html, /Observación de la administración:<\/strong> Corregí la foto/);
  assert.equal(html.match(/Observación de la administración/g).length, 1, 'solo el caso devuelto');
});

// ---------- Orden del aviso respecto de la tarjeta "Notificaciones y alertas" ----------

// DOM falso con lo necesario para que avisos.js decida si abre la tarjeta.
async function interfazAvisos({ conTarjeta }) {
  const { instalarDom } = await import('../ayuda-tests/dom-falso.js');
  const dom = instalarDom({}, ['avisosTarjeta', 'toastNotification']);
  const anteriorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const anteriorSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0; // el aviso se oculta solo a los 7 s: acá no hace falta
  const navegador = { userAgent: 'Prueba', platform: 'Win32', maxTouchPoints: 0 };
  if (conTarjeta) navegador.serviceWorker = { getRegistration: async () => undefined };
  Object.defineProperty(globalThis, 'navigator', { value: navegador, configurable: true });
  Object.assign(globalThis.window, {
    // Con la aceptación de las bases vigentes (si no, la tarjeta no se ofrece).
    backendCurrentUser: { id: 7, rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: '2026-11-23T12:00:00Z' },
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 0,
    ...(conTarjeta ? { Notification: { permission: 'default' }, PushManager: function PushManager() {} } : {})
  });
  const anteriorNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
  if (conTarjeta) globalThis.Notification = globalThis.window.Notification;
  const anteriorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ notificaciones: [] }), { headers: { 'Content-Type': 'application/json' } });
  const avisos = await import(new URL('js/avisos.js', publicDir));
  // Al cerrar la tarjeta, el foco vuelve al contenido principal.
  Object.assign(dom.obtener('mainContent'), { hasAttribute: () => true, setAttribute() {} });
  const tarjeta = dom.obtener('avisosTarjeta');
  const toast = dom.obtener('toastNotification');
  return {
    avisos,
    tarjetaAbierta: () => !tarjeta.classList.contains('hidden'),
    aviso: () => (toast.classList.contains('hidden') ? null : dom.obtener('toastMessage').innerText),
    restaurar: () => {
      dom.restaurar();
      globalThis.fetch = anteriorFetch;
      globalThis.setTimeout = anteriorSetTimeout;
      Object.defineProperty(globalThis, 'navigator', anteriorNavigator);
      if (anteriorNotification) Object.defineProperty(globalThis, 'Notification', anteriorNotification);
      else delete globalThis.Notification;
    }
  };
}

test('interfaz: con la tarjeta abierta el aviso espera; al cerrarla con "Ahora no" sale uno solo', async () => {
  const ui = await interfazAvisos({ conTarjeta: true });
  try {
    await ui.avisos.ofrecerAvisosTrasIngreso({ puestaAlDia: 2 });
    assert.equal(ui.tarjetaAbierta(), true, 'se ofrece la tarjeta');
    assert.equal(ui.aviso(), null, 'el aviso no sale detrás de la tarjeta');
    await ui.avisos.ahoraNoAvisos();
    assert.equal(ui.tarjetaAbierta(), false);
    assert.equal(ui.aviso(), 'Hay 2 casos en revisión cerca de tu zona. Revisalos en el centro de notificaciones.');
  } finally {
    ui.restaurar();
  }
});

test('interfaz: si al cerrar la tarjeta ya sale otro aviso, la puesta al día se suma a ese (uno solo)', async () => {
  const ui = await interfazAvisos({ conTarjeta: true });
  try {
    await ui.avisos.ofrecerAvisosTrasIngreso({ puestaAlDia: 1 });
    assert.equal(ui.tarjetaAbierta(), true);
    ui.avisos.omitirZonaAvisos();
    assert.match(ui.aviso(), /agregá tu zona desde el menú.*Hay 1 caso en revisión cerca de tu zona\. Revisalo en el centro de notificaciones\.$/);
  } finally {
    ui.restaurar();
  }
});

test('interfaz: sin tarjeta, el aviso sale enseguida', async () => {
  const ui = await interfazAvisos({ conTarjeta: false });
  try {
    await ui.avisos.ofrecerAvisosTrasIngreso({ puestaAlDia: 3 });
    assert.equal(ui.tarjetaAbierta(), false);
    assert.equal(ui.aviso(), 'Hay 3 casos en revisión cerca de tu zona. Revisalos en el centro de notificaciones.');
  } finally {
    ui.restaurar();
  }
});

test('interfaz: con las bases por aceptar, el aviso espera; sale al aceptarlas (acceptTerms vuelve a llamar)', async () => {
  const ui = await interfazAvisos({ conTarjeta: false });
  try {
    // Aceptó una versión anterior de las bases: primero va la pantalla obligatoria.
    globalThis.window.backendCurrentUser = { id: 7, rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: '2026-10-18T12:00:00Z' };
    await ui.avisos.ofrecerAvisosTrasIngreso({ puestaAlDia: 2 });
    assert.equal(ui.aviso(), null, 'no sale encima de la pantalla de las bases');
    // Las acepta (auth.js, acceptTerms): misma llamada, sin cantidad.
    globalThis.window.backendCurrentUser = { ...globalThis.window.backendCurrentUser, fecha_aceptacion_terminos: '2026-11-23T12:00:00Z' };
    await ui.avisos.ofrecerAvisosTrasIngreso();
    assert.equal(ui.aviso(), 'Hay 2 casos en revisión cerca de tu zona. Revisalos en el centro de notificaciones.');
  } finally {
    ui.restaurar();
  }
});
