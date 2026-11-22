// Alertas de zona y Web Push de este dispositivo: lo que habla con el navegador
// (ubicación, suscripción push) y con el servidor (/api/alertas-zona). La
// interfaz es el interruptor "Notificaciones y alertas" y la tarjeta posterior al
// ingreso (/js/avisos.js), en la web y en la app.
// Se guarda solo una ubicación aproximada (el servidor la redondea a ≈1 km) y se
// puede desactivar y borrar cuando se quiera.
import { apiRequest } from '../js/api.js';

export function soportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo no permite obtener la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      posicion => resolve({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      () => reject(new Error('No se pudo obtener tu ubicación. Revisá el permiso de ubicación del navegador o elegí tu zona de la lista.')),
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

// Suscripción push de este navegador (null si no hay o no se puede saber).
export async function suscripcionDelDispositivo() {
  if (!soportaPush()) return null;
  try {
    const registro = await navigator.serviceWorker.getRegistration();
    return (await registro?.pushManager.getSubscription()) || null;
  } catch {
    return null;
  }
}

// { activa, actualizadaEn, dispositivos, push: { disponible, clavePublica } }
export function consultarZona() {
  return apiRequest('/alertas-zona');
}

// El servicio push del navegador puede no responder nunca (red que lo bloquea,
// navegador con push deshabilitado): pasado este tiempo se sigue sin push.
export const ESPERA_SUSCRIPCION_MS = 15000;

function conLimite(promesa, ms) {
  let temporizador;
  const vencida = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error('El servicio de notificaciones del navegador no respondió.')), ms);
  });
  return Promise.race([promesa, vencida]).finally(() => clearTimeout(temporizador));
}

// Guarda la ubicación aproximada y, si el servidor envía push y el navegador lo
// admite, suscribe este dispositivo (el permiso ya tiene que estar concedido).
// Si la suscripción falla, la zona se guarda igual: las alertas se ven en el
// centro de notificaciones. Devuelve { sinPush } para avisarlo.
export async function guardarZona(ubicacion) {
  const estado = await consultarZona();
  const pushServidor = Boolean(estado?.push?.disponible && estado.push.clavePublica);
  let suscripcion = null;
  let sinPush = false;
  if (pushServidor && soportaPush() && Notification.permission === 'granted') {
    try {
      suscripcion = await conLimite(suscribirDispositivo(estado.push.clavePublica), ESPERA_SUSCRIPCION_MS);
    } catch (error) {
      console.error('No se pudo suscribir el dispositivo a las notificaciones push:', error.message);
      sinPush = true;
    }
  }
  await apiRequest('/alertas-zona', {
    method: 'PUT',
    body: { consentimiento: true, ubicacion, ...(suscripcion ? { suscripcion: suscripcion.toJSON() } : {}) }
  });
  return { sinPush };
}

// Borra la ubicación y las suscripciones push de la cuenta en el servidor, y da
// de baja la de este navegador (también si el servidor no respondió: el servicio
// push contesta 410 al próximo envío y el servidor borra el endpoint solo).
export async function borrarZona() {
  try {
    await apiRequest('/alertas-zona', { method: 'DELETE' });
  } finally {
    await (await suscripcionDelDispositivo())?.unsubscribe();
  }
}
