import assert from 'node:assert/strict';
import test from 'node:test';
import { crearEnviarCorreo } from '../mailer.js';

const CLAVE = 'xkeysib-clave-de-prueba-que-no-debe-aparecer';
const MENSAJE = {
  to: 'persona.privada@gmail.com',
  subject: 'Código de verificación - Rastreo PY',
  html: '<p>Su código de verificación es: 123456</p>',
  text: 'Su código de verificación es: 123456'
};

function fetchSimulado(respuesta) {
  const llamadas = [];
  const fetch = async (url, opciones) => {
    llamadas.push({ url, opciones });
    return respuesta;
  };
  return { fetch, llamadas };
}

function transporteNoUsado() {
  throw new Error('No debería crearse un transporte SMTP con BREVO_API_KEY.');
}

// Captura console.error para revisar qué queda en el log.
async function conLogCapturado(callback) {
  const lineas = [];
  const original = console.error;
  console.error = (...args) => { lineas.push(args.map(String).join(' ')); };
  try {
    await callback();
  } finally {
    console.error = original;
  }
  return lineas.join('\n');
}

test('correo con BREVO_API_KEY: POST a la API de Brevo con api-key y remitente MAIL_FROM', async () => {
  const { fetch, llamadas } = fetchSimulado({ ok: true, status: 201, json: async () => ({ messageId: '<id@brevo>' }) });
  const enviar = crearEnviarCorreo({
    env: { BREVO_API_KEY: CLAVE, MAIL_FROM: 'avisos@rastreopy.org', MAIL_USER: 'cuenta@gmail.com' },
    fetch,
    crearTransporte: transporteNoUsado
  });
  await enviar(MENSAJE);

  assert.equal(llamadas.length, 1);
  const [{ url, opciones }] = llamadas;
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(opciones.method, 'POST');
  assert.equal(opciones.headers['api-key'], CLAVE);
  assert.equal(opciones.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(opciones.body), {
    sender: { name: 'Rastreo PY', email: 'avisos@rastreopy.org' },
    to: [{ email: MENSAJE.to }],
    subject: MENSAJE.subject,
    htmlContent: MENSAJE.html,
    textContent: MENSAJE.text
  });
});

test('correo con BREVO_API_KEY y sin MAIL_FROM: el remitente es MAIL_USER', async () => {
  const { fetch, llamadas } = fetchSimulado({ ok: true, status: 201, json: async () => ({}) });
  const enviar = crearEnviarCorreo({ env: { BREVO_API_KEY: CLAVE, MAIL_USER: 'cuenta@gmail.com' }, fetch, crearTransporte: transporteNoUsado });
  await enviar(MENSAJE);
  assert.deepEqual(JSON.parse(llamadas[0].opciones.body).sender, { name: 'Rastreo PY', email: 'cuenta@gmail.com' });
});

test('correo con BREVO_API_KEY: un 4xx lanza un error claro y el log no muestra la clave ni datos personales', async () => {
  const { fetch } = fetchSimulado({
    ok: false,
    status: 401,
    json: async () => ({ code: 'unauthorized', message: `Key not found for ${MENSAJE.to}` })
  });
  const enviar = crearEnviarCorreo({ env: { BREVO_API_KEY: CLAVE, MAIL_USER: 'cuenta@gmail.com' }, fetch, crearTransporte: transporteNoUsado });

  let error;
  const log = await conLogCapturado(async () => {
    error = await enviar(MENSAJE).then(() => null, caught => caught);
  });
  assert.ok(error instanceof Error, 'tiene que rechazar');
  assert.equal(error.message, 'Brevo no envió el correo: la API respondió HTTP 401 (unauthorized).');
  assert.match(log, /HTTP 401 \(unauthorized\)/);
  for (const texto of [error.message, log]) {
    assert.ok(!texto.includes(CLAVE), 'no muestra la clave');
    assert.ok(!texto.includes(MENSAJE.to), 'no muestra el destinatario');
    assert.ok(!texto.includes('123456'), 'no muestra el contenido');
  }
});

test('correo con BREVO_API_KEY: sin conexión con la API lanza un error claro', async () => {
  const fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); };
  const enviar = crearEnviarCorreo({ env: { BREVO_API_KEY: CLAVE, MAIL_USER: 'cuenta@gmail.com' }, fetch, crearTransporte: transporteNoUsado });
  let error;
  await conLogCapturado(async () => {
    error = await enviar(MENSAJE).then(() => null, caught => caught);
  });
  assert.equal(error?.message, 'Brevo no envió el correo: no se pudo conectar con la API (ENOTFOUND).');
});

test('correo sin BREVO_API_KEY: usa SMTP de Gmail con MAIL_USER/MAIL_PASS y no llama a fetch', async () => {
  let configuracion;
  const enviados = [];
  const crearTransporte = config => {
    configuracion = config;
    return { sendMail: async mensaje => { enviados.push(mensaje); } };
  };
  const fetch = async () => { throw new Error('No debería llamarse a la API sin BREVO_API_KEY.'); };
  const enviar = crearEnviarCorreo({
    env: { MAIL_USER: 'cuenta@gmail.com', MAIL_PASS: 'clave-de-aplicacion', BREVO_API_KEY: '' },
    fetch,
    crearTransporte
  });
  await enviar(MENSAJE);

  assert.deepEqual(configuracion, {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: 'cuenta@gmail.com', pass: 'clave-de-aplicacion' }
  });
  assert.deepEqual(enviados, [{ from: '"Rastreo PY" <cuenta@gmail.com>', ...MENSAJE }]);
});
