import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

// Componente único de diálogos (public/js/dialogo.js) en lugar de prompt()/confirm().
const publicDir = new URL('../../public/', import.meta.url);
const { abrirDialogo, confirmar, pedirMotivo, validarDialogo } = await import(new URL('js/dialogo.js', publicDir));

test('el motivo se valida con trim(): solo espacios no alcanza', () => {
  const pide = { pideMotivo: true };
  assert.equal(validarDialogo({ motivo: '' }, pide), 'Escribí el motivo para continuar.');
  assert.equal(validarDialogo({ motivo: '   \n\t ' }, pide), 'Escribí el motivo para continuar.');
  assert.equal(validarDialogo({ motivo: ' Falta la denuncia ' }, pide), '');
  assert.equal(validarDialogo({ motivo: 'ab' }, { pideMotivo: true, minimo: 5 }), 'Escribí el motivo (al menos 5 caracteres) para continuar.');
  assert.equal(validarDialogo({ casillaMarcada: false }, { pideCasilla: true }), 'Marcá la casilla para continuar.');
  assert.equal(validarDialogo({ casillaMarcada: true }, { pideCasilla: true }), '');
  assert.equal(validarDialogo({}, {}), '', 'una confirmación simple no pide nada');
});

// DOM mínimo: un <dialog> con sus elementos, eventos y foco.
function domDePrueba() {
  const elemento = (extra = {}) => {
    const oyentes = {};
    const atributos = {};
    return {
      value: '', checked: false, textContent: '', isConnected: true, enfocado: 0,
      addEventListener: (tipo, fn) => { (oyentes[tipo] ||= []).push(fn); },
      disparar(tipo, evento = {}) { for (const fn of oyentes[tipo] || []) fn({ preventDefault() {}, ...evento }); },
      setAttribute: (n, v) => { atributos[n] = String(v); },
      removeAttribute: n => { delete atributos[n]; },
      getAttribute: n => atributos[n] ?? null,
      focus() { this.enfocado += 1; dom.foco = this; },
      ...extra
    };
  };
  const dom = { foco: null };
  const partes = { form: elemento(), motivo: elemento(), check: elemento(), error: elemento(), cancelar: elemento(), confirmar: elemento() };
  const dialogo = elemento({
    abierto: false, quitado: false, innerHTML: '',
    showModal() { this.abierto = true; },
    close() { if (!this.abierto) return; this.abierto = false; this.disparar('close'); },
    remove() { this.quitado = true; },
    querySelector(sel) {
      const html = this.innerHTML;
      return ({
        form: partes.form,
        '.dialogo-motivo': html.includes('dialogo-motivo') ? partes.motivo : null,
        '.dialogo-check': html.includes('dialogo-check') ? partes.check : null,
        '.dialogo-error': partes.error,
        '.dialogo-cancelar': partes.cancelar,
        '.dialogo-confirmar': partes.confirmar
      })[sel] ?? null;
    }
  });
  const origen = elemento();
  dom.foco = origen;
  globalThis.document = {
    createElement: () => dialogo,
    body: { append() {} },
    get activeElement() { return dom.foco; }
  };
  return { dom, partes, dialogo, origen };
}

test('pedirMotivo: campo visible, error con solo espacios, devuelve el motivo sin espacios de más', async () => {
  const anterior = globalThis.document;
  try {
    const { partes, dialogo, origen, dom } = domDePrueba();
    const promesa = pedirMotivo({ titulo: 'Rechazar reporte', etiqueta: 'Motivo del rechazo', textoConfirmar: 'Rechazar reporte', peligro: true });
    assert.equal(dialogo.abierto, true);
    assert.match(dialogo.innerHTML, /<label for="dialogo-motivo-\d+" class="dialogo-etiqueta">Motivo del rechazo<\/label>/);
    assert.match(dialogo.innerHTML, /<button type="button" class="btn btn-outline dialogo-cancelar">Cancelar<\/button>/);
    assert.match(dialogo.innerHTML, /<button type="submit" class="btn btn-red dialogo-confirmar">Rechazar reporte<\/button>/);
    assert.equal(dom.foco, partes.motivo, 'el foco va al campo');
    partes.motivo.value = '    ';
    partes.form.disparar('submit');
    assert.equal(dialogo.abierto, true, 'no se cierra');
    assert.equal(partes.error.textContent, 'Escribí el motivo para continuar.');
    assert.equal(partes.motivo.getAttribute('aria-invalid'), 'true');
    partes.motivo.value = '  Falta el número de denuncia  ';
    partes.motivo.disparar('input');
    assert.equal(partes.error.textContent, '', 'el error se borra al escribir');
    partes.form.disparar('submit');
    assert.equal(await promesa, 'Falta el número de denuncia');
    assert.equal(dialogo.quitado, true);
    assert.equal(dom.foco, origen, 'el foco vuelve al botón que lo abrió');
  } finally {
    globalThis.document = anterior;
  }
});

test('Esc o "Cancelar" resuelven null/false y devuelven el foco', async () => {
  const anterior = globalThis.document;
  try {
    let d = domDePrueba();
    const motivo = pedirMotivo({ titulo: 'Cerrar caso', etiqueta: 'Justificación' });
    d.dialogo.close(); // Esc: el navegador cierra el <dialog> sin enviar el formulario
    assert.equal(await motivo, null);
    assert.equal(d.dom.foco, d.origen);

    d = domDePrueba();
    const confirmacion = confirmar({ titulo: 'Marcar como localizada', mensaje: 'La ficha se retira a las 24 horas.' });
    assert.equal(d.dom.foco, d.partes.confirmar, 'sin campo, el foco va al botón de confirmar');
    d.partes.cancelar.disparar('click');
    assert.equal(await confirmacion, false);
    assert.equal(d.dom.foco, d.origen);
  } finally {
    globalThis.document = anterior;
  }
});

test('con casilla obligatoria no confirma hasta marcarla', async () => {
  const anterior = globalThis.document;
  try {
    const { partes, dialogo } = domDePrueba();
    const promesa = abrirDialogo({ titulo: 'Antes de publicar', contenidoHtml: '<p>texto</p>', casilla: 'Entiendo y confirmo' });
    partes.form.disparar('submit');
    assert.equal(partes.error.textContent, 'Marcá la casilla para continuar.');
    assert.equal(dialogo.abierto, true);
    partes.check.checked = true;
    partes.form.disparar('submit');
    assert.deepEqual(await promesa, { confirmado: true, motivo: null });
  } finally {
    globalThis.document = anterior;
  }
});

test('no queda ningún prompt() ni confirm() del navegador en la interfaz', async () => {
  const sospechosos = [];
  for (const dir of ['js/', 'app/']) {
    for (const archivo of (await readdir(new URL(dir, publicDir))).filter(f => f.endsWith('.js'))) {
      const codigo = (await readFile(new URL(`${dir}${archivo}`, publicDir), 'utf8'))
        .split(/\r?\n/).filter(linea => !linea.trim().startsWith('//')).join('\n');
      // evento.prompt() es la instalación de la app (beforeinstallprompt), no un cuadro.
      for (const m of codigo.matchAll(/(?<![.\w])(prompt|confirm|alert)\s*\(/g)) sospechosos.push(`${dir}${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(sospechosos, []);
  const admin = await readFile(new URL('js/admin.js', publicDir), 'utf8');
  for (const funcion of ['adminReject', 'adminCloseCase', 'adminReturnToReview', 'adminModerateClue']) {
    const cuerpo = admin.slice(admin.indexOf(`export async function ${funcion}(`), admin.indexOf('\n}\n', admin.indexOf(`export async function ${funcion}(`)));
    assert.match(cuerpo, /await pedirMotivo\(/, funcion);
  }
  for (const funcion of ['adminMarkLocated', 'runTimeFastForward']) {
    const cuerpo = admin.slice(admin.indexOf(`export async function ${funcion}(`), admin.indexOf('\n}\n', admin.indexOf(`export async function ${funcion}(`)));
    assert.match(cuerpo, /await confirmar\(/, funcion);
  }
});
