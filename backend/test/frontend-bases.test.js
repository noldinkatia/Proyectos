import assert from 'node:assert/strict';
import test from 'node:test';

// Bases y condiciones (public/js/auth.js): un solo texto para la pantalla obligatoria,
// el modal del registro y la página de consulta #/bases.
const publicDir = new URL('../../public/', import.meta.url);
const { BASES_TEXTO, abrirBasesModal, cerrarBasesModal, renderAuthScreen, renderLegalTerms } = await import(new URL('js/auth.js', publicDir));

// <dialog> mínimo: showModal/close y el evento "close" como en el navegador.
function conDocumento(fn) {
  const nodos = {};
  let foco = null;
  const enlace = { id: 'regTermsLink', focus: () => { foco = 'regTermsLink'; } };
  nodos.regTermsLink = enlace;
  const body = {
    html: '',
    insertAdjacentHTML(posicion, html) {
      assert.equal(posicion, 'beforeend');
      this.html += html;
      const oyentes = [];
      nodos.basesModal = {
        open: false,
        addEventListener: (tipo, oyente) => { if (tipo === 'close') oyentes.push(oyente); },
        showModal() { this.open = true; foco = 'Cerrar'; },
        close() { if (!this.open) return; this.open = false; oyentes.forEach(o => o()); }
      };
    }
  };
  const anterior = globalThis.document;
  globalThis.document = { body, getElementById: id => nodos[id] || null };
  try {
    fn({ body, nodos, foco: () => foco });
  } finally {
    globalThis.document = anterior;
  }
}

test('registro: la casilla de las bases lleva un enlace que abre el modal sin tildarla', () => {
  const anterior = globalThis.window;
  globalThis.window = {};
  let html;
  try {
    html = renderAuthScreen('register');
  } finally {
    globalThis.window = anterior;
  }
  const etiqueta = html.match(/<label>\s*<input type="checkbox" id="regTerms" required>[\s\S]*?<\/label>/)?.[0];
  assert.ok(etiqueta, 'la casilla sigue siendo obligatoria');
  // Un botón dentro de la etiqueta: el navegador no activa la casilla al tocarlo.
  assert.match(etiqueta, /<button type="button" id="regTermsLink" class="link-inline" aria-haspopup="dialog" data-on-click="abrirBasesModal\(\)">bases y condiciones<\/button>/);
});

test('modal de las bases: texto completo, se cierra con el botón o Esc y el foco vuelve al enlace', () => {
  conDocumento(({ body, nodos, foco }) => {
    abrirBasesModal();
    assert.match(body.html, /<dialog id="basesModal" class="bases-modal" aria-labelledby="basesModalTitulo">/);
    assert.match(body.html, /data-on-click="cerrarBasesModal\(\)">Cerrar<\/button>/);
    assert.ok(body.html.includes(BASES_TEXTO), 'el mismo texto que la pantalla obligatoria');
    assert.equal(nodos.basesModal.open, true);
    assert.equal(foco(), 'Cerrar');

    cerrarBasesModal();
    assert.equal(nodos.basesModal.open, false);
    assert.equal(foco(), 'regTermsLink');

    // Esc en un <dialog> dispara el mismo "close"; abrir de nuevo no duplica el modal.
    const largo = body.html.length;
    abrirBasesModal();
    assert.equal(body.html.length, largo);
    nodos.basesModal.close();
    assert.equal(foco(), 'regTermsLink');
  });
});

test('las seis cláusulas están en un solo texto, compartido con la pantalla obligatoria', () => {
  assert.equal((BASES_TEXTO.match(/<p><strong>\d\./g) || []).length, 6);
  assert.ok(renderLegalTerms().includes(BASES_TEXTO));
});

const { PUBLIC_VIEWS, buildRoute, parseRoute } = await import(new URL('js/router.js', publicDir));
const { renderBasesView } = await import(new URL('js/auth.js', publicDir));

function conUsuario(usuario, fn) {
  const anteriores = { window: globalThis.window, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.window = { backendCurrentUser: usuario };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.sessionStorage = globalThis.localStorage;
  try {
    return fn();
  } finally {
    globalThis.window = anteriores.window;
    globalThis.localStorage = anteriores.localStorage;
    globalThis.sessionStorage = anteriores.sessionStorage;
  }
}

test('#/bases: ruta propia y pública (se ve sin sesión)', () => {
  assert.deepEqual(parseRoute('#/bases'), { view: 'legal', params: {} });
  assert.equal(buildRoute('legal'), '#/bases');
  assert.ok(PUBLIC_VIEWS.includes('legal'), 'sin sesión no lleva al login');
});

test('#/bases: página de solo lectura, sin casilla ni botones de aceptar', () => {
  for (const usuario of [null, { rol: 'administrador', acepto_terminos: false }]) {
    const html = conUsuario(usuario, renderBasesView);
    assert.ok(html.includes(BASES_TEXTO));
    assert.match(html, /<h1>Bases y condiciones de uso<\/h1>/);
    assert.doesNotMatch(html, /checkTerms|acceptTerms|rejectTerms|Aceptaste/);
  }
  const ciudadano = conUsuario({ rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: '2026-10-18T12:00:00Z' }, renderBasesView);
  assert.match(ciudadano, /Aceptaste estas bases el 18 de octubre de 2026\./);
});

test('router: #/bases ya no redirige al inicio y la pantalla obligatoria depende de debeAceptarBases', async () => {
  const { readFile } = await import('node:fs/promises');
  const router = await readFile(new URL('js/router.js', publicDir), 'utf8');
  assert.doesNotMatch(router, /route\.view === 'legal'[^\n]*\n\s*route = \{ view: 'feed'/, 'antes #/bases mandaba al inicio');
  // La obligatoria se decide antes de dibujar cualquier vista; si no corresponde, 'legal' es la consulta.
  const obligatoria = router.indexOf('if (debeAceptarBases(store.currentUser)) {');
  // \s+ y no "\n": en Windows (core.autocrlf) el archivo tiene CRLF en disco.
  const consulta = router.search(/case 'legal':\s+main\.innerHTML = renderBasesView\(\);/);
  assert.ok(obligatoria > 0 && consulta > obligatoria);
  assert.doesNotMatch(router, /!store\.currentUser\.acepto_terminos/, 'nada mira acepto_terminos sin el rol');
});
