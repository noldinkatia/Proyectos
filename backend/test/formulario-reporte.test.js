import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// El formulario de reporte lo dibuja js/report.js (renderReportView) dentro de
// #mainContent, en la web (Rastreopy.html) y en la app (app/index.html). Un campo con
// required (o pattern, min, max...) dentro de un bloque oculto no se puede enfocar:
// el navegador frena el envío sin mostrar nada ("An invalid form control ... is not
// focusable"). Estos tests recorren el HTML del formulario y la validación propia.
const publicDir = new URL('../../public/', import.meta.url);
const PAGINAS = ['Rastreopy.html', 'app/index.html'];
const VACIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RESTRICCIONES = ['required', 'pattern', 'min', 'max', 'minlength', 'maxlength'];

function atributos(texto) {
  const lista = {};
  for (const [, nombre, , dobles, simples, sueltas] of texto.matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    lista[nombre.toLowerCase()] = dobles ?? simples ?? sueltas ?? '';
  }
  return lista;
}

// Árbol mínimo: alcanza para saber dentro de qué elementos está cada campo.
function elementos(html) {
  const lista = [];
  const pila = [];
  const limpio = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const [, cierre, etiqueta, resto] of limpio.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const nombre = etiqueta.toLowerCase();
    if (cierre) {
      const indice = pila.map(el => el.etiqueta).lastIndexOf(nombre);
      if (indice >= 0) pila.length = indice;
      continue;
    }
    const elemento = { etiqueta: nombre, atributos: atributos(resto), ancestros: [...pila] };
    lista.push(elemento);
    if (!VACIOS.has(nombre) && !resto.trim().endsWith('/')) pila.push(elemento);
  }
  return lista;
}

const oculto = el => 'hidden' in el.atributos
  || /(^|\s)hidden(\s|$)/.test(el.atributos.class || '')
  || /display\s*:\s*none/.test(el.atributos.style || '');

async function formularioReporte() {
  const { renderReportView } = await import(new URL('js/report.js', publicDir));
  return elementos(renderReportView());
}

test('formulario de reporte: ningún campo obligatorio queda oculto y todos tienen etiqueta', async () => {
  const todos = await formularioReporte();
  const formulario = todos.find(el => el.etiqueta === 'form');
  assert.ok('novalidate' in formulario.atributos, 'la validación es propia (validarFormularioReporte), no la del navegador');
  assert.ok(todos.some(el => el.atributos.id === 'reportFormError' && el.atributos.role === 'alert'), 'falta el mensaje de error visible');

  const campos = todos.filter(el => ['input', 'select', 'textarea'].includes(el.etiqueta));
  const conRestriccion = campos.filter(el => RESTRICCIONES.some(nombre => nombre in el.atributos));
  assert.ok(conRestriccion.length >= 8, `se esperaban los campos obligatorios del reporte, hay ${conRestriccion.length}`);
  const etiquetados = new Set(todos.filter(el => el.etiqueta === 'label' && el.atributos.for).map(el => el.atributos.for));

  const problemas = [];
  for (const campo of conRestriccion) {
    const nombre = campo.atributos.id || campo.atributos.name || `<${campo.etiqueta}>`;
    if (campo.atributos.type === 'hidden') problemas.push(`${nombre}: input hidden con restricciones`);
    const bloque = [campo, ...campo.ancestros].find(oculto);
    if (bloque) problemas.push(`${nombre}: dentro de un bloque oculto (${bloque.atributos.id || bloque.etiqueta})`);
    const conEtiqueta = etiquetados.has(campo.atributos.id) || campo.atributos['data-etiqueta']
      || campo.ancestros.some(el => el.etiqueta === 'label');
    if (!conEtiqueta) problemas.push(`${nombre}: sin etiqueta para el mensaje de error`);
  }
  assert.deepEqual(problemas, []);

  // La vista previa de la alerta temprana empieza oculta: no puede tener campos obligatorios.
  const vistaPrevia = campos.filter(el => el.ancestros.some(a => a.atributos.id === 'alertPreviewSection'));
  assert.ok(vistaPrevia.length >= 10);
  assert.deepEqual(vistaPrevia.filter(el => RESTRICCIONES.some(nombre => nombre in el.atributos)), []);
});

test('web y app: el formulario se dibuja en un #mainContent visible', async () => {
  for (const pagina of PAGINAS) {
    const html = await readFile(new URL(pagina, publicDir), 'utf8');
    const principal = elementos(html).find(el => el.atributos.id === 'mainContent');
    assert.ok(principal, `${pagina}: falta #mainContent`);
    assert.deepEqual([principal, ...principal.ancestros].filter(oculto).map(el => el.atributos.id || el.etiqueta), [], `${pagina}: #mainContent oculto`);
    assert.equal(principal.ancestros.some(el => el.etiqueta === 'form'), false, `${pagina}: #mainContent dentro de otro <form>`);
  }
  // Las dos páginas cargan js/app.js, que registra handleReportSubmit.
  const appJs = await readFile(new URL('js/app.js', publicDir), 'utf8');
  assert.match(appJs, /handleReportSubmit,/);
  assert.match(appJs, /desmarcarCampoReporte,/);
});

// Campo simulado: lo justo que usa revisarCamposReporte / validarFormularioReporte.
function campo(id, { valido = true, visible = true, etiqueta = id } = {}) {
  const atributos = new Map();
  return {
    id, enfocado: false, willValidate: true, validationMessage: valido ? '' : 'Completá este campo.',
    labels: [{ textContent: `${etiqueta} *` }], dataset: {},
    checkValidity: () => valido,
    getClientRects: () => (visible ? [{}] : []),
    focus() { this.enfocado = true; },
    scrollIntoView() {},
    setAttribute: (nombre, valor) => atributos.set(nombre, valor),
    removeAttribute: nombre => atributos.delete(nombre),
    getAttribute: nombre => atributos.get(nombre) ?? null,
    marcado: () => atributos.get('aria-invalid') === 'true'
  };
}

function formulario(campos) {
  return { elements: campos, querySelectorAll: () => campos.filter(item => item.marcado()) };
}

async function conDocumento(prueba) {
  const error = { textContent: '', clases: new Set(['hidden']), classList: null };
  error.classList = { toggle: (clase, activa) => (activa ? error.clases.add(clase) : error.clases.delete(clase)) };
  const anterior = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'reportFormError' ? error : null),
    createElement: () => ({ className: '', textContent: '', remove() { this.quitado = true; } })
  };
  const errores = [];
  const consola = console.error;
  console.error = (...args) => errores.push(args.join(' '));
  try {
    await prueba(error, errores);
  } finally {
    globalThis.document = anterior;
    console.error = consola;
  }
}

test('validación del reporte: mensaje visible, foco en el primer campo que se ve, y un oculto no bloquea en silencio', async () => {
  const { validarFormularioReporte } = await import(new URL('js/report.js', publicDir));
  await conDocumento(async (error, errores) => {
    const nombre = campo('repNombre', { etiqueta: 'Nombre Completo' });
    const fecha = campo('repFechaHora', { valido: false, etiqueta: 'Fecha y hora de la desaparición' });
    const oculto = campo('campoOculto', { valido: false, visible: false, etiqueta: 'Campo oculto' });
    const fisica = campo('repFisica', { valido: false, etiqueta: 'Descripción Física' });
    assert.equal(validarFormularioReporte(formulario([nombre, oculto, fecha, fisica])), false);
    assert.equal(fecha.enfocado, true, 'se enfoca el primer campo inválido visible');
    assert.equal(oculto.enfocado, false);
    assert.equal(error.clases.has('hidden'), false, 'el mensaje se ve');
    assert.equal(error.textContent, 'Falta completar: Campo oculto, Fecha y hora de la desaparición, Descripción Física. (Completá este campo.)');
    assert.ok(fecha.marcado() && fisica.marcado() && !nombre.marcado());
    assert.match(errores.join('\n'), /campoOculto/, 'el campo oculto queda registrado para corregirlo');

    // Solo un campo oculto: igual avisa (no queda "sin pasar nada").
    assert.equal(validarFormularioReporte(formulario([nombre, oculto])), false);
    assert.equal(error.textContent, 'Falta completar: Campo oculto.');

    // Todo completo: se borra el mensaje y se sigue.
    assert.equal(validarFormularioReporte(formulario([nombre, campo('repFisica')])), true);
    assert.equal(error.clases.has('hidden'), true);
  });
});

// Bloque de reglas de styles.css para un selector exacto.
function reglaCss(css, selector) {
  const inicio = css.indexOf(`${selector} {`);
  assert.ok(inicio >= 0, `falta la regla ${selector} en styles.css`);
  return css.slice(inicio, css.indexOf('}', inicio));
}
const px = (regla, propiedad) => Number(new RegExp(String.raw`(?:^|[\s;{])${propiedad}\s*:\s*(\d+(?:\.\d+)?)px`).exec(regla)?.[1] || 0);

test('casillas del reporte: dibujo propio con tamaño visible, fila tocable y foco con teclado', async () => {
  const todos = await formularioReporte();
  const casillas = todos.filter(el => el.etiqueta === 'input' && el.atributos.type === 'checkbox');
  const ids = ['reporterAdult', 'minorAuthorization', 'privacyConsent'];
  for (const id of ids) assert.ok(casillas.some(el => el.atributos.id === id), `falta la casilla ${id}`);
  // Toda casilla obligatoria (y las tres de consentimiento) va dentro de una fila .check-fila.
  const sinFila = casillas
    .filter(el => 'required' in el.atributos || ids.includes(el.atributos.id))
    .filter(el => !el.ancestros.some(a => a.etiqueta === 'label' && /(^|\s)check-fila(\s|$)/.test(a.atributos.class || '')))
    .map(el => el.atributos.id || el.atributos.name);
  assert.deepEqual(sinFila, [], 'casillas sin fila .check-fila');
  const textos = todos.filter(el => /(^|\s)check-fila-texto(\s|$)/.test(el.atributos.class || ''));
  assert.ok(textos.length >= ids.length, 'cada fila lleva su texto en .check-fila-texto');

  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  const caja = reglaCss(css, '.check-fila input[type="checkbox"]');
  assert.match(caja, /(?:^|[\s;{])appearance:\s*none/, 'no usa el dibujo nativo');
  assert.ok(px(caja, 'width') >= 22 && px(caja, 'height') >= 22, 'la caja mide al menos 22 px');
  assert.match(caja, /border:\s*2px solid var\(--check-border\)/, 'borde visible');
  assert.doesNotMatch(caja, /display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/);
  assert.ok(px(reglaCss(css, '.check-fila'), 'min-height') >= 44, 'zona táctil de 44 px');
  assert.match(reglaCss(css, '.check-fila input[type="checkbox"]:checked'), /background-image:\s*url\("data:image\/svg\+xml/, 'tilde al marcar');
  assert.match(reglaCss(css, '[data-theme="dark"] .check-fila input[type="checkbox"]:checked'), /background-image/, 'tilde en tema oscuro');
  assert.match(reglaCss(css, '.check-fila input[type="checkbox"]:focus-visible'), /outline:\s*3px solid/, 'foco visible con teclado');
  assert.match(reglaCss(css, '.check-fila.check-fila-error, .check-fila.check-fila-error:has(input:focus-visible)'), /border:\s*2px solid var\(--red\)/);
  // El color del borde existe en los dos temas.
  for (const tema of ['[data-theme="light"]', '[data-theme="dark"]']) {
    assert.match(reglaCss(css, tema), /--check-border:\s*#[0-9a-f]{6}/i, `--check-border en ${tema}`);
  }
});

test('casilla obligatoria sin marcar: fila en rojo, aviso "Marcá esta casilla para continuar" y vista hasta la fila', async () => {
  const { validarFormularioReporte } = await import(new URL('js/report.js', publicDir));
  await conDocumento(async error => {
    const clases = new Set();
    const agregados = [];
    let vistaEnFila = false;
    const texto = { append: nodo => agregados.push(nodo) };
    const fila = {
      classList: { toggle: (clase, activa) => (activa ? clases.add(clase) : clases.delete(clase)) },
      querySelector: selector => (selector === '.check-fila-texto' ? texto : agregados.find(nodo => !nodo.quitado) || null),
      scrollIntoView: () => { vistaEnFila = true; }
    };
    const privacidad = campo('privacyConsent', { valido: false, etiqueta: 'Acepto el aviso de privacidad' });
    Object.assign(privacidad, { type: 'checkbox', dataset: { etiqueta: 'Aviso de privacidad' }, closest: () => fila });
    assert.equal(validarFormularioReporte(formulario([campo('repNombre'), privacidad])), false);
    assert.ok(clases.has('check-fila-error'));
    assert.deepEqual(agregados.filter(nodo => !nodo.quitado).map(nodo => nodo.textContent), ['Marcá esta casilla para continuar']);
    assert.equal(vistaEnFila, true, 'la vista va hasta la fila');
    assert.equal(privacidad.enfocado, true);
    assert.equal(error.textContent, 'Falta completar: Aviso de privacidad. Marcá esta casilla para continuar.');

    // Al volver a validar con la casilla marcada se limpia la fila.
    privacidad.checkValidity = () => true;
    assert.equal(validarFormularioReporte(formulario([privacidad])), true);
    assert.equal(clases.has('check-fila-error'), false);
    assert.equal(agregados.filter(nodo => !nodo.quitado).length, 0);
  });
});
