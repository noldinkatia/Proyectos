// Reglas de "Notificaciones y alertas" sin DOM (las prueba
// backend/test/avisos-reglas.test.js): cuándo ofrecer la tarjeta después de
// iniciar sesión y qué estado muestra el interruptor del menú.
//
// Lo que se guarda en este dispositivo (localStorage, por cuenta):
//   veces: cuántas veces se respondió "Ahora no" (o se cerró la tarjeta);
//   ultima: cuándo fue la última (ms);
//   desactivadas: la persona apagó el interruptor a propósito.
// Si el almacenamiento falla o está vacío, se usa el estado inicial: la app
// funciona igual, solo puede volver a ofrecer la tarjeta.

export const ESPERA_AHORA_NO_MS = 3 * 24 * 60 * 60 * 1000;
export const MAXIMO_AHORA_NO = 3;
export const ESTADO_INICIAL = Object.freeze({ veces: 0, ultima: null, desactivadas: false });

export const claveAvisos = usuarioId => `rastreo_avisos_${usuarioId}`;

export function leerEstadoAvisos(almacen, usuarioId) {
  try {
    const guardado = JSON.parse(almacen?.getItem(claveAvisos(usuarioId)) || 'null');
    if (!guardado || typeof guardado !== 'object') return { ...ESTADO_INICIAL };
    return {
      veces: Number.isInteger(guardado.veces) && guardado.veces > 0 ? guardado.veces : 0,
      ultima: Number.isFinite(guardado.ultima) ? guardado.ultima : null,
      desactivadas: guardado.desactivadas === true
    };
  } catch {
    return { ...ESTADO_INICIAL };
  }
}

export function guardarEstadoAvisos(almacen, usuarioId, estado) {
  try {
    almacen?.setItem(claveAvisos(usuarioId), JSON.stringify(estado));
  } catch {
    /* Almacenamiento lleno o bloqueado: la tarjeta puede volver a aparecer. */
  }
}

export function registrarAhoraNo(estado, ahora) {
  return { ...estado, veces: estado.veces + 1, ultima: ahora };
}

// Qué puede hacer este dispositivo:
//   'ok'           notificaciones y push disponibles;
//   'instalar'     iPhone/iPad sin la app en la pantalla de inicio (Safari no
//                  recibe push fuera de la app instalada);
//   'no-soportado' otro navegador sin notificaciones o sin push.
export function disponibilidadAvisos({ notificaciones, push, ios, instalada }) {
  if (ios && !instalada) return 'instalar';
  return notificaciones && push ? 'ok' : 'no-soportado';
}

// La tarjeta posterior al ingreso: 'activar', 'instalar' o null (no mostrar).
// Solo para ciudadanos: la administración no recibe alertas de zona ni push.
export function tarjetaAMostrar({ rol, permiso, disponibilidad, suscripcionActiva, estado, ahora }) {
  if (String(rol || '').toLowerCase() !== 'ciudadano') return null;
  if (estado.desactivadas) return null;
  if (estado.veces >= MAXIMO_AHORA_NO) return null;
  if (estado.ultima !== null && ahora - estado.ultima < ESPERA_AHORA_NO_MS) return null;
  if (disponibilidad === 'instalar') return 'instalar';
  if (disponibilidad !== 'ok') return null;
  if (permiso === 'granted' || permiso === 'denied') return null;
  if (suscripcionActiva) return null;
  return 'activar';
}

// Estado del interruptor del menú:
//   'activadas' | 'desactivadas' | 'bloqueadas' | 'instalar' | 'no-soportado'.
export function estadoInterruptor({ permiso, disponibilidad, desactivadas }) {
  if (disponibilidad !== 'ok') return disponibilidad;
  if (permiso === 'denied') return 'bloqueadas';
  return permiso === 'granted' && !desactivadas ? 'activadas' : 'desactivadas';
}
