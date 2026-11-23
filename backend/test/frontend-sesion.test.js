import assert from 'node:assert/strict';
import test from 'node:test';

// Al abrir la app, initApp (public/js/app.js) comprueba el token con /auth/me usando
// restaurarSesion (public/js/sesion.js). Solo un 401/403 del servidor puede borrar la
// sesión; un corte de red, un timeout o un 5xx (proxy/túnel caído) la conservan.
const publicDir = new URL('../../public/', import.meta.url);
const { aceptoBasesVigentes, BASES_VIGENTES_DESDE, debeAceptarBases, instanteAceptacion, restaurarSesion, recordarUsuario } =
  await import(new URL('js/sesion.js', publicDir));

const USUARIO = { id: 7, nombre: 'Ana', rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: '2026-11-23T12:00:00Z' };

function almacenCon(datos = {}) {
  const mapa = new Map(Object.entries(datos));
  return {
    getItem: clave => (mapa.has(clave) ? mapa.get(clave) : null),
    setItem: (clave, valor) => mapa.set(clave, String(valor)),
    removeItem: clave => mapa.delete(clave),
    mapa
  };
}

function conSesion() {
  const almacen = almacenCon({ rastreo_token: 'tok' });
  recordarUsuario(USUARIO, almacen);
  return almacen;
}

const fallaCon = error => async () => { throw error; };
const conEstado = status => Object.assign(new Error(`HTTP ${status}`), { status });

test('sin token no consulta /auth/me', async () => {
  let consultas = 0;
  const resultado = await restaurarSesion({ pedirUsuario: async () => { consultas += 1; }, almacen: almacenCon() });
  assert.deepEqual(resultado, { usuario: null, sinConexion: false });
  assert.equal(consultas, 0);
});

test('con /auth/me correcto usa el usuario y guarda la copia', async () => {
  const almacen = almacenCon({ rastreo_token: 'tok' });
  const resultado = await restaurarSesion({ pedirUsuario: async () => USUARIO, almacen });
  assert.deepEqual(resultado, { usuario: USUARIO, sinConexion: false });
  assert.deepEqual(JSON.parse(almacen.getItem('rastreo_usuario')), USUARIO);
});

for (const status of [401, 403]) {
  test(`un ${status} borra el token y la copia del usuario`, async () => {
    const almacen = conSesion();
    const resultado = await restaurarSesion({ pedirUsuario: fallaCon(conEstado(status)), almacen });
    assert.deepEqual(resultado, { usuario: null, sinConexion: false });
    assert.equal(almacen.getItem('rastreo_token'), null);
    assert.equal(almacen.getItem('rastreo_usuario'), null);
  });
}

const fallasDeRed = [
  ['red caída (fetch rechazado)', new Error('No se pudo conectar con el servidor.')],
  ['timeout', Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })],
  ['500', conEstado(500)],
  ['502 del proxy', conEstado(502)],
  ['503', conEstado(503)]
];
for (const [caso, error] of fallasDeRed) {
  test(`${caso}: conserva token y sesión y avisa sin conexión`, async () => {
    const almacen = conSesion();
    const resultado = await restaurarSesion({ pedirUsuario: fallaCon(error), almacen });
    assert.deepEqual(resultado, { usuario: USUARIO, sinConexion: true });
    assert.equal(almacen.getItem('rastreo_token'), 'tok');
  });
}

test('sin red y sin copia guardada conserva el token aunque no haya usuario para mostrar', async () => {
  const almacen = almacenCon({ rastreo_token: 'tok' });
  const resultado = await restaurarSesion({ pedirUsuario: fallaCon(new Error('sin red')), almacen });
  assert.deepEqual(resultado, { usuario: null, sinConexion: true });
  assert.equal(almacen.getItem('rastreo_token'), 'tok');
});

test('con el apiRequest real: el status del error decide y se avisa a la franja', async () => {
  const anteriores = { fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, dispatchEvent: globalThis.dispatchEvent };
  const avisos = [];
  globalThis.dispatchEvent = evento => avisos.push(evento.detail.disponible);
  try {
    const { apiRequest } = await import(new URL('js/api.js', publicDir));
    const pedirUsuario = () => apiRequest('/auth/me').then(r => r.usuario);
    const respuesta = (status, cuerpo) => async () => new Response(JSON.stringify(cuerpo), { status });

    const casos = [
      ['fetch rechazado', async () => { throw new TypeError('Failed to fetch'); }, 'tok', true, false],
      ['504 del túnel', respuesta(504, {}), 'tok', true, false],
      // Un 500 conserva la sesión, pero el servidor respondió: apiRequest no avisa
      // "caído" (initApp igual muestra la franja porque no pudo comprobar la sesión).
      ['500 de la app', respuesta(500, {}), 'tok', true, true],
      ['401', respuesta(401, { error: 'La sesión no es válida.' }), null, false, true],
      ['200', respuesta(200, { usuario: USUARIO }), 'tok', false, true]
    ];
    for (const [caso, fetchFalso, tokenEsperado, sinConexionEsperado, disponibleEsperado] of casos) {
      globalThis.fetch = fetchFalso;
      globalThis.sessionStorage = conSesion();
      avisos.length = 0;
      const { sinConexion } = await restaurarSesion({ pedirUsuario });
      assert.equal(globalThis.sessionStorage.getItem('rastreo_token'), tokenEsperado, `${caso}: token`);
      assert.equal(sinConexion, sinConexionEsperado, `${caso}: sinConexion`);
      assert.deepEqual(avisos, [disponibleEsperado], `${caso}: aviso a la franja`);
    }
  } finally {
    Object.assign(globalThis, anteriores);
  }
});

test('bases y condiciones: la pantalla obligatoria es solo para ciudadanos que no aceptaron la versión vigente', () => {
  assert.equal(BASES_VIGENTES_DESDE, '2026-11-23');
  const ciudadano = fecha => ({ rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: fecha });
  // Nunca las aceptó (con o sin fecha).
  assert.equal(debeAceptarBases({ rol: 'ciudadano', acepto_terminos: false }), true);
  assert.equal(debeAceptarBases({ rol: 'ciudadano', acepto_terminos: false, fecha_aceptacion_terminos: '2026-12-01T10:00:00Z' }), true);
  // Aceptada pero sin fecha: no se sabe qué versión aceptó.
  for (const vacia of [null, undefined, '', 'no es una fecha']) {
    assert.equal(debeAceptarBases(ciudadano(vacia)), true, JSON.stringify(vacia));
  }
  // Aceptó una versión anterior: se vuelve a pedir.
  for (const anterior of ['2026-10-18T12:00:00Z', '2026-11-22 23:59:59+00', '2026-11-23T02:59:59.999Z',
    '2026-11-22T23:59:59-03:00', new Date('2026-11-01T00:00:00Z'), Date.parse('2026-11-20T00:00:00Z')]) {
    assert.equal(debeAceptarBases(ciudadano(anterior)), true, String(anterior));
  }
  // Aceptó la vigente: desde el 23/11/2026 a las 00:00 de Paraguay (03:00 UTC), en cualquier formato.
  for (const vigente of ['2026-11-23T03:00:00Z', '2026-11-23T00:00:00-03:00', '2026-11-23 10:00:00+00',
    '2026-11-23 10:00:00.123456+00', '2026-12-05T08:30:00.000Z', new Date('2027-01-01T00:00:00Z'), Date.parse('2026-11-24T00:00:00Z')]) {
    assert.equal(debeAceptarBases(ciudadano(vigente)), false, String(vigente));
  }
  assert.equal(instanteAceptacion('2026-11-23 10:00:00+00'), Date.parse('2026-11-23T10:00:00Z'));
  assert.equal(instanteAceptacion('2026-11-23'), Date.parse('2026-11-23'), 'una fecha sola no se confunde con una zona');
  assert.equal(aceptoBasesVigentes(ciudadano('2026-11-23T03:00:00Z')), true);
  // Nunca a un administrador, aunque no figure la aceptación (las cuentas de crear-admin.js).
  assert.equal(debeAceptarBases({ rol: 'administrador', acepto_terminos: false }), false);
  assert.equal(debeAceptarBases({ rol: 'ADMINISTRADOR' }), false);
  assert.equal(debeAceptarBases(null), false, 'sin sesión no hay pantalla obligatoria');
});
