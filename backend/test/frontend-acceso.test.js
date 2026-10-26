import assert from 'node:assert/strict';
import test from 'node:test';

// Formularios de acceso (public/js/auth.js): ingreso, registro y recuperación.
const publicDir = new URL('../../public/', import.meta.url);
const auth = await import(new URL('js/auth.js', publicDir));
const { renderLoginForm, renderRegisterForm, renderOTPView, togglePass } = auth;

const atributos = etiqueta => Object.fromEntries([...etiqueta.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, n, v]) => [n, v]));
const etiquetas = (html, nombre) => [...html.matchAll(new RegExp(`<${nombre}\\b[^>]*>`, 'g'))].map(([e]) => atributos(e));

const CONTRASENAS = {
  loginPassword: ['current-password', () => renderLoginForm()],
  regPass: ['new-password', () => renderRegisterForm()],
  regPassConfirm: ['new-password', () => renderRegisterForm()],
  resetPassword: ['new-password', () => renderOTPView({ contact: 'ana@gmail.com', purpose: 'restablecer' })],
  resetPasswordConfirm: ['new-password', () => renderOTPView({ contact: 'ana@gmail.com', purpose: 'restablecer' })]
};

test('las cinco contraseñas tienen etiqueta enlazada, autocomplete y el botón del ojo accesible', () => {
  for (const [id, [autocomplete, render]] of Object.entries(CONTRASENAS)) {
    const html = render();
    const campo = etiquetas(html, 'input').find(i => i.id === id);
    assert.ok(campo, `${id}: falta el campo`);
    assert.equal(campo.type, 'password', id);
    assert.equal(campo.autocomplete, autocomplete, id);
    assert.ok(etiquetas(html, 'label').some(l => l.for === id), `${id}: etiqueta sin for`);
    const ojo = etiquetas(html, 'button').find(b => b['aria-controls'] === id);
    assert.ok(ojo, `${id}: falta el ojo`);
    assert.equal(ojo.type, 'button', `${id}: no envía el formulario`);
    assert.equal(ojo['aria-label'], 'Mostrar contraseña', id);
    assert.equal(ojo['aria-pressed'], 'false', id);
    assert.equal(ojo['data-on-click'], `togglePass('${id}')`, id);
    // El ícono es decorativo: lo que se lee es el botón.
    assert.match(html, /<svg class="icono-ojo"[^>]*aria-hidden="true"/);
  }
  for (const html of [renderLoginForm(), renderRegisterForm()]) {
    assert.doesNotMatch(html, />\s*Mostrar\s*</, 'sin botones de texto "Mostrar"');
  }
});

test('cada etiqueta de los formularios de acceso apunta a un campo que existe', () => {
  for (const html of [renderLoginForm(), renderRegisterForm(), renderOTPView({ contact: 'ana@gmail.com', purpose: 'restablecer' })]) {
    const ids = new Set(etiquetas(html, 'input').map(i => i.id));
    for (const label of etiquetas(html, 'label').filter(l => l.for !== undefined)) {
      assert.ok(ids.has(label.for), `label for="${label.for}" sin campo`);
    }
    // Ningún campo de texto o contraseña sin nombre accesible.
    for (const input of etiquetas(html, 'input').filter(i => ['text', 'email', 'password'].includes(i.type))) {
      assert.ok(etiquetas(html, 'label').some(l => l.for === input.id) || input['aria-label'], `${input.id} sin etiqueta`);
    }
  }
  const login = etiquetas(renderLoginForm(), 'input').find(i => i.id === 'loginEmail');
  assert.equal(login.autocomplete, 'email');
  const registro = etiquetas(renderRegisterForm(), 'input');
  assert.equal(registro.find(i => i.id === 'regName').autocomplete, 'name');
  assert.equal(registro.find(i => i.id === 'regPass')['aria-describedby'], 'passwordStrength', 'la fortaleza se lee con el campo');
});

test('el ojo alterna el tipo del campo y aria-pressed', () => {
  const campo = { type: 'password' };
  const clases = new Set();
  const boton = {
    atributos: { 'aria-pressed': 'false' },
    setAttribute(n, v) { this.atributos[n] = v; },
    classList: { toggle: (c, f) => (f ? clases.add(c) : clases.delete(c)) }
  };
  const anterior = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'loginPassword' ? campo : null),
    querySelector: sel => (sel === '.boton-ojo[aria-controls="loginPassword"]' ? boton : null)
  };
  try {
    togglePass('loginPassword');
    assert.equal(campo.type, 'text');
    assert.equal(boton.atributos['aria-pressed'], 'true');
    assert.ok(clases.has('boton-ojo-activo'));
    togglePass('loginPassword');
    assert.equal(campo.type, 'password');
    assert.equal(boton.atributos['aria-pressed'], 'false');
    assert.ok(!clases.has('boton-ojo-activo'));
    togglePass('noExiste');
  } finally {
    globalThis.document = anterior;
  }
});

test('estilos del ojo: no dependen del tipo del campo y no hay un segundo ojo del navegador', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('styles.css', publicDir), 'utf8');
  // Antes el diseño colgaba de input[type="password"] y se rompía al mostrar la contraseña.
  assert.doesNotMatch(css, /:has\(> input\[type="password"\]\)/);
  assert.match(css, /\.campo-contrasena \{ position: relative; \}/);
  assert.match(css, /\.campo-contrasena \.form-control::-ms-reveal, \.campo-contrasena \.form-control::-ms-clear \{ display: none; \}/);
  assert.match(css, /\.boton-ojo:focus-visible \{ outline: 3px solid/, 'foco visible con teclado');
  assert.match(css, /\.auth-panel form button\[type="button"\]:not\(\.link-inline\):not\(\.boton-ojo\)/);
});
