import assert from 'node:assert/strict';
import test from 'node:test';

// "Notificaciones y alertas" (public/js/avisos-reglas.js): cuándo se ofrece la
// tarjeta después de iniciar sesión y qué estado muestra el interruptor del menú.
const {
  ESPERA_AHORA_NO_MS, MAXIMO_AHORA_NO, ESTADO_INICIAL, claveAvisos,
  disponibilidadAvisos, estadoInterruptor, guardarEstadoAvisos, leerEstadoAvisos, registrarAhoraNo, tarjetaAMostrar
} = await import(new URL('../../public/js/avisos-reglas.js', import.meta.url));

const AHORA = Date.UTC(2026, 10, 22, 12);
const DIA = 24 * 60 * 60 * 1000;
const base = {
  rol: 'ciudadano', permiso: 'default', disponibilidad: 'ok', suscripcionActiva: false,
  estado: { ...ESTADO_INICIAL }, ahora: AHORA
};
const tarjeta = cambios => tarjetaAMostrar({ ...base, ...cambios });

function almacenEnMemoria() {
  const datos = new Map();
  return { getItem: k => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), datos };
}

test('tarjeta: se ofrece a un ciudadano con permiso por defecto y sin suscripción', () => {
  assert.equal(tarjeta({}), 'activar');
  assert.equal(tarjeta({ rol: 'CIUDADANO' }), 'activar');
});

test('tarjeta: nunca con el permiso ya concedido o bloqueado', () => {
  assert.equal(tarjeta({ permiso: 'granted' }), null);
  assert.equal(tarjeta({ permiso: 'denied' }), null);
});

test('tarjeta: nunca con una suscripción push activa en el dispositivo', () => {
  assert.equal(tarjeta({ suscripcionActiva: true }), null);
});

test('tarjeta: nunca si se desactivó a propósito con el interruptor', () => {
  assert.equal(tarjeta({ estado: { ...ESTADO_INICIAL, desactivadas: true } }), null);
  assert.equal(tarjeta({ estado: { ...ESTADO_INICIAL, desactivadas: true }, disponibilidad: 'instalar' }), null);
});

test('tarjeta: la administración no la ve (no recibe alertas de zona ni push)', () => {
  assert.equal(tarjeta({ rol: 'administrador' }), null);
  assert.equal(tarjeta({ rol: 'ADMINISTRADOR' }), null);
  assert.equal(tarjeta({ rol: undefined }), null);
});

test('"Ahora no": vuelve a preguntar después de 3 días, hasta 3 veces en total', () => {
  let estado = { ...ESTADO_INICIAL };
  // 1.ª vez
  estado = registrarAhoraNo(estado, AHORA);
  assert.deepEqual(estado, { veces: 1, ultima: AHORA, desactivadas: false });
  assert.equal(tarjeta({ estado, ahora: AHORA + DIA }), null, 'al día siguiente, no');
  assert.equal(tarjeta({ estado, ahora: AHORA + ESPERA_AHORA_NO_MS - 1 }), null, 'un instante antes de los 3 días, no');
  assert.equal(tarjeta({ estado, ahora: AHORA + ESPERA_AHORA_NO_MS }), 'activar', 'a los 3 días, sí');
  // 2.ª vez
  const segunda = AHORA + 4 * DIA;
  estado = registrarAhoraNo(estado, segunda);
  assert.equal(estado.veces, 2);
  assert.equal(tarjeta({ estado, ahora: segunda + 2 * DIA }), null);
  assert.equal(tarjeta({ estado, ahora: segunda + 3 * DIA }), 'activar');
  // 3.ª vez: no se insiste más, pase el tiempo que pase.
  estado = registrarAhoraNo(estado, segunda + 3 * DIA);
  assert.equal(estado.veces, MAXIMO_AHORA_NO);
  assert.equal(tarjeta({ estado, ahora: segunda + 30 * DIA }), null);
  assert.equal(tarjeta({ estado, ahora: segunda + 365 * DIA }), null);
});

test('iPhone/iPad sin la app instalada: aviso de instalar, con las mismas esperas', () => {
  const disponibilidad = disponibilidadAvisos({ notificaciones: false, push: false, ios: true, instalada: false });
  assert.equal(disponibilidad, 'instalar');
  assert.equal(tarjeta({ disponibilidad }), 'instalar');
  const estado = registrarAhoraNo(ESTADO_INICIAL, AHORA);
  assert.equal(tarjeta({ disponibilidad, estado, ahora: AHORA + DIA }), null);
  assert.equal(tarjeta({ disponibilidad, estado: { ...estado, veces: 3 }, ahora: AHORA + 10 * DIA }), null);
  // Instalada (iOS 16.4+), con push: tarjeta normal.
  assert.equal(disponibilidadAvisos({ notificaciones: true, push: true, ios: true, instalada: true }), 'ok');
});

test('navegador sin notificaciones o sin push: ni tarjeta ni interruptor usable', () => {
  const disponibilidad = disponibilidadAvisos({ notificaciones: true, push: false, ios: false, instalada: false });
  assert.equal(disponibilidad, 'no-soportado');
  assert.equal(tarjeta({ disponibilidad }), null);
  assert.equal(estadoInterruptor({ permiso: 'default', disponibilidad, desactivadas: false }), 'no-soportado');
});

test('interruptor: activadas, desactivadas, bloqueadas y no disponibles', () => {
  const ok = 'ok';
  assert.equal(estadoInterruptor({ permiso: 'granted', disponibilidad: ok, desactivadas: false }), 'activadas');
  assert.equal(estadoInterruptor({ permiso: 'granted', disponibilidad: ok, desactivadas: true }), 'desactivadas', 'apagado a propósito con el permiso concedido');
  assert.equal(estadoInterruptor({ permiso: 'default', disponibilidad: ok, desactivadas: false }), 'desactivadas');
  assert.equal(estadoInterruptor({ permiso: 'denied', disponibilidad: ok, desactivadas: false }), 'bloqueadas');
  assert.equal(estadoInterruptor({ permiso: 'denied', disponibilidad: ok, desactivadas: true }), 'bloqueadas');
  assert.equal(estadoInterruptor({ permiso: 'default', disponibilidad: 'instalar', desactivadas: false }), 'instalar');
});

test('almacenamiento: por cuenta, y la app sigue funcionando si falla o está vacío', () => {
  const almacen = almacenEnMemoria();
  assert.deepEqual(leerEstadoAvisos(almacen, 7), ESTADO_INICIAL, 'vacío: estado inicial');
  guardarEstadoAvisos(almacen, 7, { veces: 2, ultima: AHORA, desactivadas: true });
  assert.deepEqual(leerEstadoAvisos(almacen, 7), { veces: 2, ultima: AHORA, desactivadas: true });
  assert.deepEqual(leerEstadoAvisos(almacen, 8), ESTADO_INICIAL, 'otra cuenta en el mismo dispositivo no hereda el estado');
  assert.equal(claveAvisos(7), 'rastreo_avisos_7');

  almacen.setItem(claveAvisos(9), '{roto');
  assert.deepEqual(leerEstadoAvisos(almacen, 9), ESTADO_INICIAL, 'JSON dañado');
  almacen.setItem(claveAvisos(9), JSON.stringify({ veces: -4, ultima: 'ayer', desactivadas: 'sí' }));
  assert.deepEqual(leerEstadoAvisos(almacen, 9), ESTADO_INICIAL, 'valores inválidos');

  const bloqueado = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(leerEstadoAvisos(bloqueado, 7), ESTADO_INICIAL);
  assert.doesNotThrow(() => guardarEstadoAvisos(bloqueado, 7, { veces: 1, ultima: AHORA, desactivadas: false }));
  assert.deepEqual(leerEstadoAvisos(null, 7), ESTADO_INICIAL, 'sin localStorage');
});
