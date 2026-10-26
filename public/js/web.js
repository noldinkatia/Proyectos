// Punto de entrada solo de la web (/). La lógica compartida con la app la arranca
// /js/app.js (cargado antes en Rastreopy.html). La web no es instalable: en un
// celular se ofrece abrir la app (/app/), que sí lo es; en una computadora, el
// botón "Descargar app" del encabezado lleva al mismo lugar.
import { acciones } from './app.js';

const CLAVE_AVISO = 'rastreo_aviso_app_cerrado';

function esCelular() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function avisoCerrado() {
  try {
    return sessionStorage.getItem(CLAVE_AVISO) === '1';
  } catch {
    return false;
  }
}

// El enlace conserva la ruta (#/caso/..., #/estadisticas): una ficha compartida
// se abre en la misma ficha dentro de la app.
function actualizarEnlace(id) {
  const enlace = document.getElementById(id);
  if (enlace) enlace.href = `/app/${location.hash}`;
}

function mostrarEnlaceApp(id) {
  actualizarEnlace(id);
  window.addEventListener('hashchange', () => actualizarEnlace(id));
}

export function cerrarAvisoApp() {
  document.getElementById('openAppNotice')?.classList.add('hidden');
  try {
    sessionStorage.setItem(CLAVE_AVISO, '1');
  } catch {
    /* Almacenamiento bloqueado: el aviso puede volver al recargar. */
  }
}

Object.assign(acciones, { cerrarAvisoApp });

if (!esCelular()) {
  mostrarEnlaceApp('headerAppLink');
  document.getElementById('headerAppLink')?.classList.remove('hidden');
} else if (!avisoCerrado()) {
  mostrarEnlaceApp('openAppLink');
  document.getElementById('openAppNotice')?.classList.remove('hidden');
}
