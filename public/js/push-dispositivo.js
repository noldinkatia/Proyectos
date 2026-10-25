// Suscripción Web Push de este dispositivo. Al cerrar sesión se da de baja (en el
// servidor y en el navegador) para que en un celular compartido no sigan llegando
// avisos de la cuenta anterior. Las alertas de zona de la cuenta no se tocan: en
// otros dispositivos siguen llegando y, si vuelve a entrar acá, puede reactivarlas.
import { apiRequest } from './api.js';

export async function darDeBajaEsteDispositivo() {
  if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return;
  try {
    const registro = await navigator.serviceWorker.getRegistration();
    const suscripcion = await registro?.pushManager?.getSubscription();
    if (!suscripcion) return;
    // Sin red igual se desuscribe en el navegador: el servicio push responde 410
    // al próximo envío y el servidor borra el endpoint solo.
    await apiRequest('/push/suscripcion', {
      method: 'DELETE',
      body: { endpoint: suscripcion.endpoint },
      signal: AbortSignal.timeout?.(5000)
    }).catch(error => console.error('No se pudo dar de baja el dispositivo en el servidor:', error.message));
    await suscripcion.unsubscribe();
  } catch (error) {
    console.error('No se pudo dar de baja las notificaciones de este dispositivo:', error.message);
  }
}
