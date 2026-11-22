import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { fueValidado, toAdminCase } from '../case-shared.js';
import { createApp } from '../server.js';

// "Reabrir búsqueda" (CERRADO o LOCALIZADO → EN_SEGUIMIENTO) publica el caso. Si
// nunca fue validado, exige lo mismo que validar: número de denuncia y la lista
// completa, y guarda las casillas. Si ya fue validado, reabre directo. Corre sin
// PostgreSQL (base simulada).
const secret = 'test-secret-with-at-least-thirty-two-characters';
const ADMIN = 11;
const LISTA = { numeroDenuncia: 'DEN-2026-0500', verificoDenuncia: true, datosCoherentes: true, duplicadosVerificados: true, menorValidado: true };
const SIN_VALIDAR = { checklist_denuncia: false, checklist_coherencia: false, checklist_duplicados: false, checklist_menores: false };
const VALIDADO = { checklist_denuncia: true, checklist_coherencia: true, checklist_duplicados: true, checklist_menores: true };

function casoDePrueba(extra) {
  return {
    id: 'cas_re', nombre_completo: 'Persona Prueba', edad: 40, sexo: 'Otro', ciudad: 'Asunción', departamento: 'Capital',
    barrio: '', descripcion_fisica: 'Alta', vestimenta: 'Remera', senas_particulares: '',
    fecha_hora_desaparicion: new Date('2026-11-01T12:00:00Z'), latitud: -25.3, longitud: -57.6, direccion: 'Asunción',
    numero_denuncia: '', estado: 'CERRADO', reportado_por_usr_id: null, localizado_en: null,
    creado_en: new Date('2026-11-01T13:00:00Z'), seguimiento_etapa: 2, ...SIN_VALIDAR, ...extra
  };
}

async function conServidor(caso, fn) {
  const actualizaciones = [];
  const consulta = async (sql, values = []) => {
    if (sql.includes('sesion_version FROM usuarios')) return { rows: [{ rol: values[0] === ADMIN ? 'administrador' : 'ciudadano', sesion_version: 0 }] };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (sql.includes('SELECT * FROM casos WHERE id = $1 FOR UPDATE')) return { rows: [{ ...caso }] };
    if (sql.includes('UPDATE casos SET estado = $2')) {
      actualizaciones.push({ sql, values });
      // Lo mismo que la consulta: número y casillas solo si $11 (valida ahora).
      const [, estado, , numero, denuncia, coherencia, duplicados, menores, , , validaAhora] = values;
      caso.estado = estado;
      if (validaAhora) {
        if (numero !== '') caso.numero_denuncia = numero;
        Object.assign(caso, { checklist_denuncia: denuncia, checklist_coherencia: coherencia, checklist_duplicados: duplicados, checklist_menores: menores });
      }
      return { rows: [{ ...caso }] };
    }
    return { rows: [] };
  };
  const db = { query: consulta, connect: async () => ({ query: consulta, release() {} }) };
  const server = createApp({ db, mailer: { sendMail: async () => {} }, jwtSecret: secret, appUrl: 'http://127.0.0.1' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const token = jwt.sign({ id: ADMIN, rol: 'administrador' }, secret);
  const cambiar = async body => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/casos/cas_re/estado`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    await fn({ cambiar, actualizaciones });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('fueValidado: las cuatro casillas en true; el panel recibe validadoAlgunaVez', () => {
  assert.equal(fueValidado(VALIDADO), true);
  assert.equal(fueValidado(SIN_VALIDAR), false);
  for (const casilla of Object.keys(VALIDADO)) {
    assert.equal(fueValidado({ ...VALIDADO, [casilla]: false }), false, `sin ${casilla}`);
  }
  assert.equal(toAdminCase(casoDePrueba(VALIDADO)).validadoAlgunaVez, true);
  assert.equal(toAdminCase(casoDePrueba()).validadoAlgunaVez, false);
});

for (const origen of ['CERRADO', 'LOCALIZADO']) {
  test(`reabrir un caso ${origen} nunca validado: sin la lista completa da 400 y no cambia nada`, async () => {
    const caso = casoDePrueba({ estado: origen });
    await conServidor(caso, async ({ cambiar, actualizaciones }) => {
      const sinNada = await cambiar({ estado: 'EN_SEGUIMIENTO' });
      assert.equal(sinNada.status, 400);
      assert.equal(sinNada.data.error, 'Este caso nunca fue validado: para reabrir la búsqueda complete la validación. Debe registrar el número oficial de denuncia.');
      const sinCasilla = await cambiar({ ...LISTA, estado: 'EN_SEGUIMIENTO', duplicadosVerificados: false });
      assert.equal(sinCasilla.status, 400);
      assert.match(sinCasilla.data.error, /Debe completar toda la lista de validación antes de publicar el caso\.$/);
      const soloEspacios = await cambiar({ ...LISTA, estado: 'EN_SEGUIMIENTO', numeroDenuncia: '   ' });
      assert.equal(soloEspacios.status, 400);
      assert.equal(actualizaciones.length, 0, 'no se tocó el caso');
      assert.equal(caso.estado, origen);
    });
  });

  test(`reabrir un caso ${origen} nunca validado con la lista completa: EN_SEGUIMIENTO, número y casillas guardados`, async () => {
    const caso = casoDePrueba({ estado: origen });
    await conServidor(caso, async ({ cambiar, actualizaciones }) => {
      const r = await cambiar({ ...LISTA, estado: 'EN_SEGUIMIENTO' });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.caso.estado, 'EN_SEGUIMIENTO');
      assert.equal(r.data.caso.validadoAlgunaVez, true);
      assert.equal(caso.numero_denuncia, 'DEN-2026-0500');
      assert.equal(fueValidado(caso), true);
      assert.equal(actualizaciones[0].values[10], true);
      assert.match(actualizaciones[0].sql, /checklist_menores = CASE WHEN \$11::boolean THEN \$8/);
    });
  });
}

test('reabrir un caso ya validado: directo, sin lista, y no toca las casillas', async () => {
  const caso = casoDePrueba({ ...VALIDADO, numero_denuncia: 'DEN-ORIGINAL' });
  await conServidor(caso, async ({ cambiar, actualizaciones }) => {
    const r = await cambiar({ estado: 'EN_SEGUIMIENTO' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(caso.estado, 'EN_SEGUIMIENTO');
    assert.equal(actualizaciones[0].values[10], false, 'no valida de nuevo');
    assert.equal(caso.numero_denuncia, 'DEN-ORIGINAL');
    assert.equal(fueValidado(caso), true);
  });
});

test('un caso validado cuyo número cambió después (casilla de denuncia borrada) vuelve a pedir la lista', async () => {
  const caso = casoDePrueba({ ...VALIDADO, checklist_denuncia: false, numero_denuncia: 'DEN-EDITADO' });
  await conServidor(caso, async ({ cambiar }) => {
    assert.equal((await cambiar({ estado: 'EN_SEGUIMIENTO' })).status, 400);
  });
});

test('el resto de las transiciones no cambia', async () => {
  // Validar sigue exigiendo lo mismo, con los mismos mensajes.
  await conServidor(casoDePrueba({ estado: 'PENDIENTE' }), async ({ cambiar }) => {
    const sinNumero = await cambiar({ estado: 'VALIDADO' });
    assert.deepEqual([sinNumero.status, sinNumero.data.error], [400, 'Debe registrar el número oficial de denuncia.']);
    const sinLista = await cambiar({ estado: 'VALIDADO', numeroDenuncia: 'DEN-1' });
    assert.deepEqual([sinLista.status, sinLista.data.error], [400, 'Debe completar toda la lista de validación antes de publicar el caso.']);
    assert.equal((await cambiar({ ...LISTA, estado: 'VALIDADO' })).status, 200);
  });
  // "Marcar localizado" y "Cerrar caso" de un caso en revisión: sin cambios (pendiente de decisión).
  for (const [estado, extra] of [['LOCALIZADO', {}], ['CERRADO', { motivo: 'Duplicado' }]]) {
    await conServidor(casoDePrueba({ estado: 'PENDIENTE' }), async ({ cambiar, actualizaciones }) => {
      const r = await cambiar({ estado, ...extra });
      assert.equal(r.status, 200, `${estado}: ${JSON.stringify(r.data)}`);
      assert.equal(actualizaciones[0].values[10], false);
    });
  }
  // Devolver a revisión un caso cerrado nunca validado: sin lista, como hoy.
  await conServidor(casoDePrueba(), async ({ cambiar }) => {
    assert.equal((await cambiar({ estado: 'PENDIENTE', motivo: 'Revisar datos' })).status, 200);
  });
  // Un salto que no está en la tabla sigue dando 409 antes de pedir nada.
  await conServidor(casoDePrueba({ estado: 'RECHAZADO' }), async ({ cambiar }) => {
    assert.equal((await cambiar({ estado: 'EN_SEGUIMIENTO' })).status, 409);
  });
});
