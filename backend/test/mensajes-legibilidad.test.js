import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Clase 09: mensajes de error que dicen qué pasó y cómo seguir, objetivos táctiles
// de 44 px, letra mínima, contraste de --muted-2 y atajo a "Mis casos".
const publicDir = new URL('../../public/', import.meta.url);
const report = await import(new URL('js/report.js', publicDir));
const { mensajeErrorAuth, renderLegalTerms, renderRegisterForm } = await import(new URL('js/auth.js', publicDir));
const { renderFeedView } = await import(new URL('js/feed.js', publicDir));
const { renderLeadView } = await import(new URL('js/lead.js', publicDir));
const { estado } = await import(new URL('js/estado.js', publicDir));

test('Ley 6534: no bloquea por palabras sueltas (falsos positivos)', () => {
  for (const texto of [
    'Cuenta con un tatuaje de una rosa en el brazo',
    'Se la vio por última vez cerca del Banco Nacional de Fomento',
    'Llevaba una tarjeta de identificación del colegio colgada',
    'Le gusta contar cuentos; tenía una deuda pendiente con un amigo',
    'Remera del Club Cerro Porteño, campera de jean',
    'Celular 0981 123 456, cédula 4.123.456',
    'Se domicilia en Tte. Fariña 1234, 2.º piso',
    'Estatura 1,70 m; pesa 65 kg; nacida en 2008'
  ]) assert.equal(report.motivoDatoFinanciero(texto), null, texto);
});

test('Ley 6534: detecta datos bancarios, de tarjetas y de deudas', () => {
  for (const [texto, motivo] of [
    ['Usaba su tarjeta de crédito del banco', 'datos de una tarjeta'],
    ['tarjetas de débito', 'datos de una tarjeta'],
    ['Su número de cuenta es 123-456', 'un número de cuenta o de tarjeta'],
    ['nro. de tarjeta en la billetera', 'un número de cuenta o de tarjeta'],
    ['Tiene cuenta corriente en Itaú', 'datos de una cuenta bancaria'],
    ['caja de ahorro en guaraníes', 'datos de una cuenta bancaria'],
    ['CBU 0170099220000067797370', 'datos bancarios'],
    ['El pin del cajero es 1234', 'una clave bancaria'],
    ['Tenía una deuda con la financiera', 'datos de deudas o préstamos'],
    ['préstamo bancario impago', 'datos de deudas o préstamos'],
    ['4111 1111 1111 1111', 'un número de tarjeta'],
    ['tarjeta 5500-0000-0000-0004 vence', 'un número de tarjeta'],
    ['5500-0000-0000-0004', 'un número de tarjeta']
  ]) assert.equal(report.motivoDatoFinanciero(texto), motivo, texto);
  // 16 dígitos que no pasan el control de Luhn no son una tarjeta.
  assert.equal(report.motivoDatoFinanciero('4111 1111 1111 1112'), null);
});

test('Ley 6534: el error dice qué campo es, lo marca y lo enfoca', () => {
  const dom = instalarDom({ repNombre: 'Ana Prueba', repFisica: 'Alta', repVestimenta: 'Remera; tarjeta de débito en el bolsillo', repSenas: '' });
  try {
    const vestimenta = dom.obtener('repVestimenta');
    const atributos = new Map();
    let enfocado = false;
    Object.assign(vestimenta, {
      labels: [{ textContent: 'Vestimenta al Desaparecer *' }],
      setAttribute: (nombre, valor) => atributos.set(nombre, valor),
      focus: () => { enfocado = true; }
    });
    assert.equal(report.revisarDatosFinancieros(), false);
    const error = dom.obtener('reportFormError');
    assert.equal(error.textContent, 'Revisá «Vestimenta al Desaparecer»: parece incluir datos de una tarjeta. Por ley (N.º 6534/2020) el reporte no puede llevar datos bancarios, de tarjetas ni de deudas. Borralo para continuar.');
    assert.equal(error.classList.contains('hidden'), false);
    assert.equal(atributos.get('aria-invalid'), 'true');
    assert.equal(enfocado, true);

    vestimenta.value = 'Remera azul; cuenta con mochila negra';
    assert.equal(report.revisarDatosFinancieros(), true, 'sin datos financieros sigue');
  } finally {
    dom.restaurar();
  }
});

test('geolocalización: el aviso dice cómo seguir (permitir la ubicación o marcar el mapa)', () => {
  const dom = instalarDom();
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const anteriorTimeout = estado.toastTimeout;
  try {
    for (const geolocation of [{ getCurrentPosition: (_ok, error) => error({ code: 1 }) }, undefined]) {
      Object.defineProperty(globalThis, 'navigator', { value: { geolocation }, configurable: true });
      dom.obtener('toastMessage').innerText = '';
      report.useBrowserLocation('replat', 'replng', null, 'repCoordsText');
      clearTimeout(estado.toastTimeout);
      assert.equal(dom.obtener('toastTitle').innerText, 'Ubicación no disponible');
      assert.equal(dom.obtener('toastMessage').innerText, 'No pudimos obtener tu ubicación. Permití el acceso a la ubicación en el navegador o marcá el punto en el mapa.');
    }
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'navigator', anterior);
    estado.toastTimeout = anteriorTimeout;
    dom.restaurar();
  }
});

test('ingreso y recuperación: sin mensajes genéricos', () => {
  assert.equal(mensajeErrorAuth({ status: 401, message: 'Correo o contraseña incorrectos.' }), 'Correo o contraseña incorrectos.', 'el del servidor, si explica');
  assert.match(mensajeErrorAuth({ status: 503, message: 'Error del servidor (503).' }), /no está disponible.*volvé a intentar/);
  assert.match(mensajeErrorAuth({ status: 500, message: 'Ocurrió un error interno. Intente nuevamente.' }), /problema en el servidor.*Volvé a intentar en unos minutos/);
  assert.match(mensajeErrorAuth({}), /Revisá tu conexión a internet y volvé a intentar/);
  for (const mensaje of [mensajeErrorAuth({}), mensajeErrorAuth({ status: 502 }), mensajeErrorAuth({ status: 500 })]) {
    assert.notEqual(mensaje, 'No se pudo completar la solicitud.');
  }
});

// Casilla dentro de <label class="check-fila"> con su texto en .check-fila-texto.
function enFila(html, selector) {
  const inicio = html.lastIndexOf('<label', html.indexOf(selector));
  const fila = html.slice(inicio, html.indexOf('</label>', inicio));
  return /^<label class="check-fila[\s"]/.test(fila) && fila.includes('class="check-fila-texto"');
}

test('casillas: términos, registro, pista y lista de validación usan la fila .check-fila de 44 px', async () => {
  const dom = instalarDom();
  let pista;
  try {
    globalThis.window.backendCaseData.casos = [{ id: 'cas_1', nombreCompleto: 'Ana', estado: 'VALIDADO', ciudad: 'Asunción', ubicacion: { lat: -25.3, lng: -57.6 } }];
    pista = renderLeadView('cas_1');
  } finally {
    dom.restaurar();
  }
  assert.ok(enFila(renderLegalTerms(), 'id="checkTerms"'), 'bases y condiciones');
  assert.ok(enFila(renderRegisterForm(), 'id="regTerms"'), 'registro');
  assert.ok(enFila(pista, 'id="leadPublicConsent"'), 'pista');
  const shell = await readFile(new URL('Rastreopy.html', publicDir), 'utf8');
  for (const nombre of ['verificoDenuncia', 'datosCoherentes', 'duplicadosVerificados', 'menorValidado']) {
    assert.ok(enFila(shell, `name="${nombre}"`), `lista de validación: ${nombre}`);
  }
  // La casilla de privacidad del reporte sigue igual (fila suelta, id que Brave no oculta).
  assert.ok(enFila(report.renderReportView(), 'id="repAvisoPrivacidad"'));
  // "privacy-consent" es otro nombre que las listas de cookies pueden ocultar.
  assert.doesNotMatch(pista + shell, /privacy-consent/);
});

const reglaCss = (css, selector) => {
  const inicio = css.indexOf(`${selector} {`);
  assert.ok(inicio >= 0, `falta ${selector}`);
  return css.slice(inicio, css.indexOf('}', inicio));
};

function contraste(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('legibilidad y objetivos táctiles: .btn-sm de 44 px en celular, letra mínima y contraste de --muted-2', async () => {
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  assert.match(css, /@media \(max-width: 780px\), \(pointer: coarse\) \{ \.btn-sm \{ min-height: 44px; \} \}/);
  for (const valor of ['.5rem', '.56rem', '.57rem', '.58rem']) {
    assert.doesNotMatch(css, new RegExp(String.raw`font-size:\s*\${valor}\b`), `font-size ${valor}`);
  }
  assert.match(reglaCss(css, '.monthly-chart-month'), /font-size: \.75rem/);
  assert.match(reglaCss(css, '.illustrative-badge'), /font-size: \.75rem/);
  // Con .75rem los 12 meses no entran por debajo de 360 px: ahí se ve solo la inicial.
  assert.match(css, /@media \(max-width: 359px\) \{\s*\.monthly-chart-month \.mes-largo \{[^}]*clip: rect\(0 0 0 0\)[^}]*\}\s*\.monthly-chart-month \.mes-corto \{ display: inline; \}/);
  const { renderStatsView } = await import(new URL('js/stats.js', publicDir));
  const dom = instalarDom();
  try {
    assert.match(renderStatsView({}), /<span class="monthly-chart-month"><span class="mes-largo">Ene<\/span><span class="mes-corto" aria-hidden="true">E<\/span><\/span>/);
  } finally {
    dom.restaurar();
  }

  const claro = css.slice(css.indexOf(':root,'), css.indexOf('[data-theme="dark"] {'));
  const color = nombre => new RegExp(String.raw`${nombre}:\s*(#[0-9a-f]{6})`, 'i').exec(claro)[1];
  const muted2 = color('--muted-2');
  for (const fondo of ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-sunken']) {
    assert.ok(contraste(muted2, color(fondo)) >= 4.5, `--muted-2 sobre ${fondo}: ${contraste(muted2, color(fondo)).toFixed(2)}:1`);
  }
});

test('portada web: atajo a "Mis casos" en el hero, junto a Reportar (no para la administración ni en la app)', () => {
  const dom = instalarDom();
  // En el hero: "Reportar" como acción principal y "Mis casos" en los accesos de abajo.
  const atajo = /data-on-click="navigateTo\('report'\)"[^>]*>Reportar una persona desaparecida<\/button>[\s\S]*?<p class="hero-atajos">\s*<button type="button" data-on-click="navigateTo\('my-cases'\)" class="hero-atajo">Mis casos<\/button>/;
  try {
    globalThis.document.documentElement = { dataset: {} };
    for (const [usuario, ve] of [[null, true], [{ id: 1, rol: 'ciudadano' }, true], [{ id: 2, rol: 'administrador' }, false]]) {
      globalThis.window.backendCurrentUser = usuario;
      assert.equal(atajo.test(renderFeedView({})), ve, `usuario ${usuario?.rol || 'sin sesión'}`);
    }
    globalThis.window.backendCurrentUser = { id: 1, rol: 'ciudadano' };
    globalThis.document.documentElement = { dataset: { frontend: 'app' } };
    assert.doesNotMatch(renderFeedView({}), /navigateTo\('my-cases'\)/, 'la app ya lo tiene en la barra de abajo');
  } finally {
    dom.restaurar();
  }
});
