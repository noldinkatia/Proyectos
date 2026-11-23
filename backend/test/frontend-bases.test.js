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
  // Fila .check-fila (44 px, toda la fila se toca), como las casillas del reporte.
  const etiqueta = html.match(/<label class="check-fila">\s*<input type="checkbox" id="regTerms" required>[\s\S]*?<\/label>/)?.[0];
  assert.ok(etiqueta, 'la casilla sigue siendo obligatoria');
  // Un botón dentro de la etiqueta: el navegador no activa la casilla al tocarlo.
  assert.match(etiqueta, /<button type="button" id="regTermsLink" class="link-inline" aria-haspopup="dialog" data-on-click="abrirBasesModal\(\)">bases y condiciones<\/button>/);
});

test('modal de las bases: texto completo, se cierra con el botón o Esc y el foco vuelve al enlace', () => {
  conDocumento(({ body, nodos, foco }) => {
    abrirBasesModal();
    assert.match(body.html, /<dialog id="basesModal" class="bases-modal" aria-labelledby="basesModalTitulo">/);
    // La X de cierre: botón real con nombre accesible "Cerrar".
    assert.match(body.html, /<button type="button" class="btn-close" data-on-click="cerrarBasesModal\(\)" aria-label="Cerrar" title="Cerrar"><svg class="icon-close"/);
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

test('las doce cláusulas, numeradas del 1 al 12 sin saltos, en un solo texto compartido con la pantalla obligatoria', () => {
  const numeros = [...BASES_TEXTO.matchAll(/<p><strong>(\d+)\. /g)].map(([, n]) => Number(n));
  assert.deepEqual(numeros, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(renderLegalTerms().includes(BASES_TEXTO));
});

// El texto de una cláusula (sin etiquetas), por número.
const clausula = n => BASES_TEXTO.match(new RegExp(`<p><strong>${n}\\. ([^<]+):</strong> ([^<]+)</p>`))?.slice(1);

test('punto 12: denuncia ante la Policía Nacional y no hace falta cargar el número', () => {
  const [titulo, texto] = clausula(12);
  assert.equal(titulo, 'Denuncia ante la Policía Nacional');
  assert.match(texto, /de manera presencial o por llamada telefónica/);
  assert.match(texto, /No necesita cargar el número de denuncia: la administración lo registra al verificarla con los datos brindados\./);
  assert.match(texto, /mientras no se haya hecho la denuncia, el reporte queda 'En revisión'/);
  assert.match(texto, /la alerta temprana a la zona se envía igual, como no verificada/);
});

test('puntos 2, 3, 10 y 11: ajustes acordados', () => {
  // 2: ya no exige la denuncia antes de cargar el reporte (contradecía al 12).
  assert.doesNotMatch(clausula(2)[1], /previa a la carga/);
  assert.match(clausula(2)[1], /de manera prioritaria \(ver punto 12\)\./);
  assert.match(clausula(3)[1], /en la medida permitida por la legislación vigente/);
  // 10: sin plazos inventados; los fija la autoridad administradora.
  assert.match(clausula(10)[1], /durante los plazos que establezca la autoridad administradora conforme a la legislación vigente/);
  assert.doesNotMatch(clausula(10)[1], /\d+ (días|meses|años)/);
  // 11: solo medidas que existen en la plataforma (no hay suspensión de cuentas).
  assert.match(clausula(11)[1], /rechazar reportes y pistas, devolverlos a revisión, cerrar casos y registrar antecedentes/);
  assert.doesNotMatch(clausula(11)[1], /suspend|restring/i);
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
  // Aceptó la versión vigente: se muestra la fecha.
  const vigente = conUsuario({ rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: '2026-11-23T15:00:00Z' }, renderBasesView);
  assert.match(vigente, /Aceptaste estas bases el 23 de noviembre de 2026\./);
  // Aceptó una versión anterior o no hay fecha: no dice que aceptó este texto.
  for (const fecha of ['2026-10-18T12:00:00Z', null]) {
    const html = conUsuario({ rol: 'ciudadano', acepto_terminos: true, fecha_aceptacion_terminos: fecha }, renderBasesView);
    assert.doesNotMatch(html, /Aceptaste/, String(fecha));
  }
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
