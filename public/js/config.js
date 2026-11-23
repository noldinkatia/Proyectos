export const DB_KEY = 'RASTREO_PY_INSTITUCIONAL_V5';
export const API_BASE = '/api';

// A quién llama quien reportó para avisar que la persona fue localizada ("Mis
// casos" › "Indicar como localizado"): esa llamada es la verificación.
// telefono: el número para el enlace tel:, con prefijo de país (por ejemplo
// '+595 21 000 0000'). PENDIENTE: la administración todavía no definió el número;
// mientras esté vacío, la ventana nombra el contacto sin número ni enlace.
// Al cambiarlo, subir la versión del caché en public/sw.js.
export const CONTACTO_LOCALIZADO = {
  nombre: 'la administración de Rastreo PY',
  telefono: ''
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
