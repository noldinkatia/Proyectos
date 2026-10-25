import nodemailer from 'nodemailer';

// Único punto de envío de correos. Dos modos:
// - Con BREVO_API_KEY: API HTTPS de Brevo. Es el modo para Render, cuyo plan
//   gratuito bloquea los puertos SMTP (nodemailer con Gmail no puede salir).
// - Sin BREVO_API_KEY: SMTP de Gmail con MAIL_USER/MAIL_PASS, como siempre
//   (Docker local y plan B con túnel).
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const NOMBRE_REMITENTE = 'Rastreo PY';
const TIEMPO_MAXIMO_MS = 15_000;

export function remitente(env = process.env) {
  return env.MAIL_FROM || env.MAIL_USER;
}

export function modoCorreo(env = process.env) {
  return env.BREVO_API_KEY ? 'API de Brevo' : 'SMTP de Gmail';
}

// Los parámetros existen para los tests (fetch y transporte simulados).
export function crearEnviarCorreo({
  env = process.env,
  fetch = globalThis.fetch,
  crearTransporte = nodemailer.createTransport
} = {}) {
  if (env.BREVO_API_KEY) {
    return async function enviarCorreo({ to, subject, html, text }) {
      let response;
      try {
        response = await fetch(BREVO_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': env.BREVO_API_KEY
          },
          body: JSON.stringify({
            sender: { name: NOMBRE_REMITENTE, email: remitente(env) },
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text
          }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
        });
      } catch (error) {
        throw fallo(`no se pudo conectar con la API (${error.cause?.code || error.name})`);
      }
      if (!response.ok) {
        // Del cuerpo de la respuesta solo se usa "code" (p. ej. "unauthorized"):
        // "message" puede repetir direcciones de correo.
        const code = await response.json().then(body => body?.code, () => null);
        throw fallo(`la API respondió HTTP ${response.status}${typeof code === 'string' ? ` (${code})` : ''}`);
      }
    };
  }

  const transporte = crearTransporte({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASS }
  });
  return async function enviarCorreo({ to, subject, html, text }) {
    await transporte.sendMail({ from: `"${NOMBRE_REMITENTE}" <${remitente(env)}>`, to, subject, html, text });
  };
}

// Nunca incluye la clave, el destinatario ni el contenido del correo.
function fallo(detalle) {
  const error = new Error(`Brevo no envió el correo: ${detalle}.`);
  console.error(error.message);
  return error;
}

// Se configura en el primer envío, cuando dotenv ya cargó backend/.env.
let enviarConfigurado;
export function enviarCorreo(mensaje) {
  enviarConfigurado ??= crearEnviarCorreo();
  return enviarConfigurado(mensaje);
}
