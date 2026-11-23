import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { PGlite, types } from '@electric-sql/pglite';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import {
  dentroDeParaguay, distanciaEntreKm, LIMITES_PARAGUAY, MARGEN_KM,
  MENSAJE_FUERA_DE_PARAGUAY, MENSAJE_PISTA_FUERA_DE_PARAGUAY
} from '../../public/js/limites-paraguay.js';
import { initializeDatabase } from '../db.js';
import { comoPool } from '../demo-visual.js';
import { createApp } from '../server.js';

// El punto del mapa de reportes y pistas tiene que estar en Paraguay (rectángulo
// del país con ~50 km de margen). Servidor sobre PGlite en memoria (sin PostgreSQL).
const secret = 'test-secret-with-at-least-thirty-two-characters';

// Ciudades de frontera (de los países vecinos) y de Paraguay: se aceptan.
const ACEPTADOS = {
  'Asunción': { lat: -25.2867, lng: -57.6333 },
  'Clorinda (AR)': { lat: -25.2840, lng: -57.7180 },
  'Posadas (AR)': { lat: -27.3671, lng: -55.8961 },
  'Foz do Iguaçu (BR)': { lat: -25.5163, lng: -54.5854 },
  'Ponta Porã (BR)': { lat: -22.5361, lng: -55.7256 },
  'Encarnación': { lat: -27.3306, lng: -55.8667 },
  'Bahía Negra': { lat: -20.2250, lng: -58.1650 },
  'esquina noroeste del Chaco': { lat: LIMITES_PARAGUAY.latMax, lng: LIMITES_PARAGUAY.lngMin }
};
// Lejos: se rechazan (el caso real quedó a 5.730 km).
const RECHAZADOS = {
  'Buenos Aires': { lat: -34.6037, lng: -58.3816 },
  'São Paulo': { lat: -23.5505, lng: -46.6333 },
  'Santa Cruz de la Sierra': { lat: -17.7833, lng: -63.1821 },
  'Miami': { lat: 25.7617, lng: -80.1918 },
  '(0, 0)': { lat: 0, lng: 0 }
};

test('módulo: rectángulo con margen de ~50 km; bordes, fronteras y lejanos', () => {
  assert.equal(MARGEN_KM, 50);
  for (const [nombre, p] of Object.entries(ACEPTADOS)) assert.equal(dentroDeParaguay(p.lat, p.lng), true, nombre);
  for (const [nombre, p] of Object.entries(RECHAZADOS)) assert.equal(dentroDeParaguay(p.lat, p.lng), false, nombre);
  const { latMin, latMax, lngMin, lngMax } = LIMITES_PARAGUAY;
  // ~40 km afuera del borde: entra; ~60 km afuera: no.
  const grados = km => km / 111.32;
  assert.equal(dentroDeParaguay(latMin - grados(40), -57), true, '40 km al sur');
  assert.equal(dentroDeParaguay(latMin - grados(60), -57), false, '60 km al sur');
  assert.equal(dentroDeParaguay(latMax + grados(40), -60), true, '40 km al norte');
  assert.equal(dentroDeParaguay(latMax + grados(60), -60), false, '60 km al norte');
  assert.equal(dentroDeParaguay(-25, lngMax + grados(40) / Math.cos(25 * Math.PI / 180)), true, '40 km al este');
  assert.equal(dentroDeParaguay(-25, lngMax + grados(60) / Math.cos(25 * Math.PI / 180)), false, '60 km al este');
  assert.equal(dentroDeParaguay(-22, lngMin - grados(60) / Math.cos(22 * Math.PI / 180)), false, '60 km al oeste');
  for (const malo of [[NaN, -57], ['', ''], [null, null], [undefined, -57], ['abc', '-57']]) {
    assert.equal(dentroDeParaguay(...malo), false, JSON.stringify(malo));
  }
  assert.equal(dentroDeParaguay('-25.28', '-57.63'), true, 'acepta texto numérico (campos ocultos)');
  // Asunción–Encarnación: unos 287 km en línea recta.
  assert.ok(Math.abs(distanciaEntreKm(ACEPTADOS['Asunción'], ACEPTADOS['Encarnación']) - 287) < 5);
});

async function app() {
  const pg = await PGlite.create({ parsers: { [types.INT8]: valor => valor } });
  const db = comoPool(pg);
  await initializeDatabase(db);
  const hash = await bcrypt.hash('Clave-de-prueba-1', 4);
  const usuario = async (correo, rol = 'ciudadano') => (await db.query(`
    INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
    VALUES ($1, $2, $3, $4, TRUE, TRUE, CURRENT_TIMESTAMP) RETURNING id
  `, [correo, correo, hash, rol])).rows[0].id;
  const ids = {};
  for (const correo of ['admin@gmail.com', 'uno@gmail.com', 'dos@gmail.com', 'tres@gmail.com', 'vecina@gmail.com']) {
    ids[correo] = await usuario(correo, correo.startsWith('admin') ? 'administrador' : 'ciudadano');
  }
  // Vecina con zona en Asunción: recibe las alertas tempranas cercanas.
  await db.query('INSERT INTO alertas_zona (usuario_id, latitud, longitud) VALUES ($1, -25.29, -57.63)', [ids['vecina@gmail.com']]);
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1', push: { disponible: false, programar() {} } })
    .listen(0, '127.0.0.1');
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
  const tokens = {};
  const token = async correo => (tokens[correo] ||= (await pedir('POST', '/auth/login', null, { correo, contrasena: 'Clave-de-prueba-1' })).data.token);
  const reporte = (ubicacion, extra = {}) => ({
    nombreCompleto: 'Persona de prueba', edad: 30, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
    descripcionFisica: 'Alta', vestimenta: 'Remera', fechaHoraDesaparicion: new Date().toISOString(),
    ubicacion: { ...ubicacion, direccion: 'Asunción' }, declaraMayorEdad: true, avisoPrivacidadAceptado: true,
    declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION, ...extra
  });
  return { db, ids, pedir, token, reporte, cerrar: async () => { await new Promise(r => server.close(r)); await db.end(); } };
}

test('servidor: reportes (crear y editar) y pistas fuera de Paraguay se rechazan; fronteras y bordes, no', { timeout: 90_000 }, async () => {
  const a = await app();
  try {
    const cuantos = async () => Number((await a.db.query('SELECT COUNT(*) FROM casos')).rows[0].count);
    // Crear: rechazados con el mensaje y sin guardar nada.
    for (const [nombre, p] of Object.entries(RECHAZADOS)) {
      const r = await a.pedir('POST', '/casos', await a.token('uno@gmail.com'), a.reporte(p));
      assert.equal(r.status, 400, nombre);
      assert.equal(r.data.error, MENSAJE_FUERA_DE_PARAGUAY, nombre);
    }
    assert.equal(await cuantos(), 0, 'nada guardado');
    // Crear: aceptados en fronteras y bordes.
    const creados = {};
    for (const [nombre, p] of Object.entries(ACEPTADOS)) {
      const r = await a.pedir('POST', '/casos', await a.token('dos@gmail.com'), a.reporte(p, { nombreCompleto: `Persona ${nombre}` }));
      assert.equal(r.status, 201, `${nombre}: ${JSON.stringify(r.data)}`);
      creados[nombre] = r.data.caso.id;
    }
    // Editar (PUT /mis-casos): mover el punto fuera se rechaza y el caso queda igual.
    const id = creados['Asunción'];
    const antes = (await a.db.query('SELECT latitud, longitud FROM casos WHERE id = $1', [id])).rows[0];
    const edicion = await a.pedir('PUT', `/mis-casos/${id}`, await a.token('dos@gmail.com'), a.reporte(RECHAZADOS['Miami'], { nombreCompleto: 'Persona Asunción' }));
    assert.equal(edicion.status, 400);
    assert.equal(edicion.data.error, MENSAJE_FUERA_DE_PARAGUAY);
    assert.deepEqual((await a.db.query('SELECT latitud, longitud FROM casos WHERE id = $1', [id])).rows[0], antes);
    const editadoEnFrontera = await a.pedir('PUT', `/mis-casos/${id}`, await a.token('dos@gmail.com'), a.reporte(ACEPTADOS['Clorinda (AR)'], { nombreCompleto: 'Persona Asunción' }));
    assert.equal(editadoEnFrontera.status, 200, JSON.stringify(editadoEnFrontera.data));

    // Pistas: sobre un caso público (validado).
    await a.db.query("UPDATE casos SET estado = 'VALIDADO' WHERE id = $1", [creados['Encarnación']]);
    const enviarPista = async ubicacion => a.pedir('POST', `/casos/${creados['Encarnación']}/pistas`, await a.token('tres@gmail.com'), {
      descripcion: 'La vi en la terminal', fechaHoraAvistamiento: new Date().toISOString(), fotos: [], ubicacion
    });
    for (const nombre of ['Buenos Aires', 'Miami']) {
      const r = await enviarPista(RECHAZADOS[nombre]);
      assert.equal(r.status, 400, nombre);
      assert.equal(r.data.error, MENSAJE_PISTA_FUERA_DE_PARAGUAY, nombre);
    }
    assert.equal(Number((await a.db.query('SELECT COUNT(*) FROM pistas')).rows[0].count), 0);
    for (const nombre of ['Posadas (AR)', 'Encarnación']) {
      assert.equal((await enviarPista(ACEPTADOS[nombre])).status, 201, nombre);
    }
  } finally {
    await a.cerrar();
  }
});

test('servidor: el panel recibe el motivo exacto de la alerta temprana', { timeout: 90_000 }, async () => {
  const a = await app();
  try {
    const crear = async (correo, nombre, ubicacion = ACEPTADOS['Asunción'], extra = {}) =>
      (await a.pedir('POST', '/casos', await a.token(correo), a.reporte(ubicacion, { nombreCompleto: nombre, ...extra }))).data.caso.id;
    const enviada = await crear('uno@gmail.com', 'Ana Primera');
    const porLimite = await crear('uno@gmail.com', 'Berta Segunda');            // mismo reportante, < 24 h
    const duplicado = await crear('dos@gmail.com', 'Ana Primera');              // mismo nombre y edad, cerca
    // Cargado directo en la base (como la demo): sin alerta y sin motivo registrado.
    await a.db.query(`
      INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
        fecha_hora_desaparicion, latitud, longitud, estado, reportado_por_usr_id)
      VALUES ('cas_directo', 'Caso Directo', 40, 'Masculino', 'Asunción', 'Capital', 'x', 'x', CURRENT_TIMESTAMP, -25.3, -57.6, 'PENDIENTE', $1)
    `, [a.ids['tres@gmail.com']]);

    const { casos } = (await a.pedir('GET', '/admin/casos', await a.token('admin@gmail.com'))).data;
    const por = Object.fromEntries(casos.map(c => [c.id, c]));
    const alertaUno = (await a.db.query('SELECT alerta_temprana_en FROM casos WHERE id = $1', [enviada])).rows[0].alerta_temprana_en;

    assert.ok(por[enviada].alertaTempranaEn);
    assert.deepEqual(por[enviada].alertaTemprana, { avisoDuplicado: null, otraAlertaEn: null, destinatarios: 1 }, 'la vecina con zona');
    assert.equal(por[porLimite].alertaTempranaEn, null);
    assert.equal(new Date(por[porLimite].alertaTemprana.otraAlertaEn).getTime(), new Date(alertaUno).getTime(), 'la otra alerta del mismo reportante');
    assert.equal(por[porLimite].alertaTemprana.avisoDuplicado, null);
    assert.match(por[duplicado].alertaTemprana.avisoDuplicado, /^El reporte de Ana Primera \(30 años, Asunción\) se parece al caso de Ana Primera/);
    assert.equal(por[duplicado].posibleDuplicado, true);
    assert.deepEqual(por.cas_directo.alertaTemprana, { avisoDuplicado: null, otraAlertaEn: null, destinatarios: 0 });
  } finally {
    await a.cerrar();
  }
});
