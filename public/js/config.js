export const DB_KEY = 'RASTREO_PY_INSTITUCIONAL_V5';
export const API_BASE = '/api';

// Número de prueba para el evento; volver a 911 después.
// Es el destino (tel:) de todos los enlaces de llamada a la policía: en pantalla
// se sigue viendo "911", pero el celular marca este número, para que nadie llame
// a la policía de verdad desde el prototipo. También en el HTML estático, que no
// puede importar esta constante: el pie de public/Rastreopy.html y
// public/offline.html (marcados con un comentario).
// Al cambiarlo, subir la versión del caché en public/sw.js.
export const NUMERO_POLICIA_DEMO = '12345678910';
export const TEXTO_POLICIA = '911';

// A quién llama quien reportó para avisar que la persona fue localizada ("Mis
// casos" › "Indicar como localizado"): esa llamada es la verificación.
// telefono: el destino del enlace tel:. textoTelefono: lo que se ve en el enlace.
// PENDIENTE: la administración todavía no definió su número; para el evento el
// enlace usa el número de prueba y se ve "911", como en las fichas. Con telefono
// vacío, la ventana nombra el contacto sin número ni enlace.
// Al cambiarlo, subir la versión del caché en public/sw.js.
export const CONTACTO_LOCALIZADO = {
  nombre: 'la administración',
  telefono: NUMERO_POLICIA_DEMO,
  textoTelefono: TEXTO_POLICIA
};

try {
  localStorage.removeItem('RASTREO_PY_INSTITUCIONAL_V4');
} catch {
  /* Almacenamiento bloqueado o modo privado */
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
