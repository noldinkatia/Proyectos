// "Alertas de mi zona" (solo en la app): con sesión de ciudadano, el usuario da su
// consentimiento y recién al tocar el botón se piden los permisos de
// notificaciones y de ubicación. Se guarda solo una ubicación aproximada (el
// servidor la redondea a ≈1 km) y se puede desactivar y borrar cuando quiera.
import { apiRequest } from '/js/api.js';
import { escapeHtml } from '/js/config.js';
import { showToast } from '/js/ui.js';
import { esIos, yaInstalada } from './pwa.js';

let estadoZona = null;

export function soportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function modal() {
  return document.getElementById('zonaAlertasModal');
}

function textoSinSoporte() {
  if (esIos() && !yaInstalada()) {
    return 'En iPhone y iPad las alertas de zona funcionan solo con la app instalada en la pantalla de inicio (iOS 16.4 o posterior). Instalala desde el menú y abrila desde su ícono.';
  }
  return 'Este navegador no admite notificaciones push, así que no puede recibir alertas de zona. Probá con Chrome, Edge o Firefox actualizados.';
}

function renderZona() {
  const contenido = document.getElementById('zonaAlertasContenido');
  if (!contenido) return;
  const estado = estadoZona || { activa: false, push: { disponible: false } };
  const sinPushServidor = estado.push?.disponible ? ''
    : '<p class="notice-info">Por ahora el servidor no envía avisos al dispositivo: vas a ver las alertas en el centro de notificaciones.</p>';
  if (!soportaPush()) {
    contenido.innerHTML = `<p class="notice notice-warning">${escapeHtml(textoSinSoporte())}</p>
      ${estado.activa ? '<button type="button" class="btn btn-outline" data-on-click="desactivarAlertasZona()">Desactivar y borrar mi ubicación</button>' : ''}`;
    return;
  }
  if (estado.activa) {
    const fecha = estado.actualizadaEn ? new Date(estado.actualizadaEn).toLocaleString('es-PY') : '';
    contenido.innerHTML = `
      <p class="notice notice-success">Alertas de tu zona activadas.${fecha ? ` Ubicación aproximada actualizada el ${escapeHtml(fecha)}.` : ''}</p>
      <p>Recibís avisos de casos a 160 km o menos de tu última ubicación aproximada. Los avisos son discretos: sin nombre, edad, foto ni ubicación exacta; los detalles se ven al abrir la app.</p>
      ${sinPushServidor}
      <div class="zona-acciones">
        <button type="button" class="btn btn-outline" data-on-click="activarAlertasZona()">Actualizar mi ubicación</button>
        <button type="button" class="btn btn-red" data-on-click="desactivarAlertasZona()">Desactivar y borrar mi ubicación</button>
      </div>`;
    return;
  }
  contenido.innerHTML = `
    <p>Te avisamos de casos de personas desaparecidas a 160 km o menos de donde estás. Algunos avisos llegan antes de que la administración verifique el caso y lo indican como <strong>Pendiente / En revisión – No verificada</strong>.</p>
    <ul>
      <li>Se guarda solo tu última ubicación aproximada (≈1 km), sin historial.</li>
      <li>No se muestra a nadie ni se usa para otra cosa.</li>
      <li>Podés desactivar las alertas cuando quieras: se borra tu ubicación y se deja de enviarte avisos.</li>
    </ul>
    ${sinPushServidor}
    <label class="privacy-consent"><input type="checkbox" id="zonaConsentimiento"> Acepto que Rastreo PY guarde mi ubicación aproximada para enviarme alertas de mi zona.</label>
    <button type="button" class="btn btn-primary" data-on-click="activarAlertasZona()">Activar alertas de mi zona</button>`;
}

export async function abrirAlertasZona() {
  modal()?.classList.remove('hidden');
  const contenido = document.getElementById('zonaAlertasContenido');
  if (contenido) contenido.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    estadoZona = await apiRequest('/alertas-zona');
  } catch (error) {
    estadoZona = null;
    showToast('Alertas de zona no disponibles', error.message, 'error');
  }
  renderZona();
}

export function cerrarAlertasZona() {
  modal()?.classList.add('hidden');
}

function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo no permite obtener la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      posicion => resolve({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      () => reject(new Error('No se pudo obtener tu ubicación. Revisá el permiso de ubicación del navegador.')),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15000 }
    );
  });
}

function claveAplicacion(base64url) {
  const base64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), letra => letra.charCodeAt(0));
}

async function suscribirDispositivo(clavePublica) {
  const registro = await navigator.serviceWorker.ready;
  const opciones = { userVisibleOnly: true, applicationServerKey: claveAplicacion(clavePublica) };
  const existente = await registro.pushManager.getSubscription();
  if (existente) {
    try {
      return await registro.pushManager.subscribe(opciones);
    } catch {
      // Suscripción hecha con otra clave del servidor: se reemplaza.
      await existente.unsubscribe();
    }
  }
  return registro.pushManager.subscribe(opciones);
}

export async function activarAlertasZona() {
  const consentimiento = document.getElementById('zonaConsentimiento');
  if (consentimiento && !consentimiento.checked) {
    showToast('Falta tu consentimiento', 'Tildá la casilla para que se pueda guardar tu ubicación aproximada.', 'error');
    return;
  }
  const pushServidor = Boolean(estadoZona?.push?.disponible && estadoZona.push.clavePublica);
  try {
    if (pushServidor) {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        showToast('Permiso no concedido', 'Sin permiso de notificaciones no podemos avisarte. Podés habilitarlo desde la configuración del navegador.', 'error');
        return;
      }
    }
    const ubicacion = await obtenerUbicacion();
    const suscripcion = pushServidor ? await suscribirDispositivo(estadoZona.push.clavePublica) : null;
    await apiRequest('/alertas-zona', {
      method: 'PUT',
      body: { consentimiento: true, ubicacion, ...(suscripcion ? { suscripcion: suscripcion.toJSON() } : {}) }
    });
    showToast('Alertas de tu zona activadas', 'Te avisaremos de casos a 160 km o menos.', 'success');
    await abrirAlertasZona();
  } catch (error) {
    showToast('No se pudieron activar las alertas', error.message, 'error');
  }
}

export async function desactivarAlertasZona() {
  try {
    await apiRequest('/alertas-zona', { method: 'DELETE' });
    if (soportaPush()) {
      const registro = await navigator.serviceWorker.getRegistration();
      await (await registro?.pushManager.getSubscription())?.unsubscribe();
    }
    showToast('Alertas desactivadas', 'Se borró tu ubicación y no vas a recibir más alertas de zona.', 'success');
    await abrirAlertasZona();
  } catch (error) {
    showToast('No se pudieron desactivar las alertas', error.message, 'error');
  }
}
