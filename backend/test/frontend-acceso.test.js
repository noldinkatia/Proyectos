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

test('sugerencia de @gmail.com: ana, ana@gm, otro dominio y ya @gmail.com', () => {
  const { sugerenciaGmail } = auth;
  assert.equal(sugerenciaGmail('ana'), 'ana@gmail.com');
  assert.equal(sugerenciaGmail('ana@gm'), 'ana@gmail.com');
  assert.equal(sugerenciaGmail('ana@hotmail.com'), '', 'otro dominio: no molesta');
  assert.equal(sugerenciaGmail('ana@gmail.com'), '', 'ya completo');
  // Respeta lo escrito: el usuario no se toca (mayúsculas, puntos) y solo se completa el dominio.
  assert.equal(sugerenciaGmail('Ana.Perez'), 'Ana.Perez@gmail.com');
  assert.equal(sugerenciaGmail('ana@'), 'ana@gmail.com');
  assert.equal(sugerenciaGmail('ana@GMA'), 'ana@gmail.com');
  assert.equal(sugerenciaGmail('ana@GMAIL.COM'), '');
  assert.equal(sugerenciaGmail('ana@gmx.net'), '');
  for (const nada of ['', '   ', '@gm', 'ana perez', 'a@b@c', undefined]) assert.equal(sugerenciaGmail(nada), '', String(nada));
});

test('el campo de correo usa un datalist sin romper el autocompletado del navegador', () => {
  for (const [html, id] of [[renderLoginForm(), 'loginEmail'], [renderRegisterForm(), 'regEmail']]) {
    const campo = etiquetas(html, 'input').find(i => i.id === id);
    assert.equal(campo.type, 'email');
    assert.equal(campo.autocomplete, 'email', 'el navegador sigue ofreciendo sus correos');
    assert.equal(campo.list, `${id}Sugerencias`);
    assert.equal(campo['data-on-input'], 'sugerirGmail(this)');
    assert.match(html, new RegExp(`<datalist id="${id}Sugerencias"></datalist>`));
    assert.ok(etiquetas(html, 'label').some(l => l.for === id));
  }
  // Al escribir se actualiza la única opción (y se escapa lo escrito).
  const lista = { innerHTML: 'previo' };
  const anterior = globalThis.document;
  globalThis.document = { getElementById: id => (id === 'regEmailSugerencias' ? lista : null) };
  try {
    const campo = valor => ({ value: valor, getAttribute: () => 'regEmailSugerencias' });
    auth.sugerirGmail(campo('ana'));
    assert.equal(lista.innerHTML, '<option value="ana@gmail.com"></option>');
    auth.sugerirGmail(campo('ana@hotmail.com'));
    assert.equal(lista.innerHTML, '');
    auth.sugerirGmail(campo('"x"'));
    assert.equal(lista.innerHTML, '<option value="&quot;x&quot;@gmail.com"></option>');
  } finally {
    globalThis.document = anterior;
  }
});

const verificacion = await import(new URL('js/verificacion.js', publicDir));
const { estado } = await import(new URL('js/estado.js', publicDir));

function almacen(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  return { getItem: k => (mapa.has(k) ? mapa.get(k) : null), setItem: (k, v) => mapa.set(k, String(v)), removeItem: k => mapa.delete(k), mapa };
}

// sessionStorage y un document mínimo para las funciones de la pantalla del código.
function conNavegador(fn) {
  const anteriores = { sessionStorage: globalThis.sessionStorage, document: globalThis.document };
  const sesion = almacen();
  globalThis.sessionStorage = sesion;
  globalThis.document = { getElementById: () => null, querySelector: () => null };
  const restaurar = () => {
    auth.terminarVerificacion(); // detiene el temporizador de reenvío
    globalThis.sessionStorage = anteriores.sessionStorage;
    globalThis.document = anteriores.document;
  };
  let resultado;
  try {
    resultado = fn(sesion);
  } catch (error) {
    restaurar();
    throw error;
  }
  // Si fn es async, se restaura recién cuando termina.
  if (resultado && typeof resultado.then === 'function') return resultado.finally(restaurar);
  restaurar();
  return resultado;
}

test('sessionStorage guarda solo correo, propósito y próximo reenvío (nunca contraseña ni código)', () => {
  const s = almacen();
  verificacion.guardarVerificacion({ correo: 'ana@gmail.com', proposito: 'registro', proximoReenvio: 123, contrasena: 'x', codigo: '123456' }, s);
  assert.deepEqual(JSON.parse(s.getItem('rastreo_verificacion')), { correo: 'ana@gmail.com', proposito: 'registro', proximoReenvio: 123 });
  assert.deepEqual(verificacion.leerVerificacion(s), { correo: 'ana@gmail.com', proposito: 'registro', proximoReenvio: 123 });
  verificacion.borrarVerificacion(s);
  assert.equal(verificacion.leerVerificacion(s), null);
  // Datos inválidos o ajenos no se guardan ni se leen.
  for (const malo of [{ correo: 'ana@hotmail.com', proposito: 'registro' }, { correo: 'ana@gmail.com', proposito: 'otro' }]) {
    verificacion.guardarVerificacion(malo, s);
    assert.equal(s.getItem('rastreo_verificacion'), null);
  }
  assert.equal(verificacion.leerVerificacion(almacen({ rastreo_verificacion: '{roto' })), null);
  assert.equal(verificacion.leerVerificacion({ getItem() { throw new Error('bloqueado'); } }), null);
});

test('espera para reenviar: segundos restantes y texto', () => {
  assert.equal(verificacion.segundosParaReenviar(10_500, 1_000), 10);
  assert.equal(verificacion.segundosParaReenviar(500, 1_000), 0);
  assert.equal(verificacion.textoEspera(45), '45 s');
  assert.equal(verificacion.textoEspera(61), '2 min');
  assert.equal(verificacion.textoEspera(3000), '50 min');
  assert.equal(verificacion.textoEspera(3900), '1 h 5 min');
});

test('recargar #/verificar retoma el flujo con lo guardado (correo, propósito y espera)', () => conNavegador(sesion => {
  auth.terminarVerificacion();
  sesion.setItem('rastreo_verificacion', JSON.stringify({ correo: 'ana@gmail.com', proposito: 'restablecer', proximoReenvio: Date.now() + 30_000 }));
  assert.equal(auth.restaurarVerificacion(), true);
  assert.equal(estado.activeOtpEmail, 'ana@gmail.com');
  assert.equal(estado.activeOtpPurpose, 'restablecer');
  assert.ok(estado.resendSeconds > 28 && estado.resendSeconds <= 30);
  const html = auth.renderOTPView({});
  assert.match(html, /Si <strong>ana@gmail\.com<\/strong> está registrado, te enviamos un código/, 'no revela si existe');
  assert.match(html, /El código vence en 10 minutos/);
  assert.match(html, /<button type="button" id="resendCodeButton"[^>]*disabled>Reenviar código \(en \d+ s\)<\/button>/);
  assert.match(html, /<form data-on-submit="verifyEmailCode\(event\)" novalidate>/, 'Enter verifica');
  assert.match(html, /<label for="otpInput">Código de 6 dígitos<\/label>/);
  // Sin nada guardado, no hay flujo que retomar (el router manda al ingreso).
  auth.terminarVerificacion();
  assert.equal(auth.restaurarVerificacion(), false);
}));

test('la cuenta regresiva guarda el próximo reenvío y terminar el flujo borra lo guardado', () => conNavegador(sesion => {
  estado.activeOtpEmail = 'ana@gmail.com';
  estado.activeOtpPurpose = 'registro';
  estado.pendingRegistration = { nombre_completo: 'Ana', correo: 'ana@gmail.com', contrasena: 'Secreta-123', acepto_terminos: true };
  auth.startResendCountdown(2700); // p. ej. reintentarEn de un 429 por hora
  const guardado = JSON.parse(sesion.getItem('rastreo_verificacion'));
  assert.deepEqual(Object.keys(guardado).sort(), ['correo', 'proposito', 'proximoReenvio']);
  assert.ok(Math.abs(guardado.proximoReenvio - (Date.now() + 2_700_000)) < 2000);
  assert.ok(!sesion.getItem('rastreo_verificacion').includes('Secreta-123'), 'la contraseña nunca se guarda');
  auth.terminarVerificacion();
  assert.equal(sesion.getItem('rastreo_verificacion'), null);
  assert.equal(estado.resendSeconds, 0);
  assert.equal(estado.resendTimer, null);
  estado.pendingRegistration = null;
}));

test('cada salida del flujo borra lo guardado: verificar, otro correo, volver, ingresar y cerrar sesión', async () => {
  const { readFile } = await import('node:fs/promises');
  const fuente = (await readFile(new URL('js/auth.js', publicDir), 'utf8')).replace(/\r\n/g, '\n');
  const cuerpo = nombre => {
    const inicio = fuente.search(new RegExp(`export (async )?function ${nombre}[(]`));
    assert.ok(inicio >= 0, `falta ${nombre}`);
    return fuente.slice(inicio, fuente.indexOf('\n}\n', inicio));
  };
  for (const nombre of ['verifyEmailCode', 'changeRegistrationEmail', 'salirDeVerificacion', 'completarRegistroDeNuevo', 'handleLogin', 'logout']) {
    assert.match(cuerpo(nombre), /terminarVerificacion\(\)/, nombre);
  }
  // Empezar otro flujo reemplaza lo guardado del anterior.
  assert.match(cuerpo('handleRegister'), /iniciarVerificacion\(email, 'registro'\)/);
  assert.match(cuerpo('handleRecoverRequest'), /iniciarVerificacion\(email, 'restablecer'\)/);
});

test('recuperación: formulario en pantalla (#/recuperar) en lugar de prompt()', async () => {
  const { readFile } = await import('node:fs/promises');
  const fuente = await readFile(new URL('js/auth.js', publicDir), 'utf8');
  assert.doesNotMatch(fuente, /prompt\('Ingresa tu Gmail/);
  const html = auth.renderRecoverForm('ana@gmail.com');
  assert.match(html, /<form data-on-submit="handleRecoverRequest\(event\)">/);
  const campo = etiquetas(html, 'input').find(i => i.id === 'recoverEmail');
  assert.equal(campo.type, 'email');
  assert.equal(campo.value, 'ana@gmail.com', 'trae el correo escrito en el ingreso');
  assert.equal(campo.list, 'recoverEmailSugerencias', 'con la sugerencia de @gmail.com');
  assert.ok(etiquetas(html, 'label').some(l => l.for === 'recoverEmail'));
  assert.match(html, /<button type="submit" class="btn btn-primary">Enviar código<\/button>/);
  const { buildRoute, parseRoute } = await import(new URL('js/router.js', publicDir));
  assert.equal(buildRoute('auth', { authMode: 'recover' }), '#/recuperar');
  assert.deepEqual(parseRoute('#/recuperar'), { view: 'auth', params: { authMode: 'recover' } });
});

test('recuperación: misma respuesta exista o no la cuenta; con 429 muestra la espera', () => conServidorSimulado({
  '/auth/restablecer/solicitar': [429, { error: 'Se alcanzó el límite de 5 envíos por hora para este contacto.', reintentarEn: 125 }]
}, async ({ pedidos }) => {
  const feedback = { textContent: '', classList: { remove() {} } };
  globalThis.document = { getElementById: id => ({ recoverEmail: { value: ' Ana@Gmail.com ' }, authFeedback: feedback })[id] || null, querySelector: () => null };
  await auth.handleRecoverRequest({ preventDefault() {} });
  assert.deepEqual(pedidos.map(p => [p.ruta, p.cuerpo.correo]), [['/auth/restablecer/solicitar', 'ana@gmail.com']]);
  assert.equal(feedback.textContent, 'Se alcanzó el límite de 5 envíos por hora para este contacto. Podés pedir otro código en 3 min.');
}));

// fetch simulado: responde según la ruta y registra lo pedido.
function conServidorSimulado(respuestas, fn) {
  const pedidos = [];
  const anterior = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    const ruta = String(url).replace(/^\/api/, '');
    pedidos.push({ ruta, cuerpo: JSON.parse(opciones.body || '{}') });
    const [status, cuerpo] = respuestas[ruta] || [404, { error: 'sin ruta' }];
    return { ok: status < 400, status, json: async () => cuerpo };
  };
  return conNavegador(async sesion => {
    const aviso = { textContent: '', classList: { remove() {} }, append(...partes) { this.textContent += partes.map(p => (typeof p === 'string' ? p : p.textContent)).join(''); } };
    globalThis.document = {
      getElementById: id => (id === 'otpFeedback' ? aviso : null),
      querySelector: () => null,
      createElement: () => ({ setAttribute() {}, textContent: '' })
    };
    try {
      await fn({ pedidos, aviso, sesion });
    } finally {
      globalThis.fetch = anterior;
      estado.pendingRegistration = null;
    }
  });
}

test('429 al reenviar: muestra la espera real (reintentarEn) y bloquea el botón ese tiempo', () => conServidorSimulado({
  '/auth/registro/reenviar': [429, { error: 'Se alcanzó el límite de 5 envíos por hora para este contacto.', reintentarEn: 3000 }]
}, async ({ aviso, sesion }) => {
  estado.activeOtpEmail = 'ana@gmail.com';
  estado.activeOtpPurpose = 'registro';
  estado.resendSeconds = 0;
  await auth.resendVerificationCode();
  assert.equal(aviso.textContent, 'Se alcanzó el límite de 5 envíos por hora para este contacto. Podés pedir otro código en 50 min.');
  assert.equal(estado.resendSeconds, 3000, 'no un minuto fijo');
  const guardado = JSON.parse(sesion.getItem('rastreo_verificacion'));
  assert.ok(Math.abs(guardado.proximoReenvio - (Date.now() + 3_000_000)) < 2000, 'la espera sobrevive a una recarga');
}));

test('"Reenviar código" tras 5 intentos fallidos vuelve a enviar el mismo /auth/registro con los datos en memoria', () => conServidorSimulado({
  '/auth/registro/reenviar': [400, { error: 'No hay un registro pendiente. Complete el formulario de registro nuevamente.' }],
  '/auth/registro': [200, { mensaje: 'Código enviado al Gmail.' }]
}, async ({ pedidos, aviso }) => {
  const datos = { nombre_completo: 'Ana Pérez', correo: 'ana@gmail.com', contrasena: 'Secreta-123', acepto_terminos: true };
  estado.pendingRegistration = datos;
  estado.activeOtpEmail = 'ana@gmail.com';
  estado.activeOtpPurpose = 'registro';
  estado.resendSeconds = 0;
  await auth.resendVerificationCode();
  assert.deepEqual(pedidos.map(p => p.ruta), ['/auth/registro/reenviar', '/auth/registro']);
  assert.deepEqual(pedidos[1].cuerpo, datos, 'el mismo pedido del formulario');
  assert.equal(aviso.textContent, 'Enviamos un código nuevo a tu Gmail.');
  assert.equal(estado.resendSeconds, 60);
}));

test('sin los datos en memoria (se recargó la página) pide completar el registro, sin decir si el correo existe', () => conServidorSimulado({
  '/auth/registro/reenviar': [400, { error: 'No hay un registro pendiente. Complete el formulario de registro nuevamente.' }]
}, async ({ pedidos, aviso }) => {
  estado.pendingRegistration = null;
  estado.activeOtpEmail = 'ana@gmail.com';
  estado.activeOtpPurpose = 'registro';
  estado.resendSeconds = 0;
  await auth.resendVerificationCode();
  assert.deepEqual(pedidos.map(p => p.ruta), ['/auth/registro/reenviar'], 'no manda nada sin los datos');
  assert.match(aviso.textContent, /Completá el registro de nuevo para recibir otro código\. Completar el registro$/);
  assert.doesNotMatch(aviso.textContent, /registrad[oa]|existe|cuenta/i);
}));
