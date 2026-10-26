// Punto de entrada solo de la app (/app/). La lógica compartida con la web la
// arranca /js/app.js (cargado antes en index.html); acá se suma lo propio de la
// app: instalación, bienvenida del QR y la pestaña "Mapa" de la barra inferior.
import { acciones } from '/js/app.js';
import { setFeedView } from '/js/feed.js';
import { navigateTo } from '/js/router.js';
import { continuarEnNavegador, iniciarPwa, installApp, toggleInstallGuide } from './pwa.js';
import { abrirAlertasZona, activarAlertasZona, cerrarAlertasZona, desactivarAlertasZona } from './zona.js';

// "Mapa" es el mismo feed mostrado como mapa (no hay una vista aparte). El panel
// queda debajo del inicio y las estadísticas: sin llevar la vista hasta él, tocar
// "Mapa" no cambiaba nada en pantalla.
export async function abrirMapa() {
  await navigateTo('home');
  const panel = document.getElementById('feedMapPanel');
  if (!panel) return;
  setFeedView('map');
  panel.scrollIntoView({ block: 'start' });
}

// Acciones de data-on-*="..." que solo existen en la app (ver eventos.js; el test
// backend/test/frontend-handlers.test.js las lee de este Object.assign).
Object.assign(acciones, { installApp, toggleInstallGuide, continuarEnNavegador, abrirMapa, abrirAlertasZona, activarAlertasZona, cerrarAlertasZona, desactivarAlertasZona });

iniciarPwa();
