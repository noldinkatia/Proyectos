import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { createDatabase, initializeDatabase, seedAdministrator } from '../db.js';
import { createApp } from '../server.js';

// Antecedente de reporte falso o abusivo (migración 008): solo la administración lo
// ve. Este test lo busca, por clave y por el texto del motivo, en todas las
// respuestas del ciudadano marcado y en las públicas.
const secret = 'test-secret-with-at-least-thirty-two-characters';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const conPostgres = { skip: !testDatabaseUrl && 'Defina TEST_DATABASE_URL para ejecutar la prueba de integración con PostgreSQL.' };

test('antecedentes: marcar y retirar con motivo, auditoría y nunca en respuestas de ciudadano ni públicas', conPostgres, async () => {
  const db = createDatabase(testDatabaseUrl);
  const suffix = randomUUID().replaceAll('-', '');
  const motivoSecreto = `MOTIVO-SECRETO-${suffix}`;
  const retiroSecreto = `RETIRO-SECRETO-${suffix}`;
  const usuarios = [];
  let server;
  try {
    await initializeDatabase(db);
    const adminEmail = `ant.admin.${suffix}@gmail.com`;
    await seedAdministrator(db, adminEmail, 'Integration-test-password-123');
    const adminId = (await db.query("UPDATE usuarios SET nombre_completo = 'Admin Antecedentes' WHERE correo = $1 RETURNING id", [adminEmail])).rows[0].id;
    usuarios.push(adminId);
    const hash = await bcrypt.hash('Password-test-1', 4);
    const crearCiudadano = async nombre => {
      const correo = `ant.${nombre}.${suffix}@gmail.com`;
      const id = (await db.query(`INSERT INTO usuarios (nombre_completo, correo, contrasena_hash, rol, verificado, acepto_terminos, fecha_aceptacion_terminos)
        VALUES ($1, $2, $3, 'ciudadano', TRUE, TRUE, CURRENT_TIMESTAMP) RETURNING id`, [`Ciudadano ${nombre}`, correo, hash])).rows[0].id;
      usuarios.push(id);
      return { id, correo, token: jwt.sign({ id, rol: 'ciudadano' }, secret) };
    };
    const marcado = await crearCiudadano('marcado');
    const vecino = await crearCiudadano('vecino');
    const admin = jwt.sign({ id: adminId, rol: 'administrador' }, secret);

    // Un caso público del marcado, con pista validada y una alerta que recibió el vecino.
    const casoId = `case_${suffix}`;
    await db.query(`INSERT INTO casos (id, nombre_completo, edad, sexo, ciudad, departamento, descripcion_fisica, vestimenta,
      fecha_hora_desaparicion, foto, latitud, longitud, estado, reportado_por_usr_id, alerta_temprana_en)
      VALUES ($1, 'Caso del marcado', 30, 'Otro', 'Asunción', 'Capital', 'Descripción', 'Vestimenta', CURRENT_TIMESTAMP,
        'data:image/jpeg;base64,/9j/2Q==', -25.2867, -57.6333, 'VALIDADO', $2, CURRENT_TIMESTAMP)`, [casoId, marcado.id]);
    await db.query(`INSERT INTO pistas (id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud, estado)
      VALUES ($1, $2, $3, 'Pista validada', CURRENT_TIMESTAMP, -25.29, -57.63, 'VALIDADA')`, [`clue_${suffix}`, casoId, vecino.id]);
    await db.query(`INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo, distancia_km)
      VALUES ($1, $2, 'Alerta', 'Caso cerca', 'ALERTA_OFICIAL', 2), ($3, $2, 'Caso validado', 'Tu reporte fue publicado.', 'CASO_VALIDADO', NULL)`,
    [vecino.id, casoId, marcado.id]);

    server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const pedir = async (metodo, ruta, token, cuerpo) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
      const texto = await r.text();
      return { status: r.status, texto, data: (() => { try { return JSON.parse(texto); } catch { return null; } })() };
    };

    // --- Administración: validaciones
    assert.equal((await pedir('POST', `/admin/usuarios/${marcado.id}/antecedentes`, admin, { motivo: '   ' })).status, 400, 'motivo vacío');
    assert.equal((await pedir('POST', `/admin/usuarios/${adminId}/antecedentes`, admin, { motivo: 'x' })).status, 404, 'solo ciudadanos');
    assert.equal((await pedir('POST', `/admin/usuarios/${marcado.id}/antecedentes`, marcado.token, { motivo: 'x' })).status, 403, 'un ciudadano no puede marcar');

    // --- Marcar
    const marca = await pedir('POST', `/admin/usuarios/${marcado.id}/antecedentes`, admin, { motivo: `  ${motivoSecreto}  ` });
    assert.equal(marca.status, 201);
    assert.equal(marca.data.antecedente.motivo, motivoSecreto, 'sin espacios de más');
    assert.ok(marca.data.antecedente.registradoEn, 'con fecha');
    const antecedenteId = marca.data.antecedente.id;
    const enPanel = (await pedir('GET', '/admin/casos', admin)).data.casos.find(c => c.id === casoId);
    assert.equal(enPanel.antecedentesReportante.length, 1);
    assert.equal(enPanel.antecedentesReportante[0].motivo, motivoSecreto);
    assert.equal(enPanel.antecedentesReportante[0].registradoPor, 'Admin Antecedentes');

    // Un reporte nuevo del marcado: se publica igual; el aviso a la administración lo menciona.
    const nuevo = await pedir('POST', '/casos', marcado.token, {
      nombreCompleto: `Nuevo ${suffix}`, edad: 30, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción',
      descripcionFisica: 'x', vestimenta: 'x', fechaHoraDesaparicion: new Date().toISOString(),
      ubicacion: { lat: -25.2867, lng: -57.6333 }, declaraMayorEdad: true, avisoPrivacidadAceptado: true,
      declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION
    });
    assert.equal(nuevo.status, 201, 'no se bloquea');
    const avisoAdmin = (await db.query("SELECT mensaje FROM notificaciones WHERE usuario_id = $1 AND caso_id = $2 AND tipo = 'CASO_PENDIENTE'",
      [adminId, nuevo.data.caso.id])).rows[0].mensaje;
    assert.match(avisoAdmin, /quien lo reportó tiene un antecedente de reporte falso o abusivo\. La marca no bloquea el reporte ni la alerta temprana\./);

    // --- Ninguna respuesta del ciudadano ni pública lo menciona
    const login = await pedir('POST', '/auth/login', null, { correo: marcado.correo, contrasena: 'Password-test-1' });
    assert.equal(login.status, 200);
    const rutas = [
      ['inicio de sesión', login],
      ['POST /casos (respuesta del reporte nuevo)', nuevo],
      ['/auth/me', await pedir('GET', '/auth/me', marcado.token)],
      ['/mis-casos', await pedir('GET', '/mis-casos', marcado.token)],
      ['/notificaciones (marcado)', await pedir('GET', '/notificaciones', marcado.token)],
      ['/notificaciones (vecino)', await pedir('GET', '/notificaciones', vecino.token)],
      ['/casos', await pedir('GET', '/casos')],
      ['/casos paginado', await pedir('GET', '/casos?page=1&limit=100')],
      ['/casos/:id', await pedir('GET', `/casos/${casoId}`)],
      ['/casos/:id con sesión', await pedir('GET', `/casos/${casoId}`, marcado.token)],
      ['/pistas', await pedir('GET', '/pistas')],
      ['/estadisticas', await pedir('GET', '/estadisticas')],
      ['/alertas/:id', await pedir('GET', `/alertas/${casoId}`, vecino.token)],
      ['/alertas-zona', await pedir('GET', '/alertas-zona', marcado.token)]
    ];
    for (const [nombre, respuesta] of rutas) {
      assert.ok(respuesta.status < 500, `${nombre}: ${respuesta.status}`);
      assert.doesNotMatch(respuesta.texto, /antecedente/i, `${nombre}: clave`);
      assert.ok(!respuesta.texto.includes(motivoSecreto), `${nombre}: motivo`);
    }
    assert.ok(rutas.find(([n]) => n === '/casos')[1].data.casos.some(c => c.id === casoId), 'el caso sí es público');
    assert.equal((await pedir('GET', `/casos/${casoId}/foto`)).status, 200);

    // --- Retirar: motivo obligatorio, queda el historial
    assert.equal((await pedir('POST', `/admin/antecedentes/${antecedenteId}/retirar`, admin, { motivo: ' \n ' })).status, 400);
    const retiro = await pedir('POST', `/admin/antecedentes/${antecedenteId}/retirar`, admin, { motivo: retiroSecreto });
    assert.equal(retiro.status, 200);
    assert.ok(retiro.data.antecedente.retiradoEn);
    assert.equal(retiro.data.antecedente.retiradoPor, adminId);
    assert.equal((await pedir('POST', `/admin/antecedentes/${antecedenteId}/retirar`, admin, { motivo: 'otra vez' })).status, 404, 'ya retirado');
    assert.equal((await pedir('GET', '/admin/casos', admin)).data.casos.find(c => c.id === casoId).antecedentesReportante.length, 0);
    const fila = (await db.query('SELECT motivo, motivo_retiro, registrado_por, retirado_por FROM antecedentes_usuario WHERE id = $1', [antecedenteId])).rows[0];
    assert.deepEqual(fila, { motivo: motivoSecreto, motivo_retiro: retiroSecreto, registrado_por: adminId, retirado_por: adminId });
    // La base rechaza un motivo en blanco aunque alguien salte la API.
    await assert.rejects(db.query("INSERT INTO antecedentes_usuario (usuario_id, motivo) VALUES ($1, '   ')", [marcado.id]));

    // --- Auditoría: quién marcó y quién retiró, con el motivo
    const auditoria = (await pedir('GET', '/admin/auditoria', admin)).data.eventos
      .filter(e => e.tipoRegistro === 'Antecedente' && e.persona === 'Ciudadano marcado');
    assert.deepEqual(auditoria.map(e => [e.estadoAnterior, e.estadoNuevo, e.administrador, e.motivo]).sort(), [
      [null, 'MARCADO', 'Admin Antecedentes', motivoSecreto],
      ['MARCADO', 'RETIRADO', 'Admin Antecedentes', retiroSecreto]
    ].sort());
    assert.equal((await pedir('GET', '/admin/auditoria', marcado.token)).status, 403);

    // Después de retirar, tampoco aparece el motivo del retiro en las respuestas del ciudadano.
    for (const ruta of ['/auth/me', '/mis-casos', '/notificaciones']) {
      const r = await pedir('GET', ruta, marcado.token);
      assert.ok(!r.texto.includes(retiroSecreto) && !/antecedente/i.test(r.texto), ruta);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (usuarios.length) {
      const casos = (await db.query('SELECT id FROM casos WHERE reportado_por_usr_id = ANY($1)', [usuarios])).rows.map(r => r.id);
      await db.query('DELETE FROM cambios_estado_pista WHERE pista_id IN (SELECT id FROM pistas WHERE caso_id = ANY($1))', [casos]);
      for (const tabla of ['notificaciones', 'suscripciones_caso', 'cambios_estado_caso', 'pistas']) {
        await db.query(`DELETE FROM ${tabla} WHERE caso_id = ANY($1)`, [casos]);
      }
      await db.query('DELETE FROM casos WHERE id = ANY($1)', [casos]);
      await db.query('DELETE FROM notificaciones WHERE usuario_id = ANY($1)', [usuarios]);
      await db.query('DELETE FROM antecedentes_usuario WHERE usuario_id = ANY($1)', [usuarios]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [usuarios]);
    }
    await db.end();
  }
});

test('panel: marca corta en la bandeja y detalle con "Retirar marca" en la revisión', async () => {
  const { avisoAntecedente } = await import(new URL('../../public/js/admin.js', import.meta.url));
  const caso = { reportadoPorUsrId: 7, alertaTempranaEn: '2026-10-12T15:05:00Z', antecedentesReportante: [{ id: '3', motivo: 'Reporte <falso>', registradoEn: '2026-10-12T15:00:00Z', registradoPor: 'Admin' }] };
  assert.equal(avisoAntecedente(caso), '<br><span class="marca-antecedente">⚠ Reportante con antecedente</span>');
  const detalle = avisoAntecedente(caso, { detalle: true });
  assert.match(detalle, /El reportante tiene un antecedente de reporte falso o abusivo/);
  assert.match(detalle, /La marca no bloquea nada: la alerta temprana a la zona salió igual\./);
  // Si la alerta no salió (duplicado, límite por reportante), no se dice que salió.
  assert.match(avisoAntecedente({ ...caso, alertaTempranaEn: null }, { detalle: true }), /La marca no bloquea nada\.<\/p>/);
  assert.match(detalle, /Reporte &lt;falso&gt;/, 'el motivo se escapa');
  assert.match(detalle, /data-antecedente-id="3" data-on-click="adminRetirarAntecedente\(this\.dataset\.antecedenteId\)">Retirar marca</);
  assert.match(detalle, /data-user-id="7" data-on-click="adminMarcarAntecedente\(this\.dataset\.userId\)">Marcar antecedente del reportante</);
  // Sin antecedentes: nada en la fila y solo el botón para marcar en la revisión.
  const limpio = { reportadoPorUsrId: 7, antecedentesReportante: [] };
  assert.equal(avisoAntecedente(limpio), '');
  assert.doesNotMatch(avisoAntecedente(limpio, { detalle: true }), /tiene/);
  assert.match(avisoAntecedente(limpio, { detalle: true }), /Marcar antecedente del reportante/);
});
