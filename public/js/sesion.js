// Restauración de la sesión al abrir la app (sin DOM, para poder testearla en Node).
// Regla: el token solo se descarta cuando el servidor lo rechaza (401 o 403).
// Si falla la red, vence el tiempo de espera o el servidor responde 5xx, la sesión
// se conserva: con la copia del usuario guardada en el último ingreso la app sigue
// mostrando la cuenta, y se vuelve a comprobar cuando el servidor responda.
const CLAVE_TOKEN = 'rastreo_token';
const CLAVE_USUARIO = 'rastreo_usuario';
// Borrador del reporte nuevo (report.js): es de la cuenta, se va con la sesión.
export const CLAVE_BORRADOR_REPORTE = 'rastreo_borrador_reporte';

// Fecha desde la que rige el texto actual de las bases (public/js/auth.js). Una
// aceptación anterior (o sin fecha) ya no vale: se vuelve a pedir una vez, sin
// migración (usuarios.fecha_aceptacion_terminos ya existe). Al cambiar el texto de
// las bases, actualizar esta fecha. Hora de Paraguay (UTC−3).
export const BASES_VIGENTES_DESDE = '2026-11-23';
const INICIO_VIGENCIA_MS = Date.parse(`${BASES_VIGENTES_DESDE}T00:00:00-03:00`);

// Milisegundos de una fecha en cualquiera de los formatos que llegan (Date, ISO con
// o sin zona, el texto de PostgreSQL "2026-11-23 10:00:00+00" o un número). null si
// no hay fecha o no se puede leer.
export function instanteAceptacion(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  // "AAAA-MM-DD HH:MM…" → "AAAA-MM-DDTHH:MM…" y zona "+00" → "+00:00" (solo con hora).
  const texto = String(valor).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2')
    .replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?[+-]\d{2})$/, '$1:00');
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : ms;
}

// La aceptación del usuario es de la versión vigente de las bases.
export function aceptoBasesVigentes(usuario) {
  const ms = instanteAceptacion(usuario?.fecha_aceptacion_terminos);
  return Boolean(usuario?.acepto_terminos) && ms !== null && ms >= INICIO_VIGENCIA_MS;
}

// Las bases y condiciones se exigen solo a ciudadanos (el backend rechaza la
// aceptación de un administrador) que no aceptaron la versión vigente: nunca las
// aceptaron, las aceptaron antes de BASES_VIGENTES_DESDE o no hay fecha.
export function debeAceptarBases(usuario) {
  return String(usuario?.rol || '').toLowerCase() === 'ciudadano' && !aceptoBasesVigentes(usuario);
}

export function esRechazoDeSesion(error) {
  return error?.status === 401 || error?.status === 403;
}

// La copia solo sirve para dibujar la interfaz sin red: los permisos reales los
// decide siempre el backend con el token.
export function recordarUsuario(usuario, almacen = sessionStorage) {
  try {
    almacen.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
  } catch {
    /* Almacenamiento lleno o bloqueado: sin copia, sin red se verá el login. */
  }
}

export function olvidarSesion(almacen = sessionStorage) {
  almacen.removeItem(CLAVE_TOKEN);
  almacen.removeItem(CLAVE_USUARIO);
  almacen.removeItem(CLAVE_BORRADOR_REPORTE);
}

function usuarioRecordado(almacen) {
  try {
    return JSON.parse(almacen.getItem(CLAVE_USUARIO)) || null;
  } catch {
    return null;
  }
}

// pedirUsuario: función que consulta /auth/me y devuelve el usuario (o lanza el
// error de apiRequest, que trae `status` solo si el servidor respondió).
// Devuelve { usuario, sinConexion }.
export async function restaurarSesion({ pedirUsuario, almacen = sessionStorage }) {
  if (!almacen.getItem(CLAVE_TOKEN)) return { usuario: null, sinConexion: false };
  try {
    const usuario = await pedirUsuario();
    recordarUsuario(usuario, almacen);
    return { usuario, sinConexion: false };
  } catch (error) {
    if (esRechazoDeSesion(error)) {
      olvidarSesion(almacen);
      return { usuario: null, sinConexion: false };
    }
    return { usuario: usuarioRecordado(almacen), sinConexion: true };
  }
}
