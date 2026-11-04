// Estados del caso y saltos permitidos entre ellos. Es la única fuente: la usa la
// ruta de la administración (admin-routes.js, 409 si el salto no está) y los tests
// comprueban que el seguimiento automático y las respuestas del reportante también
// la respetan. La base de datos solo admite estos seis valores (migración 010).
//
// Sale de los flujos que existen: validar o rechazar lo que está en revisión,
// marcar localizado o cerrar lo activo, devolver a revisión, el seguimiento
// automático (VALIDADO → EN_SEGUIMIENTO, LOCALIZADO → CERRADO a los 7 días), la
// respuesta "sigue activa" (EN_SEGUIMIENTO → VALIDADO) y los botones de reabrir:
// CERRADO y RECHAZADO no son terminales, pero solo pueden volver a revisión
// (o CERRADO a seguimiento).
export const ESTADOS_CASO = ['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'];

export const TRANSICIONES_PERMITIDAS = Object.freeze({
  PENDIENTE: ['VALIDADO', 'RECHAZADO', 'LOCALIZADO', 'CERRADO'],
  VALIDADO: ['EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'PENDIENTE'],
  EN_SEGUIMIENTO: ['VALIDADO', 'LOCALIZADO', 'CERRADO', 'PENDIENTE'],
  LOCALIZADO: ['CERRADO', 'EN_SEGUIMIENTO', 'PENDIENTE'],
  CERRADO: ['PENDIENTE', 'EN_SEGUIMIENTO'],
  RECHAZADO: ['PENDIENTE']
});

// Nombres para los mensajes de error (como los ve la administración).
export const NOMBRE_ESTADO = Object.freeze({
  PENDIENTE: 'En revisión',
  VALIDADO: 'Validado',
  EN_SEGUIMIENTO: 'En seguimiento',
  LOCALIZADO: 'Localizado',
  CERRADO: 'Cerrado',
  RECHAZADO: 'Rechazado'
});

// Repetir el mismo estado no es un salto: no cambia nada y se permite.
export function transicionPermitida(desde, hacia) {
  return desde === hacia || Boolean(TRANSICIONES_PERMITIDAS[desde]?.includes(hacia));
}

export function mensajeTransicionNoPermitida(desde, hacia) {
  const destinos = (TRANSICIONES_PERMITIDAS[desde] || []).map(estado => NOMBRE_ESTADO[estado]);
  return `Un caso ${NOMBRE_ESTADO[desde] || desde} no puede pasar a ${NOMBRE_ESTADO[hacia] || hacia}.`
    + (destinos.length ? ` Desde ${NOMBRE_ESTADO[desde]} solo puede pasar a: ${destinos.join(', ')}.` : '');
}
