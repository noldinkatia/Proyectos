// Estado de la pantalla del código (#/verificar) guardado en sessionStorage, para
// que recargar la página no pierda el flujo. Se guarda SOLO el correo, el propósito
// (registro o restablecer) y cuándo se puede pedir el próximo código: nunca la
// contraseña ni el código. Se borra al verificar, al cambiar de flujo, al iniciar
// sesión y al cerrar sesión (auth.js). Sin DOM: se testea en Node.
const CLAVE = 'rastreo_verificacion';
const PROPOSITOS = ['registro', 'restablecer'];
const GMAIL = /^[^\s@]+@gmail\.com$/i;

export function guardarVerificacion({ correo, proposito, proximoReenvio }, almacen = globalThis.sessionStorage) {
  if (!GMAIL.test(correo || '') || !PROPOSITOS.includes(proposito)) return;
  try {
    almacen.setItem(CLAVE, JSON.stringify({ correo, proposito, proximoReenvio: Number(proximoReenvio) || 0 }));
  } catch {
    /* Almacenamiento bloqueado: al recargar se vuelve al ingreso, como antes. */
  }
}

// Devuelve { correo, proposito, proximoReenvio } o null si no hay nada válido.
export function leerVerificacion(almacen = globalThis.sessionStorage) {
  try {
    const datos = JSON.parse(almacen.getItem(CLAVE));
    if (!datos || !GMAIL.test(datos.correo || '') || !PROPOSITOS.includes(datos.proposito)) return null;
    return { correo: datos.correo, proposito: datos.proposito, proximoReenvio: Number(datos.proximoReenvio) || 0 };
  } catch {
    return null;
  }
}

export function borrarVerificacion(almacen = globalThis.sessionStorage) {
  try {
    almacen.removeItem(CLAVE);
  } catch {
    /* Nada que borrar. */
  }
}

export function segundosParaReenviar(proximoReenvio, ahora = Date.now()) {
  return Math.max(0, Math.ceil((Number(proximoReenvio) - ahora) / 1000) || 0);
}

// "45 s", "3 min", "1 h 5 min": para avisar cuánto falta para pedir otro código.
export function textoEspera(segundos) {
  const s = Math.max(0, Math.ceil(Number(segundos) || 0));
  if (s < 60) return `${s} s`;
  const minutos = Math.ceil(s / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}
