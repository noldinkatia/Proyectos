import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Mapa del inicio (public/js/feed.js): en la web se abre con "Mostrar mapa" junto a la
// lista; en la app, la pestaña "Mapa" (app/app-movil.js) muestra solo el mapa. El
// panel está debajo del inicio y las estadísticas, así que la app lleva la vista hasta él.
const publicDir = new URL('../../public/', import.meta.url);
const { setFeedView, toggleFeedMap } = await import(new URL('js/feed.js', publicDir));

function elemento() {
  const clases = new Set();
  const atributos = new Map();
  return {
    innerHTML: '',
    classList: {
      add: c => clases.add(c),
      remove: c => clases.delete(c),
      contains: c => clases.has(c),
      toggle: (c, forzar) => {
        const poner = forzar === undefined ? !clases.has(c) : forzar;
        if (poner) clases.add(c); else clases.delete(c);
        return poner;
      }
    },
    setAttribute: (n, v) => atributos.set(n, String(v)),
    getAttribute: n => atributos.get(n) ?? null
  };
}

function conInicio(fn) {
  const nodos = { feedMapPanel: elemento(), feedCaseList: elemento(), feedMapToggle: elemento() };
  nodos.feedMapPanel.classList.add('hidden');
  const anterior = globalThis.document;
  globalThis.document = { getElementById: id => nodos[id] || null };
  try {
    fn(nodos);
  } finally {
    globalThis.document = anterior;
  }
}

test('pestaña "Mapa": solo el mapa, y el botón dice "Ocultar mapa"', () => {
  conInicio(({ feedMapPanel, feedCaseList, feedMapToggle }) => {
    setFeedView('map');
    assert.equal(feedMapPanel.classList.contains('hidden'), false);
    assert.equal(feedCaseList.classList.contains('hidden'), true);
    assert.equal(feedMapToggle.getAttribute('aria-expanded'), 'true');
    assert.match(feedMapToggle.innerHTML, /Ocultar mapa/);
  });
});

test('"Ocultar mapa" desde la vista "Mapa" vuelve a la lista (la página no queda vacía)', () => {
  conInicio(({ feedMapPanel, feedCaseList, feedMapToggle }) => {
    setFeedView('map');
    toggleFeedMap();
    assert.equal(feedMapPanel.classList.contains('hidden'), true);
    assert.equal(feedCaseList.classList.contains('hidden'), false);
    assert.equal(feedMapToggle.getAttribute('aria-expanded'), 'false');
    assert.match(feedMapToggle.innerHTML, /Mostrar mapa/);
  });
});

test('web: "Mostrar mapa" abre el mapa junto a la lista y lo vuelve a cerrar', () => {
  conInicio(({ feedMapPanel, feedCaseList, feedMapToggle }) => {
    toggleFeedMap();
    assert.equal(feedMapPanel.classList.contains('hidden'), false);
    assert.equal(feedCaseList.classList.contains('hidden'), false, 'la lista sigue a la vista');
    assert.equal(feedMapToggle.getAttribute('aria-expanded'), 'true');
    toggleFeedMap();
    assert.equal(feedMapPanel.classList.contains('hidden'), true);
    assert.equal(feedMapToggle.getAttribute('aria-expanded'), 'false');
  });
});

test('radio de alerta: una sola constante para el servidor, el círculo, la leyenda y los textos', async () => {
  const { RADIO_ALERTA_KM } = await import(new URL('js/radio-alerta.js', publicDir));
  const geocerca = await import('../geocerca.js');
  assert.equal(RADIO_ALERTA_KM, 160);
  assert.equal(geocerca.RADIO_ALERTA_KM, RADIO_ALERTA_KM, 'backend/geocerca.js usa la misma');
  const fuente = async archivo => readFile(new URL(archivo, publicDir), 'utf8');
  assert.match(await fuente('js/map.js'), /radius: RADIO_ALERTA_KM \* 1000/);
  assert.match(await fuente('js/feed.js'), /Círculo: zona de alerta de \$\{RADIO_ALERTA_KM\} km\./);
  // Ningún texto ni radio escrito a mano (la leyenda decía 60 km).
  for (const archivo of ['js/map.js', 'js/feed.js', 'js/report.js', 'app/zona.js']) {
    const codigo = await fuente(archivo);
    assert.match(codigo, /import \{ RADIO_ALERTA_KM \} from '(\.|\/js)\/radio-alerta\.js';/, archivo);
    assert.doesNotMatch(codigo, /\b1?60\s*km\b|160000|160_000/i, archivo);
  }
});

test('app: la pestaña "Mapa" lleva la vista hasta el panel, sin quedar bajo el encabezado', async () => {
  const app = await readFile(new URL('app/app-movil.js', publicDir), 'utf8');
  assert.match(app, /setFeedView\('map'\);\s*panel\.scrollIntoView\(\{ block: 'start' \}\);/);
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  assert.match(css, /\.home-map-card \{[^}]*scroll-margin-top:\s*calc\(var\(--header-h\)/);
});

test('mapa oscuro: filtro solo sobre las teselas y solo con el tema oscuro', async () => {
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  assert.match(css, /\[data-theme="dark"\] \.leaflet-tile-pane \{ filter: invert\(1\) hue-rotate\(180deg\) brightness\(\.95\) contrast\(\.9\) saturate\(\.7\); \}/);
  // Pines, círculos, popups y controles quedan sin filtro (otras capas de Leaflet).
  for (const capa of ['leaflet-marker-pane', 'leaflet-overlay-pane', 'leaflet-popup-pane', 'leaflet-control']) {
    assert.doesNotMatch(css, new RegExp(`\.${capa}[^{]*\{[^}]*filter:`), capa);
  }
  // Sin otro proveedor de teselas ni cambios en la CSP.
  const mapa = await readFile(new URL('js/map.js', publicDir), 'utf8');
  assert.match(mapa, /L\.tileLayer\('https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/);
});

// "Ver mi ubicación" (map.js) con Leaflet, geolocalización, DOM y fetch simulados.
test('"Ver mi ubicación": pide permiso solo al tocar, dibuja punto y precisión, centra y se puede quitar', async () => {
  const { useMyLocationOnMap, mensajeErrorUbicacion } = await import(new URL('js/map.js', publicDir));
  const { estado } = await import(new URL('js/estado.js', publicDir));
  const anteriores = { L: globalThis.L, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), document: globalThis.document, fetch: globalThis.fetch };
  const dibujado = [];
  const vistas = [];
  let pedidosGeo = 0;
  let responder;
  const capa = tipo => ({ tipo, bindTooltip() { return this; } });
  globalThis.L = {
    circle: (centro, op) => ({ ...capa('circulo'), centro, radio: op.radius }),
    circleMarker: (centro, op) => ({ ...capa('punto'), centro, color: op.fillColor }),
    layerGroup: capas => ({ capas, addTo() { dibujado.push(this); return this; }, remove() { dibujado.splice(dibujado.indexOf(this), 1); } })
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    getCurrentPosition(ok, error, opciones) { pedidosGeo += 1; responder = { ok, error, opciones }; }
  } } });
  const boton = { disabled: false, textContent: 'Ver mi ubicación', atributos: {}, setAttribute(n, v) { this.atributos[n] = v; } };
  const toast = { titulo: { innerText: '' }, mensaje: { innerText: '' } };
  globalThis.document = { getElementById: id => ({ miUbicacionBoton: boton, toastTitle: toast.titulo, toastMessage: toast.mensaje, toastNotification: { dataset: {}, classList: { add() {}, remove() {} } } })[id] || null };
  globalThis.fetch = () => { throw new Error('la ubicación no debe enviarse al servidor'); };
  estado.activeMap = { setView: (centro, zoom) => vistas.push([centro, zoom]) };
  try {
    assert.equal(pedidosGeo, 0, 'nada al cargar');
    useMyLocationOnMap();
    assert.equal(pedidosGeo, 1);
    assert.equal(boton.textContent, 'Buscando tu ubicación…');
    assert.equal(boton.disabled, true);
    assert.equal(responder.opciones.enableHighAccuracy, true);
    responder.ok({ coords: { latitude: -25.3, longitude: -57.6, accuracy: 35 } });
    assert.equal(dibujado.length, 1);
    assert.deepEqual(dibujado[0].capas.map(c => [c.tipo, c.centro]), [['circulo', [-25.3, -57.6]], ['punto', [-25.3, -57.6]]]);
    assert.equal(dibujado[0].capas[0].radio, 35, 'círculo de precisión');
    assert.equal(dibujado[0].capas[1].color, '#2563eb', 'punto azul');
    assert.deepEqual(vistas.at(-1), [[-25.3, -57.6], 14], 'centra el mapa');
    assert.equal(boton.textContent, 'Quitar mi ubicación');
    assert.equal(boton.atributos['aria-pressed'], 'true');
    // Tocar de nuevo la quita, sin volver a pedir la posición.
    useMyLocationOnMap();
    assert.equal(dibujado.length, 0);
    assert.equal(pedidosGeo, 1);
    assert.equal(boton.textContent, 'Ver mi ubicación');
    assert.equal(boton.atributos['aria-pressed'], 'false');
    // Permiso negado: mensaje claro y el botón vuelve a estar disponible.
    useMyLocationOnMap();
    responder.error({ code: 1 });
    assert.equal(toast.titulo.innerText, 'Permiso denegado');
    assert.equal(boton.disabled, false);
    assert.equal(dibujado.length, 0);
  } finally {
    globalThis.L = anteriores.L;
    if (anteriores.navigator) Object.defineProperty(globalThis, 'navigator', anteriores.navigator);
    globalThis.document = anteriores.document;
    globalThis.fetch = anteriores.fetch;
    estado.activeMap = null;
    clearTimeout(estado.toastTimeout);
  }
  assert.equal(mensajeErrorUbicacion({ code: 1 })[0], 'Permiso denegado');
  assert.equal(mensajeErrorUbicacion({ code: 2 })[0], 'Sin señal de ubicación');
  assert.equal(mensajeErrorUbicacion({ code: 3 })[0], 'Tardó demasiado');
});

test('"Ver mi ubicación": nunca al cargar y sin enviar nada al servidor', async () => {
  const mapa = (await readFile(new URL('js/map.js', publicDir), 'utf8')).replace(/\r\n/g, '\n');
  const inicio = mapa.indexOf('let miUbicacion');
  const bloque = mapa.slice(inicio, mapa.indexOf('export function focusCaseOnMap', inicio));
  assert.doesNotMatch(bloque, /apiRequest|fetch\(|sessionStorage|localStorage/, 'solo en memoria');
  // getCurrentPosition aparece una sola vez en map.js: dentro de useMyLocationOnMap.
  assert.equal((mapa.match(/getCurrentPosition/g) || []).length, 1);
  const funcion = mapa.slice(mapa.indexOf('export function useMyLocationOnMap'), mapa.indexOf('\n}\n', mapa.indexOf('export function useMyLocationOnMap')));
  assert.match(funcion, /getCurrentPosition/);
  const feed = await readFile(new URL('js/feed.js', publicDir), 'utf8');
  assert.match(feed, /<button type="button" id="miUbicacionBoton" aria-pressed="false" data-on-click="useMyLocationOnMap\(\)" class="btn btn-outline btn-sm">Ver mi ubicación<\/button>/);
});
