import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { DECLARACION_VERSION } from '../../public/js/declaracion.js';
import { cambioNumeroDenuncia, estadoDenunciaPublica } from '../case-shared.js';
import { createApp } from '../server.js';

// Al editar el reporte (PUT /mis-casos/:id), un número de denuncia distinto del
// guardado borra la marca checklist_denuncia: la verificación de la administración
// era sobre el número anterior. Si el número no cambia, la marca se conserva.
// Corre sin PostgreSQL (base simulada).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const DUENO = 10;
const NUMERO = 'DEN-2026-0001';

test('cambioNumeroDenuncia: compara sin contar espacios', () => {
  assert.equal(cambioNumeroDenuncia(NUMERO, NUMERO), false);
  assert.equal(cambioNumeroDenuncia(NUMERO, `  ${NUMERO} `), false, 'espacios alrededor');
  assert.equal(cambioNumeroDenuncia('DEN 2026 0001', 'DEN20260001'), false, 'espacios en el medio');
  assert.equal(cambioNumeroDenuncia('', '   '), false);
  assert.equal(cambioNumeroDenuncia(null, ''), false);
  assert.equal(cambioNumeroDenuncia(NUMERO, 'DEN-2026-0002'), true);
  assert.equal(cambioNumeroDenuncia(NUMERO, ''), true, 'borrarlo también es un cambio');
  assert.equal(cambioNumeroDenuncia('', NUMERO), true, 'cargarlo también');
});

// Un caso en revisión, verificado antes (por ejemplo, devuelto a revisión).
function iniciar() {
  const caso = {
    id: 'cas_ed', nombre_completo: 'Persona Prueba', edad: 30, sexo: 'Otro', departamento: 'Capital',
    ciudad: 'Asunción', barrio: '', descripcion_fisica: 'Descripción', vestimenta: 'Remera roja',
    senas_particulares: '', fecha_hora_desaparicion: new Date('2026-11-01T13:30:00.000Z'),
    latitud: -25.3, longitud: -57.6, direccion: 'Asunción', numero_denuncia: NUMERO, estado: 'PENDIENTE',
    reportado_por_usr_id: DUENO, autorizacion_parental: false, alerta_campos: ['departamento', 'ciudad'],
    foto: '', ediciones_reportante: 0, creado_en: new Date('2026-11-01T14:00:00Z'), localizado_en: null,
    checklist_denuncia: true, checklist_coherencia: true, checklist_duplicados: true, checklist_menores: true
  };
  const actualizaciones = [];
  const consulta = async (sql, values = []) => {
    if (sql.includes('sesion_version FROM usuarios')) return { rows: [{ rol: 'ciudadano', sesion_version: 0 }] };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (sql.includes('FROM casos WHERE id = $1 FOR UPDATE')) return { rows: [{ ...caso }] };
    if (sql.includes('UPDATE casos SET nombre_completo')) {
      actualizaciones.push({ sql, values });
      caso.vestimenta = values[8];
      caso.numero_denuncia = values[14];
      // Lo mismo que el CASE de la consulta.
      if (values[19] === true) caso.checklist_denuncia = false;
      caso.ediciones_reportante += 1;
      return { rows: [{ ...caso }] };
    }
    if (sql.includes('FROM casos')) return { rows: [{ ...caso, total_registros: 1 }] };
    return { rows: [] };
  };
  const db = { query: consulta, connect: async () => ({ query: consulta, release() {} }) };
  return { db, caso, actualizaciones };
}

async function conServidor(db, fn) {
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = jwt.sign({ id: DUENO, rol: 'ciudadano' }, secret);
  const editar = async extra => {
    const r = await fetch(`${base}/mis-casos/cas_ed`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombreCompleto: 'Persona Prueba', edad: 30, sexo: 'Otro', departamento: 'Capital', ciudad: 'Asunción', barrio: '',
        descripcionFisica: 'Descripción', vestimenta: 'Remera roja', senasParticulares: '',
        fechaHoraDesaparicion: '2026-11-01T13:30:00.000Z', ubicacion: { lat: -25.3, lng: -57.6 }, numeroDenuncia: NUMERO,
        declaraMayorEdad: true, avisoPrivacidadAceptado: true, autorizacionParental: false,
        alertaCampos: ['departamento', 'ciudad'], declaracionAceptada: true, declaracionVersion: DECLARACION_VERSION, ...extra
      })
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    await fn({ base, editar });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('edición: el número igual (aun con otros espacios) conserva la marca', async () => {
  const { db, caso, actualizaciones } = iniciar();
  await conServidor(db, async ({ editar }) => {
    const r = await editar({ vestimenta: 'Campera azul', numeroDenuncia: ` ${NUMERO}  ` });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(actualizaciones.at(-1).values[19], false, 'no se pide borrar la marca');
    assert.equal(caso.checklist_denuncia, true);
    assert.equal(estadoDenunciaPublica(caso), 'VERIFICADA');
  });
});

test('edición: un número distinto borra la marca, solo esa, y el indicador público pasa a SIN_VERIFICAR', async () => {
  const { db, caso, actualizaciones } = iniciar();
  await conServidor(db, async ({ base, editar }) => {
    const r = await editar({ numeroDenuncia: 'DEN-2026-0999' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const { sql, values } = actualizaciones.at(-1);
    assert.equal(values[19], true);
    assert.match(sql, /checklist_denuncia = CASE WHEN \$20::boolean THEN FALSE ELSE checklist_denuncia END/);
    assert.doesNotMatch(sql, /checklist_(coherencia|duplicados|menores)/, 'las otras casillas no se tocan');
    assert.equal(caso.checklist_denuncia, false);
    assert.deepEqual([caso.checklist_coherencia, caso.checklist_duplicados, caso.checklist_menores], [true, true, true]);

    // Si después se hace público sin pasar por la validación (de En revisión a
    // Localizado), la ficha pública dice "sin verificar", nunca el número.
    caso.estado = 'LOCALIZADO';
    caso.localizado_en = new Date();
    const publico = await (await fetch(`${base}/casos/cas_ed`)).text();
    assert.match(publico, /"denunciaPolicial":"SIN_VERIFICAR"/);
    assert.ok(!publico.includes('DEN-2026-0999') && !publico.includes('numeroDenuncia'));
  });
});

test('edición: borrar el número también quita la marca y el indicador queda NO_REGISTRADA', async () => {
  const { db, caso } = iniciar();
  await conServidor(db, async ({ editar }) => {
    const r = await editar({ numeroDenuncia: '' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(caso.checklist_denuncia, false);
    assert.equal(estadoDenunciaPublica(caso), 'NO_REGISTRADA');
  });
});
