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

test('app: la pestaña "Mapa" lleva la vista hasta el panel, sin quedar bajo el encabezado', async () => {
  const app = await readFile(new URL('app/app-movil.js', publicDir), 'utf8');
  assert.match(app, /setFeedView\('map'\);\s*panel\.scrollIntoView\(\{ block: 'start' \}\);/);
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  assert.match(css, /\.home-map-card \{[^}]*scroll-margin-top:\s*calc\(var\(--header-h\)/);
});
