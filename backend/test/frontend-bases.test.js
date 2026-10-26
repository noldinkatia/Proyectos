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
