import { API_BASE } from './config.js';

// Las fotos de casos y pistas exigen sesión, pero un <img src> no manda el token:
// se piden con fetch y se muestran como blob. Lanza un error si no se pudo.
export async function showProtectedPhoto(image, url) {
  const token = sessionStorage.getItem('rastreo_token');
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`No se pudo obtener la fotografía (${response.status}).`);
  const photo = URL.createObjectURL(await response.blob());
  image.src = photo;
  image.addEventListener('load', () => URL.revokeObjectURL(photo), { once: true });
}

async function cargarFotoProtegida(image) {
  const photoUrl = image.dataset.photoUrl;
  if (!photoUrl) return;
  image.dataset.protectedLoaded = 'true';
  try {
    await showProtectedPhoto(image, photoUrl);
  } catch (error) {
    console.error('No se pudo cargar una fotografía protegida:', error.message);
    image.remove();
  }
}

// Perezosas: cada foto se pide cuando está por verse (300 px antes), no todas al
// abrir la vista (el historial del panel puede tener muchas). Sin
// IntersectionObserver (navegadores viejos) se piden todas, como antes.
let observadorDeFotos = null;
function observador() {
  observadorDeFotos ||= new IntersectionObserver(entradas => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      observadorDeFotos.unobserve(entrada.target);
      cargarFotoProtegida(entrada.target);
    }
  }, { rootMargin: '300px 0px' });
  return observadorDeFotos;
}

// Carga las <img src="data:," data-photo-url="/api/..." data-protected-photo> de un
// contenedor que todavía no se cargaron (cada una se marca para no repetirla).
export async function loadProtectedPhotos(container) {
  const images = Array.from(container.querySelectorAll('img[data-protected-photo]:not([data-protected-loaded])'));
  if (typeof globalThis.IntersectionObserver === 'function') {
    for (const image of images) {
      image.dataset.protectedLoaded = 'pendiente';
      observador().observe(image);
    }
    return;
  }
  await Promise.all(images.map(cargarFotoProtegida));
}

// Avisa si el servidor respondió. navigator.onLine solo mira la red del equipo:
// con Wi-Fi pero el servidor (o el túnel/proxy) caído sigue diciendo "en línea".
// pwa.js escucha este evento para la franja de "Sin conexión".
export const EVENTO_SERVIDOR = 'rastreo:servidor';

export function avisarServidor(disponible) {
  globalThis.dispatchEvent?.(new CustomEvent(EVENTO_SERVIDOR, { detail: { disponible } }));
}

export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = sessionStorage.getItem('rastreo_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    avisarServidor(false);
    const requestError = new Error('No se pudo conectar con el servidor. Compruebe que esté disponible e intente nuevamente.');
    requestError.cause = error;
    throw requestError;
  }
  // 502/503/504 los responde el proxy (Render, túnel de Cloudflare) cuando la app
  // no está. Un 500 es un error de la app: el servidor sí respondió.
  avisarServidor(![502, 503, 504].includes(response.status));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(payload.error || `Error del servidor (${response.status}).`);
    requestError.status = response.status;
    requestError.endpoint = `${API_BASE}${path}`;
    // 429: segundos hasta poder volver a intentar (0 = ya, con un código nuevo).
    if (Number.isFinite(payload.reintentarEn)) requestError.reintentarEn = payload.reintentarEn;
    throw requestError;
  }
  return payload;
}
