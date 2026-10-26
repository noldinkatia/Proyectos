// Mapa principal (Leaflet).
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { filterFeedCases } from './feed.js';
import { RADIO_ALERTA_KM } from './radio-alerta.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

// INICIALIZACIÓN DE LEAFLET EN EL MAPA PRINCIPAL
export function initMainLeafletMap() {
  setTimeout(() => {
    if (estado.activeMap) { estado.activeMap.remove(); estado.activeMap = null; }
    estado.activeMarkers = [];

    const mapEl = document.getElementById('mainMap');
    if (!mapEl) return;

    try {
      const map = L.map('mainMap', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([-25.2867, -57.6333], 7);
      addTextMapZoomControl(map);
      
      addBaseTiles(map, mapEl);

      const store = getStore();
      store.casos.forEach(c => {
        if (c.ubicacion && c.ubicacion.lat) {
          const marker = L.marker([c.ubicacion.lat, c.ubicacion.lng], {
            title: `Caso: ${c.nombreCompleto}`,
            icon: L.divIcon({ className: 'case-marker', html: '<span></span>', iconSize: [24, 32], iconAnchor: [12, 30] })
          }).addTo(map);

          marker.bindPopup(`
            <div>
              <strong>${escapeHtml(c.nombreCompleto)}</strong><br>
              ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''} (${Number(c.edad)} años)<br>
              Fecha: ${new Date(c.fechaHoraDesaparicion).toLocaleDateString('es-PY')}<br>
              Estado: ${escapeHtml(c.estado)}<br>
              <button aria-label="Ver ficha del caso" data-case-id="${escapeHtml(c.id)}" data-on-click="openCaseDetail(this.dataset.caseId)">Ver caso</button>
            </div>
          `);

          let geofence = null;
          estado.activeMarkers.push({ id: c.id, caseId: c.id, marker, geofence, lat: c.ubicacion.lat, lng: c.ubicacion.lng });

          // GEOCERCA: el radio de las alertas de zona (Leaflet lo pide en metros)
          if (c.estado === 'VALIDADO' || c.estado === 'EN_SEGUIMIENTO') {
            geofence = L.circle([c.ubicacion.lat, c.ubicacion.lng], {
              color: '#B3261E',
              weight: 1,
              fillColor: '#B3261E',
              fillOpacity: 0.12,
              radius: RADIO_ALERTA_KM * 1000
            }).addTo(map);
            estado.activeMarkers.at(-1).geofence = geofence;
          }
        }
      });

      store.pistas.forEach(pista => {
        if (!pista.ubicacion || !Number.isFinite(pista.ubicacion.lat) || !Number.isFinite(pista.ubicacion.lng)) return;
        const relatedCase = store.casos.find(caso => caso.id === pista.casoId);
        const clueMarker = L.marker([pista.ubicacion.lat, pista.ubicacion.lng], {
          icon: L.divIcon({ className: 'clue-marker', html: '', iconSize: [12, 12], iconAnchor: [6, 6] }),
          title: 'Pista reportada'
        }).addTo(map);
        clueMarker.bindPopup(`<div><strong>Pista reportada</strong><br>${escapeHtml(relatedCase ? relatedCase.nombreCompleto : 'Caso')}<br>${escapeHtml(pista.descripcion)}<br>${new Date(pista.fechaHoraAvistamiento || pista.fechaEnvio).toLocaleDateString('es-PY')}</div>`);
      });

      estado.activeMap = map;
      restaurarMiUbicacion(map);
      filterFeedCases();
    } catch (e) {
      mapEl.innerHTML = '<div>No se pudo cargar el mapa. Verifique su conexión.</div>';
    }
  }, 100);
}

export function centerMapOnParaguay() {
  if (estado.activeMap) estado.activeMap.setView([-25.2867, -57.6333], 7);
}

export function showMapLoadError(mapEl) {
  if (mapEl.querySelector('.map-load-error')) return;
  const notice = document.createElement('div');
  notice.className = 'map-load-error';
  notice.textContent = 'No se pudo cargar el mapa. Verifique su conexión.';
  mapEl.appendChild(notice);
}

// Mapa base de OpenStreetMap: no requiere API key (CARTO empezó a pedirla).
export function addBaseTiles(map, mapEl) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map).on('tileerror', () => showMapLoadError(mapEl));
}

export function addTextMapZoomControl(map) {
  L.control.attribution({ prefix: false }).addTo(map);
  L.control.zoom({
    zoomInText: 'Acercar',
    zoomInTitle: 'Acercar mapa',
    zoomOutText: 'Alejar',
    zoomOutTitle: 'Alejar mapa'
  }).addTo(map);
  const controls = map.getContainer().querySelectorAll('.leaflet-control-zoom a');
  controls[0]?.setAttribute('aria-label', 'Acercar mapa');
  controls[1]?.setAttribute('aria-label', 'Alejar mapa');
  map.on('popupopen', event => {
    const closeButton = event.popup.getElement()?.querySelector('.leaflet-popup-close-button');
    closeButton?.setAttribute('aria-label', 'Cerrar ventana');
  });
}

export function viewCaseOnFeed(caseId) {
  const card = document.getElementById(`case-${caseId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.focus({ preventScroll: true });
  }
}

// "Ver mi ubicación" (mapa del inicio en la web y pestaña Mapa en la app). El permiso
// se pide solo al tocar el botón, nunca al cargar. La posición queda en memoria de
// esta página: no se guarda ni se envía al servidor (las alertas de zona son aparte y
// tienen su propio consentimiento, app/zona.js).
let miUbicacion = null; // { lat, lng, precision } o null
let capaUbicacion = null;

// Título y mensaje para cada error de la geolocalización del navegador.
export function mensajeErrorUbicacion(error) {
  if (error?.code === 1) return ['Permiso denegado', 'No diste permiso para ver tu ubicación. Podés habilitarlo en la configuración del navegador y volver a intentar.'];
  if (error?.code === 3) return ['Tardó demasiado', 'No se pudo obtener tu ubicación a tiempo. Probá de nuevo, mejor al aire libre o con el GPS encendido.'];
  return ['Sin señal de ubicación', 'No se pudo obtener tu ubicación: puede que el GPS esté apagado o que no haya señal.'];
}

// Punto azul con el círculo de precisión (radio = precisión informada, en metros).
function dibujarUbicacion(map) {
  capaUbicacion?.remove();
  capaUbicacion = null;
  if (!miUbicacion || !map) return;
  const centro = [miUbicacion.lat, miUbicacion.lng];
  capaUbicacion = L.layerGroup([
    L.circle(centro, { radius: Math.max(miUbicacion.precision, 10), color: '#2563eb', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.15, interactive: false }),
    L.circleMarker(centro, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Tu ubicación aproximada')
  ]).addTo(map);
}

function actualizarBotonUbicacion({ buscando = false } = {}) {
  const boton = document.getElementById('miUbicacionBoton');
  if (!boton) return;
  boton.disabled = buscando;
  boton.textContent = buscando ? 'Buscando tu ubicación…' : miUbicacion ? 'Quitar mi ubicación' : 'Ver mi ubicación';
  boton.setAttribute('aria-pressed', String(Boolean(miUbicacion)));
}

// Al volver a crear el mapa (cambio de vista o actualización de datos) se redibuja.
export function restaurarMiUbicacion(map) {
  dibujarUbicacion(map);
  actualizarBotonUbicacion();
}

export function useMyLocationOnMap() {
  if (miUbicacion) {
    miUbicacion = null;
    dibujarUbicacion(null);
    actualizarBotonUbicacion();
    return;
  }
  if (!navigator.geolocation) {
    showToast('Ubicación no disponible', 'Este navegador no permite ver tu ubicación.', 'error');
    return;
  }
  actualizarBotonUbicacion({ buscando: true });
  navigator.geolocation.getCurrentPosition(position => {
    miUbicacion = { lat: position.coords.latitude, lng: position.coords.longitude, precision: position.coords.accuracy || 0 };
    dibujarUbicacion(estado.activeMap);
    estado.activeMap?.setView([miUbicacion.lat, miUbicacion.lng], 14);
    actualizarBotonUbicacion();
  }, error => {
    const [titulo, mensaje] = mensajeErrorUbicacion(error);
    showToast(titulo, mensaje, 'error');
    actualizarBotonUbicacion();
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

export function focusCaseOnMap(caseId) {
  const found = estado.activeMarkers.find(m => m.id === caseId);
  if (found && estado.activeMap) {
    estado.activeMap.setView([found.lat, found.lng], 13);
    found.marker.openPopup();
  }
}
