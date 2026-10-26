// Sesión: ingreso, registro, código por correo, restablecer contraseña, términos y encabezado de usuario.
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { estado } from './estado.js';
import { startNotificationPolling } from './notifications.js';
import { darDeBajaEsteDispositivo } from './push-dispositivo.js';
import { consumePendingDestination, navigateTo } from './router.js';
import { olvidarSesion, recordarUsuario } from './sesion.js';
import { borrarVerificacion, guardarVerificacion, leerVerificacion, segundosParaReenviar, textoEspera } from './verificacion.js';
import { getStore } from './store.js';
import { showToast } from './ui.js';

export function updateHeaderUser() {
  const store = getStore();
  const isAdministrator = ['administrador', 'ADMINISTRADOR'].includes(store.currentUser?.rol);
  const isCitizen = Boolean(store.currentUser) && !isAdministrator;
  const authAction = document.getElementById('headerAuthAction');
  const profile = document.getElementById('headerProfile');
  const displayName = store.currentUser?.nombre || store.currentUser?.nombre_completo || store.currentUser?.correo || '';
  document.querySelectorAll('[data-role-nav="admin"]').forEach(item => item.classList.toggle('hidden', !isAdministrator));
  document.querySelectorAll('[data-role-nav="citizen"]').forEach(item => item.classList.toggle('hidden', !isCitizen));
  document.querySelectorAll('[data-hide-admin-nav]').forEach(item => item.classList.toggle('hidden', isAdministrator));
  // Consulta pública: sin sesión se ofrece ingresar y se ocultan las opciones de cuenta.
  document.querySelectorAll('[data-role-nav="guest"]').forEach(item => item.classList.toggle('hidden', Boolean(store.currentUser)));
  document.querySelectorAll('[data-role-nav="session"]').forEach(item => item.classList.toggle('hidden', !store.currentUser));
  profile?.classList.toggle('hidden', !store.currentUser);
  document.getElementById('drawerIdentity')?.classList.toggle('hidden', !store.currentUser);
  document.getElementById('headerProfileName').textContent = displayName;
  const avatar = document.getElementById('headerProfileAvatar');
  avatar.textContent = displayName.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toLocaleUpperCase('es-PY');
  avatar.classList.toggle('header-profile-avatar-admin', isAdministrator);
  avatar.classList.toggle('header-profile-avatar-citizen', !isAdministrator);
  const roleBadge = document.getElementById('headerProfileRole');
  roleBadge.textContent = isAdministrator ? 'Administración' : 'Ciudadano';
  roleBadge.classList.toggle('role-badge-admin', isAdministrator);
  roleBadge.classList.toggle('role-badge-citizen', !isAdministrator);
  if (authAction) {
    authAction.textContent = store.currentUser ? 'Cerrar sesión' : '♙ Ingresar';
    authAction.onclick = store.currentUser ? logout : () => navigateTo('auth');
    authAction.classList.toggle('hidden', Boolean(store.currentUser));
  }
  if (!store.currentUser) return;
  document.getElementById('drawerUserName').innerText = displayName;
  const drawerRole = document.getElementById('drawerUserRole');
  drawerRole.innerText = isAdministrator ? 'Administración' : 'Ciudadano';
  drawerRole.classList.toggle('role-badge-admin', isAdministrator);
  drawerRole.classList.toggle('role-badge-citizen', !isAdministrator);
  // El simulador es del panel admin: la app (/app/) no lo tiene.
  document.getElementById('simulateFollowupButton')?.classList.toggle('hidden', !isAdministrator);
  startNotificationPolling();
}

// ==========================================
// VISTA 1: BASES Y CONDICIONES (SECCIÓN 3)
// ==========================================
// El texto es uno solo: lo usan la pantalla obligatoria, el modal del registro y la
// página de consulta #/bases.
export const BASES_TEXTO = `
          <p><strong>1. Alcance del Servicio:</strong> La plataforma Rastreo PY es un canal de difusión colaborativa y centralización de reportes. No constituye un organismo de seguridad, investigación ni administración de justicia, ni reemplaza las actuaciones de la Policía Nacional de Paraguay o del Ministerio Público.</p>
          <p><strong>2. Obligatoriedad de Denuncia Oficial:</strong> El uso de esta plataforma no sustituye la radicación formal de la denuncia. Se exige al usuario realizar la denuncia correspondiente ante las instituciones públicas oficiales de manera prioritaria y previa a la carga de datos en la plataforma.</p>
          <p><strong>3. Deslinde de Responsabilidad:</strong> La plataforma, sus desarrolladores y administradores quedan totalmente eximidos de cualquier responsabilidad legal, civil, penal o administrativa respecto a la conducción, seguimiento o resultados de las investigaciones, así como de la veracidad, exactitud o autenticidad de la información e imágenes ingresadas por terceros.</p>
          <p><strong>4. Marco de referencia:</strong> Este prototipo académico toma como referencia la Ley N.º 7605/2025 (RENAPED/MAFE) y la Ley N.º 7593/2025, Art. 16, num. 7. Su aplicación y alcance deben ser validados por UNIDA y las autoridades competentes antes de un despliegue operativo. Se prohíbe el ingreso de datos crediticios, bancarios o patrimoniales (Ley N.º 6534/2020), así como datos sensibles ajenos a la finalidad del reporte.</p>
          <p><strong>5. Derecho de Supresión (Borrado de Datos):</strong> Una vez que la persona reportada sea localizada o el caso sea cerrado por la autoridad competente, la ficha de búsqueda permanecerá visible por un máximo de 24 horas con el estado 'Localizado', a fin de informar a la ciudadanía. Transcurrido ese plazo, la plataforma procederá al retiro y desindexación pública de la ficha. Los datos solo se conservarán, de forma restringida, para el historial interno de la autoridad administradora y como cifras estadísticas agregadas.</p>
          <p><strong>6. Uso Aceptable:</strong> Queda estrictamente prohibido el ingreso de reportes falsos, difamatorios o el uso de la plataforma para cometer extorsiones, estafas o cobro indebido de recompensas.</p>`;

export function renderLegalTerms() {
  return `
    <div class="legal-view">
      <div>
        <div>
          <p>República del Paraguay</p>
          <h1>Plataforma Rastreo PY</h1>
          <p>Bases y Condiciones Obligatorias de Uso</p>
        </div>

        <div>${BASES_TEXTO}
        </div>
      </div>

      <div>
        <label>
          <input type="checkbox" id="checkTerms">
          <span>He leído y acepto expresamente las bases y condiciones.</span>
        </label>
        <div id="termsSaveError" class="hidden" role="alert">
          <span id="termsSaveErrorText"></span>
          <button type="button" data-on-click="retryTermsAcceptance()" class="btn btn-outline btn-sm">Reintentar</button>
        </div>
        <div class="grid-2">
          <button data-on-click="rejectTerms()" class="btn btn-outline">No aceptar</button>
          <button id="acceptTermsButton" data-on-click="acceptTerms()" class="btn btn-red">Aceptar y Continuar</button>
        </div>
      </div>
    </div>
  `;
}

// Página de consulta #/bases: solo lectura, con o sin sesión (la pantalla para
// aceptarlas es renderLegalTerms, solo para ciudadanos que no las aceptaron).
export function renderBasesView() {
  const usuario = getStore().currentUser;
  const fecha = usuario?.acepto_terminos && usuario.fecha_aceptacion_terminos
    ? new Date(usuario.fecha_aceptacion_terminos) : null;
  const aceptadas = fecha && !Number.isNaN(fecha.getTime())
    ? `<p class="notice">Aceptaste estas bases el ${escapeHtml(fecha.toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>`
    : '';
  return `
    <section class="bases-view">
      <header class="page-heading">
        <span class="section-kicker">Plataforma Rastreo PY</span>
        <h1>Bases y condiciones de uso</h1>
        <p>República del Paraguay · Condiciones que acepta cada ciudadano al crear su cuenta.</p>
      </header>
      ${aceptadas}
      <div class="card bases-texto">${BASES_TEXTO}
      </div>
    </section>
  `;
}

export function showTermsSaveError(error) {
  const errorBox = document.getElementById('termsSaveError');
  const errorText = document.getElementById('termsSaveErrorText');
  console.error('Error al guardar aceptación de términos:', error?.status, error?.message);
  errorText.textContent = error?.message || 'No se pudo guardar la aceptación. Intente nuevamente.';
  errorBox.classList.remove('hidden');
}

export async function acceptTerms() {
  if (!document.getElementById('checkTerms').checked) {
    showToast('Importante', 'Debe declarar la aceptación de los términos para utilizar el portal.', 'error');
    return;
  }
  const button = document.getElementById('acceptTermsButton');
  button.disabled = true;
  try {
    await apiRequest('/auth/terminos', { method: 'POST' });
    window.backendCurrentUser = { ...window.backendCurrentUser, acepto_terminos: true };
    recordarUsuario(window.backendCurrentUser);
    navigateTo('home');
  } catch (error) {
    showTermsSaveError(error);
  } finally {
    const retryButton = document.getElementById('acceptTermsButton');
    if (retryButton) retryButton.disabled = false;
  }
}

export async function retryTermsAcceptance() {
  const errorBox = document.getElementById('termsSaveError');
  errorBox.classList.add('hidden');
  await acceptTerms();
}

export function rejectTerms() { showToast('Acceso denegado', 'No es posible acceder sin aceptar las bases y condiciones.', 'error'); }

// Bases desde el registro: <dialog> nativo (Esc lo cierra y el resto de la página
// queda inerte). Se agrega al <body>, fuera del formulario, así lo escrito no se pierde.
export function abrirBasesModal() {
  let modal = document.getElementById('basesModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="basesModal" class="bases-modal" aria-labelledby="basesModalTitulo">
        <div class="modal-header">
          <h2 id="basesModalTitulo">Bases y condiciones de uso</h2>
          <button type="button" class="btn btn-outline btn-sm" data-on-click="cerrarBasesModal()">Cerrar</button>
        </div>
        <div class="modal-body bases-texto">${BASES_TEXTO}</div>
      </dialog>`);
    modal = document.getElementById('basesModal');
    // Se cierre con el botón o con Esc, el foco vuelve al enlace que lo abrió.
    modal.addEventListener('close', () => document.getElementById('regTermsLink')?.focus());
  }
  modal.showModal();
}

export function cerrarBasesModal() {
  document.getElementById('basesModal')?.close();
}

// ==========================================
// VISTA 2: ACCESO E INICIO DE SESIÓN (SECCIÓN 4)
// ==========================================
export function renderAuthScreen(mode = 'login', identifier = '') {
  const isLogin = mode === 'login';
  const notice = window.authNotice || '';
  window.authNotice = '';
  return `
    <div class="auth-view">
      <div>
        <h1>Portal de acceso · Rastreo PY</h1>
        <p>Plataforma Oficial Colaborativa</p>
        <button type="button" class="btn btn-outline btn-sm" data-on-click="navigateTo('home')">← Volver a los casos públicos</button>
      </div>

      <div class="auth-tabs">
        <button class="${isLogin ? 'active' : ''}" data-on-click="navigateTo('auth', {authMode: 'login'})">Iniciar sesión</button>
        <button class="${isLogin ? '' : 'active'}" data-on-click="navigateTo('auth', {authMode: 'register'})">Crear cuenta</button>
      </div>

      <div class="card auth-panel">
        ${isLogin ? renderLoginForm(identifier) : renderRegisterForm()}
        <div id="authFeedback" class="${notice ? '' : 'hidden'}" role="status">${escapeHtml(notice)}</div>
      </div>
    </div>
  `;
}

// Ojo de mostrar/ocultar (SVG propio, sin librerías): ojo abierto con la contraseña
// oculta y tachado cuando se ve. aria-hidden: lo que lee el lector es el botón.
const ICONO_OJO = '<svg class="icono-ojo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path class="icono-ojo-tachado" d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// Campo de contraseña con su etiqueta enlazada (for/id) y el botón del ojo. El botón
// es un interruptor: nombre fijo "Mostrar contraseña" y aria-pressed="true" cuando
// se ve (patrón de botón de alternancia de WAI-ARIA; el lector dice "presionado").
export function campoContrasena({ id, etiqueta, autocomplete, placeholder = '', atributos = '', despues = '' }) {
  return `
      <div class="form-group">
        <label for="${id}">${etiqueta}</label>
        <div class="campo-contrasena">
          <input type="password" id="${id}" name="${id}" autocomplete="${autocomplete}" ${atributos} placeholder="${escapeHtml(placeholder)}" class="form-control">
          <button type="button" class="boton-ojo" aria-label="Mostrar contraseña" aria-pressed="false" aria-controls="${id}" data-on-click="togglePass('${id}')">${ICONO_OJO}</button>
        </div>${despues}
      </div>`;
}

// Sugerencia de @gmail.com mientras se escribe el correo: nunca cambia lo escrito,
// solo ofrece una opción. Devuelve '' cuando no hay nada que sugerir:
//   "ana" → "ana@gmail.com"; "ana@gm" → "ana@gmail.com";
//   "ana@hotmail.com" (otro dominio) o "ana@gmail.com" (ya completo) → "".
export function sugerenciaGmail(valor) {
  const texto = String(valor || '').trim();
  if (!texto || /\s/.test(texto)) return '';
  const partes = texto.split('@');
  if (partes.length > 2 || !partes[0]) return '';
  const [usuario, dominio = ''] = partes;
  const resto = dominio.toLowerCase();
  if (resto === 'gmail.com' || !'gmail.com'.startsWith(resto)) return '';
  return `${usuario}@gmail.com`;
}

// La sugerencia va en un <datalist> (lista nativa y accesible) que convive con el
// autocompletado del navegador (autocomplete="email").
export function sugerirGmail(campo) {
  const lista = document.getElementById(campo?.getAttribute?.('list'));
  if (!lista) return;
  const sugerencia = sugerenciaGmail(campo.value);
  lista.innerHTML = sugerencia ? `<option value="${escapeHtml(sugerencia)}"></option>` : '';
}

// Correo con su etiqueta enlazada y la lista de sugerencias.
export function campoCorreo({ id, valor = '', etiqueta = 'Correo Gmail' }) {
  return `
      <div class="form-group">
        <label for="${id}">${etiqueta}</label>
        <input type="email" id="${id}" name="email" autocomplete="email" inputmode="email" required value="${escapeHtml(valor)}" placeholder="usuario@gmail.com" list="${id}Sugerencias" data-on-input="sugerirGmail(this)" class="form-control">
        <datalist id="${id}Sugerencias"></datalist>
      </div>`;
}

export function renderLoginForm(identifier = '') {
  return `
    <form data-on-submit="handleLogin(event)">${campoCorreo({ id: 'loginEmail', valor: identifier.includes('@') ? identifier : '' })}${campoContrasena({ id: 'loginPassword', etiqueta: 'Contraseña', autocomplete: 'current-password', placeholder: 'Contraseña', atributos: 'required' })}
      <div>
        <button type="button" data-on-click="handleForgotPassword()">¿Olvidaste tu contraseña?</button>
      </div>
      <button type="submit" class="btn btn-primary">Ingresar al sistema</button>
    </form>
  `;
}

export function renderRegisterForm() {
  return `
    <form data-on-submit="handleRegister(event)">
      <div class="form-group">
        <label for="regName">Nombre Completo</label>
        <input type="text" id="regName" name="name" autocomplete="name" required minlength="3" value="${escapeHtml(estado.pendingRegistration?.nombre_completo || '')}" placeholder="Ej: Juan Pérez" class="form-control">
      </div>
${campoCorreo({ id: 'regEmail', valor: estado.pendingRegistration?.correo || '' })}${campoContrasena({
        id: 'regPass', etiqueta: 'Contraseña (mínimo 8 caracteres)', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres',
        atributos: 'required minlength="8" aria-describedby="passwordStrength" data-on-input="updatePasswordStrength()"',
        despues: '\n        <div id="passwordStrength" aria-live="polite">Fortaleza de la contraseña: sin evaluar</div>'
      })}${campoContrasena({ id: 'regPassConfirm', etiqueta: 'Confirmar contraseña', autocomplete: 'new-password', placeholder: 'Repita la contraseña', atributos: 'required minlength="8"' })}
      <!-- El enlace es un botón dentro de la etiqueta: tocarlo abre el modal y no tilda la casilla -->
      <label>
        <input type="checkbox" id="regTerms" required>
        <span>He leído y acepto las <button type="button" id="regTermsLink" class="link-inline" aria-haspopup="dialog" data-on-click="abrirBasesModal()">bases y condiciones</button></span>
      </label>
      <button type="submit" class="btn btn-red">Enviar código al Gmail</button>
    </form>
  `;
}

// Muestra u oculta la contraseña y deja el botón del ojo en el estado correcto.
export function togglePass(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const visible = el.type === 'password';
  el.type = visible ? 'text' : 'password';
  const boton = document.querySelector(`.boton-ojo[aria-controls="${id}"]`);
  boton?.setAttribute('aria-pressed', String(visible));
  boton?.classList.toggle('boton-ojo-activo', visible);
}

export function showAuthFeedback(message) {
  const feedback = document.getElementById('authFeedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove('hidden');
}

export function handleAuthError(error) {
  console.error('Error de autenticación:', error?.status, error?.message);
  showAuthFeedback(error.message || 'No se pudo completar la solicitud.');
}

export function updatePasswordStrength() {
  const password = document.getElementById('regPass').value;
  const score = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password)
  ].filter(Boolean).length;
  const labels = ['sin evaluar', 'débil', 'media', 'buena', 'fuerte'];
  const indicator = document.getElementById('passwordStrength');
  indicator.textContent = `Fortaleza de la contraseña: ${labels[score]}`;
  indicator.classList.toggle('password-weak', score < 2);
  indicator.classList.toggle('password-medium', score >= 2 && score < 4);
  indicator.classList.toggle('password-strong', score >= 4);
}

export async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  try {
    const result = await apiRequest('/auth/login', { method: 'POST', body: { correo: email, contrasena: password } });
    sessionStorage.setItem('rastreo_token', result.token);
    terminarVerificacion();
    window.backendCurrentUser = result.usuario;
    recordarUsuario(result.usuario);
    const destino = consumePendingDestination();
    navigateTo(destino ? destino.view : 'home', destino ? destino.params : {}, { replace: true });
  } catch (error) {
    handleAuthError(error);
  }
}

export async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPass').value;
  const confirmation = document.getElementById('regPassConfirm').value;
  if (name.length < 3) {
    showAuthFeedback('El nombre completo debe tener al menos 3 caracteres.');
    return;
  }
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    showAuthFeedback('Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');
    return;
  }
  if (password.length < 8) {
    showAuthFeedback('La contraseña debe tener al menos 8 caracteres.');
    return;
  }
  if (password !== confirmation) {
    showAuthFeedback('Las contraseñas no coinciden.');
    return;
  }
  if (!document.getElementById('regTerms').checked) {
    showAuthFeedback('Debe aceptar las bases y condiciones para registrarse.');
    return;
  }

  try {
    estado.pendingRegistration = {
      nombre_completo: name,
      correo: email,
      contrasena: password,
      acepto_terminos: true
    };
    await apiRequest('/auth/registro', { method: 'POST', body: estado.pendingRegistration });
    iniciarVerificacion(email, 'registro');
  } catch (error) {
    handleAuthError(error);
  }
}

export async function handleForgotPassword() {
  const value = prompt('Ingresa tu Gmail para restablecer la contraseña:');
  if (!value) return;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    showAuthFeedback('Ingrese una cuenta de Gmail válida (terminada en @gmail.com).');
    return;
  }
  try {
    await apiRequest('/auth/restablecer/solicitar', { method: 'POST', body: { correo: email } });
    iniciarVerificacion(email, 'restablecer');
  } catch (error) {
    handleAuthError(error);
  }
}

// ==========================================
// PANTALLA DEL CÓDIGO (#/verificar)
// ==========================================
// Correo, propósito y próximo reenvío quedan en sessionStorage (verificacion.js)
// para que recargar la página no pierda el flujo. Nunca la contraseña ni el código.

// Empieza un flujo nuevo (registro o restablecer): reemplaza lo guardado del
// anterior y espera 60 s antes del primer reenvío, como el servidor.
function iniciarVerificacion(correo, proposito) {
  estado.activeOtpEmail = correo;
  estado.activeOtpPurpose = proposito;
  startResendCountdown(60);
  navigateTo('otp', { contact: correo, purpose: proposito });
}

function detenerCuentaRegresiva() {
  if (estado.resendTimer) clearInterval(estado.resendTimer);
  estado.resendTimer = null;
  estado.resendSeconds = 0;
}

// Sale del flujo del código: verificación exitosa, otro correo, volver al ingreso,
// iniciar o cerrar sesión. Borra lo guardado.
export function terminarVerificacion() {
  detenerCuentaRegresiva();
  borrarVerificacion();
  estado.activeOtpEmail = '';
  estado.activeOtpPurpose = 'registro';
}

// Después de recargar #/verificar: vuelve al flujo con lo guardado. false si no hay.
export function restaurarVerificacion() {
  if (estado.activeOtpEmail) return true;
  const guardado = leerVerificacion();
  if (!guardado) return false;
  estado.activeOtpEmail = guardado.correo;
  estado.activeOtpPurpose = guardado.proposito;
  startResendCountdown(segundosParaReenviar(guardado.proximoReenvio));
  return true;
}

export function startResendCountdown(seconds) {
  detenerCuentaRegresiva();
  estado.resendSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  guardarVerificacion({
    correo: estado.activeOtpEmail,
    proposito: estado.activeOtpPurpose,
    proximoReenvio: Date.now() + estado.resendSeconds * 1000
  });
  updateResendButton();
  if (!estado.resendSeconds) return;
  estado.resendTimer = setInterval(() => {
    estado.resendSeconds -= 1;
    updateResendButton();
    if (estado.resendSeconds <= 0) detenerCuentaRegresiva();
  }, 1000);
}

function textoReenviar() {
  return estado.resendSeconds > 0 ? `Reenviar código (en ${textoEspera(estado.resendSeconds)})` : 'Reenviar código';
}

export function updateResendButton() {
  const button = document.getElementById('resendCodeButton');
  if (!button) return;
  button.disabled = estado.resendSeconds > 0;
  button.textContent = textoReenviar();
}

export function renderOTPView(params = {}) {
  estado.activeOtpEmail = params.contact || estado.activeOtpEmail;
  estado.activeOtpPurpose = params.purpose || estado.activeOtpPurpose;
  const isReset = estado.activeOtpPurpose === 'restablecer';
  const correo = `<strong>${escapeHtml(estado.activeOtpEmail)}</strong>`;
  // En la recuperación nunca se dice si el correo tiene cuenta.
  const introMessage = isReset
    ? `Si ${correo} está registrado, te enviamos un código de 6 dígitos para crear una contraseña nueva.`
    : `Enviamos un código de 6 dígitos a ${correo}.`;
  return `
    <div class="otp-view">
      <div class="card">
        <h3>${isReset ? 'Restablecer contraseña' : 'Verificar correo'}</h3>
        <p>${introMessage}</p>
        <p class="otp-ayuda">El código vence en 10 minutos. Si no lo ves, revisá la carpeta de spam.</p>
        <form data-on-submit="verifyEmailCode(event)" novalidate>
          <div class="form-group">
            <label for="otpInput">Código de 6 dígitos</label>
            <input type="text" id="otpInput" name="one-time-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required class="form-control">
          </div>
          ${isReset ? `${campoContrasena({ id: 'resetPassword', etiqueta: 'Nueva contraseña', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres', atributos: 'minlength="8"' })}${campoContrasena({ id: 'resetPasswordConfirm', etiqueta: 'Confirmar contraseña', autocomplete: 'new-password', placeholder: 'Repita la contraseña', atributos: 'minlength="8"' })}` : ''}
          <div id="otpFeedback" class="hidden" role="status"></div>
          <button type="submit" class="btn btn-primary">${isReset ? 'Cambiar contraseña' : 'Verificar y crear cuenta'}</button>
        </form>
        <div class="otp-acciones">
          <button type="button" id="resendCodeButton" data-on-click="resendVerificationCode()" class="btn btn-outline" ${estado.resendSeconds > 0 ? 'disabled' : ''}>${textoReenviar()}</button>
          ${!isReset ? '<button type="button" data-on-click="changeRegistrationEmail()" class="btn btn-outline">Usar otro correo</button>' : ''}
          <button type="button" data-on-click="salirDeVerificacion()" class="btn btn-outline">Volver al inicio de sesión</button>
        </div>
      </div>
    </div>
  `;
}

// accion (opcional): { texto, enClic } agrega un botón al aviso, p. ej. para volver
// a completar el registro.
export function showOtpFeedback(message, accion) {
  const feedback = document.getElementById('otpFeedback');
  if (!feedback) return;
  feedback.textContent = message;
  if (accion) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn-outline btn-sm';
    boton.textContent = accion.texto;
    boton.setAttribute('data-on-click', accion.enClic);
    feedback.append(' ', boton);
  }
  feedback.classList.remove('hidden');
}

// Mensaje de un 429 con la espera real (reintentarEn del servidor). Si hay que
// esperar, el botón de reenvío queda bloqueado ese tiempo.
function avisoDeLimite(error) {
  const espera = Number(error.reintentarEn);
  if (error.status === 429 && espera > 0) {
    startResendCountdown(espera);
    return `${error.message} Podés pedir otro código en ${textoEspera(espera)}.`;
  }
  return error.message;
}

export async function verifyEmailCode(event) {
  event?.preventDefault?.();
  const code = document.getElementById('otpInput').value.trim();
  if (!/^\d{6}$/.test(code)) {
    showOtpFeedback('Ingrese un código válido de 6 dígitos.');
    return;
  }
  if (estado.activeOtpPurpose === 'restablecer') {
    const password = document.getElementById('resetPassword').value;
    const confirmation = document.getElementById('resetPasswordConfirm').value;
    if (password.length < 8) return showOtpFeedback('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirmation) return showOtpFeedback('Las contraseñas no coinciden.');
    try {
      await apiRequest('/auth/restablecer/confirmar', {
        method: 'POST',
        body: { correo: estado.activeOtpEmail, codigo: code, nueva_contrasena: password }
      });
      const correo = estado.activeOtpEmail;
      terminarVerificacion();
      estado.pendingRegistration = null;
      window.authNotice = 'La contraseña se actualizó correctamente. Inicie sesión.';
      navigateTo('auth', { authMode: 'login', identifier: correo });
    } catch (error) {
      showOtpFeedback(mensajeDeVerificacion(error));
    }
    return;
  }
  try {
    await apiRequest('/auth/verificar', {
      method: 'POST',
      body: { correo: estado.activeOtpEmail, codigo: code }
    });
    const correo = estado.activeOtpEmail;
    terminarVerificacion();
    estado.pendingRegistration = null;
    window.authNotice = 'Cuenta creada correctamente. Ya puede iniciar sesión.';
    navigateTo('auth', { authMode: 'login', identifier: correo });
  } catch (error) {
    showOtpFeedback(mensajeDeVerificacion(error));
  }
}

// Tras 5 intentos fallidos el servidor borra el código (429, reintentarEn 0): hay
// que pedir uno nuevo con "Reenviar código".
function mensajeDeVerificacion(error) {
  if (error.status === 429 && Number(error.reintentarEn) === 0) {
    return `${error.message} Tocá «Reenviar código» para recibir uno nuevo.`;
  }
  return avisoDeLimite(error);
}

export async function resendVerificationCode() {
  if (estado.resendSeconds > 0) return;
  try {
    if (estado.activeOtpPurpose === 'restablecer') {
      // Respuesta igual exista o no la cuenta.
      const res = await apiRequest('/auth/restablecer/solicitar', {
        method: 'POST',
        body: { correo: estado.activeOtpEmail }
      });
      startResendCountdown(60);
      showOtpFeedback(res?.mensaje || 'Si el Gmail está registrado, recibirá un código nuevo.');
      return;
    }
    try {
      await apiRequest('/auth/registro/reenviar', { method: 'POST', body: { correo: estado.activeOtpEmail } });
    } catch (error) {
      // 400: ya no hay registro pendiente (el código se borró tras 5 intentos
      // fallidos): se vuelve a enviar el registro.
      if (error.status === 400) return reenviarRegistro();
      throw error;
    }
    startResendCountdown(60);
    showOtpFeedback('Enviamos un código nuevo a tu Gmail.');
  } catch (error) {
    showOtpFeedback(avisoDeLimite(error));
  }
}

// El mismo /auth/registro del formulario (cuenta para el límite de 5 por hora), con
// los datos que quedaron en memoria. Si ya no están (la página se recargó: la
// contraseña nunca se guarda), se pide completar el registro de nuevo.
async function reenviarRegistro() {
  const datos = estado.pendingRegistration;
  if (!datos?.contrasena || datos.correo !== estado.activeOtpEmail) {
    showOtpFeedback('Ese código ya no sirve y, por seguridad, los datos del registro no se guardan en el navegador. Completá el registro de nuevo para recibir otro código.',
      { texto: 'Completar el registro', enClic: 'completarRegistroDeNuevo()' });
    return;
  }
  try {
    await apiRequest('/auth/registro', { method: 'POST', body: datos });
    startResendCountdown(60);
    showOtpFeedback('Enviamos un código nuevo a tu Gmail.');
  } catch (error) {
    showOtpFeedback(avisoDeLimite(error));
  }
}

// Vuelve al formulario de registro con el correo ya escrito.
export function completarRegistroDeNuevo() {
  const correo = estado.activeOtpEmail;
  terminarVerificacion();
  estado.pendingRegistration = { correo };
  navigateTo('auth', { authMode: 'register' });
}

// "Usar otro correo": conserva el nombre y vuelve al registro con el correo vacío.
export async function changeRegistrationEmail() {
  const nombre = estado.pendingRegistration?.nombre_completo;
  terminarVerificacion();
  estado.pendingRegistration = nombre ? { nombre_completo: nombre } : null;
  await navigateTo('auth', { authMode: 'register' });
  document.getElementById('regEmail')?.focus();
}

export function salirDeVerificacion() {
  terminarVerificacion();
  estado.pendingRegistration = null;
  navigateTo('auth', { authMode: 'login' });
}

export async function logout() {
  if (estado.notificationRefreshTimer) {
    clearInterval(estado.notificationRefreshTimer);
    estado.notificationRefreshTimer = null;
  }
  // Antes de borrar el token: el servidor solo borra endpoints de esta cuenta.
  await darDeBajaEsteDispositivo();
  olvidarSesion();
  terminarVerificacion();
  window.backendCurrentUser = null;
  window.backendCaseData = null;
  estado.pendingDestination = null;
  navigateTo('auth', { authMode: 'login' });
}
