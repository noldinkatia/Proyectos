// "Notificaciones y alertas" (web y app): un solo interruptor en el menú y una
// tarjeta propia que se ofrece después de iniciar sesión. El cuadro del navegador
// (Notification.requestPermission) se pide solo al tocar "Activar" o el
// interruptor, dentro de ese toque: así funciona en iPhone y en Chrome.
// Las reglas (cuándo ofrecer la tarjeta, qué estado mostrar) están en
// avisos-reglas.js; lo que habla con el navegador y el servidor, en /app/zona.js
// (también lo usa la web) y en notifications.js.
import { esIos, yaInstalada } from '../app/pwa.js';
import { borrarZona, consultarZona, guardarZona, obtenerUbicacion, soportaPush, suscripcionDelDispositivo } from '../app/zona.js';
import { disponibilidadAvisos, estadoInterruptor, guardarEstadoAvisos, leerEstadoAvisos, registrarAhoraNo, tarjetaAMostrar } from './avisos-reglas.js';
import { escapeHtml } from './config.js';
import { iniciarAvisosDelSistema } from './notifications.js';
import { RADIO_ALERTA_KM } from './radio-alerta.js';
import { fillSelect, loadParaguayLocations, ubicarZona } from './report.js';
import { debeAceptarBases } from './sesion.js';
import { showToast } from './ui.js';

let pasoTarjeta = null;
let focoPrevio = null;
let zonaActiva = null;

const usuario = () => window.backendCurrentUser || null;
const almacen = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};
const leer = () => leerEstadoAvisos(almacen(), usuario()?.id);
const guardar = estado => guardarEstadoAvisos(almacen(), usuario()?.id, estado);
const permisoActual = () => ('Notification' in window ? Notification.permission : 'default');
const esCiudadano = () => String(usuario()?.rol || '').toLowerCase() === 'ciudadano';
// Solo la app tiene la guía de instalación en iOS; la web lleva a la app.
const hayGuiaInstalacion = () => Boolean(document.getElementById('installGuideModal'));

function disponibilidad() {
  return disponibilidadAvisos({
    notificaciones: 'Notification' in window,
    push: soportaPush(),
    ios: esIos(),
    instalada: yaInstalada()
  });
}

function estadoActual() {
  return estadoInterruptor({ permiso: permisoActual(), disponibilidad: disponibilidad(), desactivadas: leer().desactivadas });
}

// Anuncio para lectores de pantalla, aunque el menú esté cerrado.
function anunciar(texto) {
  const region = document.getElementById('avisosAnuncio');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => { region.textContent = texto; }, 50);
}

// Navegadores viejos (Safari < 15) responden por callback y no con una promesa.
function pedirPermiso() {
  return new Promise(resolve => {
    const resultado = Notification.requestPermission(resolve);
    if (resultado?.then) resultado.then(resolve);
  });
}

function botonInstalacion(clase = 'btn btn-outline btn-sm') {
  return hayGuiaInstalacion()
    ? `<button type="button" class="${clase}" data-on-click="verGuiaInstalacionAvisos()">Cómo instalar la app</button>`
    : `<a class="${clase}" href="/app/">Abrir la app</a>`;
}

// INTERRUPTOR DEL MENÚ
const TEXTOS = {
  desactivadas: ['Desactivadas. No recibís avisos en este dispositivo.'],
  bloqueadas: [
    'Bloqueadas por el navegador.',
    'Para habilitarlas, tocá el candado junto a la dirección › Configuración del sitio › Notificaciones › Permitir, y recargá la página.'
  ],
  instalar: ['No disponibles en este dispositivo: en iPhone y iPad funcionan solo con la app instalada en la pantalla de inicio.'],
  'no-soportado': ['No disponibles en este navegador. Probá con Chrome, Edge, Firefox o Safari actualizados.']
};

export async function actualizarInterruptor() {
  const control = document.getElementById('avisosControl');
  const interruptor = document.getElementById('avisosInterruptor');
  if (!control || !interruptor || !esCiudadano()) return;
  const estado = estadoActual();
  const activas = estado === 'activadas';
  const usable = activas || estado === 'desactivadas';
  interruptor.setAttribute('aria-checked', String(activas));
  interruptor.disabled = !usable;
  control.dataset.estado = estado;
  let lineas = TEXTOS[estado];
  let acciones = estado === 'instalar' ? botonInstalacion() : '';
  if (activas) {
    if (zonaActiva === null) {
      try {
        zonaActiva = Boolean((await consultarZona()).activa);
      } catch {
        zonaActiva = false;
      }
    }
    lineas = zonaActiva
      ? [`Activadas. Te avisamos de casos a ${RADIO_ALERTA_KM} km o menos de tu zona.`]
      : ['Activadas, sin alertas de zona: te avisamos de novedades de tus casos y pistas.'];
    acciones = `<button type="button" class="btn btn-outline btn-sm" data-on-click="elegirZonaDesdeMenu()">${zonaActiva ? 'Cambiar mi zona' : 'Agregar mi zona'}</button>`;
  }
  const estadoTexto = document.getElementById('avisosEstado');
  const html = lineas.map(linea => `<span>${escapeHtml(linea)}</span>`).join('');
  // Solo si cambió: la región es aria-live y no tiene que repetirse al abrir el menú.
  if (estadoTexto && estadoTexto.innerHTML !== html) estadoTexto.innerHTML = html;
  const contenedor = document.getElementById('avisosAcciones');
  if (contenedor) contenedor.innerHTML = acciones;
}

export function alternarAvisos() {
  const estado = estadoActual();
  if (estado === 'activadas') return desactivarAvisos();
  if (estado === 'desactivadas') return activarAvisos();
  return actualizarInterruptor();
}

// Apagar: baja de la suscripción push (navegador y servidor) y de las alertas de
// zona. El permiso del navegador no se puede revocar desde la página.
async function desactivarAvisos() {
  guardar({ ...leer(), desactivadas: true });
  try {
    await borrarZona();
    showToast('Notificaciones desactivadas', 'Se borró tu zona y no vas a recibir más avisos en este dispositivo.', 'success');
  } catch (error) {
    showToast('No se pudo avisar al servidor', `${error.message} Este dispositivo ya no recibe avisos; volvé a intentarlo con conexión para borrar tu zona.`, 'error');
  }
  zonaActiva = false;
  await actualizarInterruptor();
  anunciar('Notificaciones y alertas desactivadas.');
}

// "Activar" de la tarjeta o el interruptor encendido. Lo primero es el cuadro del
// navegador, sin esperas antes, para que cuente como respuesta al toque.
export async function activarAvisos() {
  if (!('Notification' in window)) return actualizarInterruptor();
  const permiso = Notification.permission === 'granted' ? 'granted' : await pedirPermiso();
  guardar({ ...leer(), desactivadas: false });
  if (permiso !== 'granted') {
    cerrarTarjeta();
    await actualizarInterruptor();
    const bloqueadas = permiso === 'denied';
    showToast(bloqueadas ? 'Notificaciones bloqueadas' : 'Notificaciones sin activar',
      bloqueadas ? 'Las bloqueaste en el navegador. Podés habilitarlas desde la configuración del sitio.' : 'Podés activarlas cuando quieras desde el menú.', 'error');
    anunciar(bloqueadas ? 'Notificaciones bloqueadas por el navegador.' : 'Notificaciones sin activar.');
    return;
  }
  try {
    await iniciarAvisosDelSistema();
  } catch (error) {
    console.error('No se pudo preparar los avisos del sistema:', error.message);
  }
  await actualizarInterruptor();
  anunciar('Notificaciones activadas.');
  abrirTarjeta('zona');
}

// TARJETA
function contenidoTarjeta(paso) {
  if (paso === 'pedir') {
    return {
      titulo: '¿Querés recibir alertas de casos cerca tuyo?',
      html: `<p>Te avisamos cuando se reporta una persona desaparecida cerca de tu zona y cuando hay novedades de tus casos y pistas. Podés desactivarlo cuando quieras desde el menú.</p>
        <div class="avisos-botones">
          <button type="button" class="btn btn-primary" data-on-click="activarAvisos()">Activar</button>
          <button type="button" class="btn btn-outline" data-on-click="ahoraNoAvisos()">Ahora no</button>
        </div>`
    };
  }
  if (paso === 'instalar') {
    return {
      titulo: 'Instalá la app para recibir alertas',
      html: `<p>En iPhone y iPad las alertas llegan solo si Rastreo PY está instalada en la pantalla de inicio. Instalala y abrila desde su ícono para activarlas.</p>
        <div class="avisos-botones">
          ${botonInstalacion('btn btn-primary')}
          <button type="button" class="btn btn-outline" data-on-click="ahoraNoAvisos()">Ahora no</button>
        </div>`
    };
  }
  return {
    titulo: '¿Dónde querés recibir alertas?',
    html: `<p>Usamos tu zona aproximada (≈1 km) solo para avisarte de casos a ${RADIO_ALERTA_KM} km o menos. No se muestra a otras personas y se borra al desactivar las notificaciones.</p>
      <p class="muted">Al elegir una opción aceptás que Rastreo PY guarde esa ubicación aproximada.</p>
      <div class="avisos-botones">
        <button type="button" class="btn btn-primary" data-on-click="usarMiUbicacionAvisos()">Usar mi ubicación</button>
        <button type="button" class="btn btn-outline" data-on-click="elegirZonaAvisos()">Elegir zona</button>
      </div>
      <div id="avisosZonaLista" class="avisos-zona-lista hidden">
        <label for="avisosDepartamento">Departamento</label>
        <select id="avisosDepartamento" class="form-control" data-on-change="cambiarDepartamentoAvisos()"><option value="">Cargando…</option></select>
        <label for="avisosCiudad">Ciudad</label>
        <select id="avisosCiudad" class="form-control" disabled><option value="">Elegí un departamento</option></select>
        <button type="button" class="btn btn-primary" data-on-click="guardarZonaElegidaAvisos()">Guardar zona</button>
      </div>
      <p id="avisosTarjetaProgreso" class="muted" role="status"></p>
      <p id="avisosTarjetaError" class="dialogo-error" role="alert"></p>
      <button type="button" class="link-inline" data-on-click="omitirZonaAvisos()">Omitir por ahora</button>`
  };
}

function abrirTarjeta(paso) {
  const tarjeta = document.getElementById('avisosTarjeta');
  if (!tarjeta) return;
  if (tarjeta.classList.contains('hidden')) focoPrevio = document.activeElement;
  pasoTarjeta = paso;
  const { titulo, html } = contenidoTarjeta(paso);
  document.getElementById('avisosTarjetaTitulo').textContent = titulo;
  document.getElementById('avisosTarjetaContenido').innerHTML = html;
  tarjeta.classList.remove('hidden');
  document.getElementById('avisosTarjetaTitulo').focus();
}

function cerrarTarjeta() {
  const tarjeta = document.getElementById('avisosTarjeta');
  if (!tarjeta || tarjeta.classList.contains('hidden')) return;
  tarjeta.classList.add('hidden');
  pasoTarjeta = null;
  const destino = focoPrevio?.isConnected && focoPrevio !== document.body ? focoPrevio : document.getElementById('mainContent');
  focoPrevio = null;
  if (destino && !destino.hasAttribute('tabindex') && destino.id === 'mainContent') destino.setAttribute('tabindex', '-1');
  destino?.focus?.();
}

// X y Escape: en el primer paso valen como "Ahora no"; en el de la zona, como omitirla.
export function cerrarTarjetaAvisos() {
  if (pasoTarjeta === 'zona') return omitirZonaAvisos();
  return ahoraNoAvisos();
}

export function ahoraNoAvisos() {
  guardar(registrarAhoraNo(leer(), Date.now()));
  cerrarTarjeta();
}

export function verGuiaInstalacionAvisos() {
  cerrarTarjeta();
  document.getElementById('installGuideModal')?.classList.remove('hidden');
}

function mostrarError(texto) {
  const error = document.getElementById('avisosTarjetaError');
  if (error) error.textContent = texto;
}

// Mientras se guarda: botones deshabilitados y "Guardando…" (la ubicación y el
// servicio push pueden tardar varios segundos).
function ocupada(si) {
  document.querySelectorAll('#avisosTarjetaContenido button, #avisosTarjetaContenido select')
    .forEach(control => { control.disabled = si; });
  document.getElementById('avisosTarjetaContenido')?.setAttribute('aria-busy', String(si));
  if (si) mostrarError('');
  const progreso = document.getElementById('avisosTarjetaProgreso');
  if (progreso) progreso.textContent = si ? 'Guardando tu zona…' : '';
}

async function guardarUbicacion(obtener) {
  ocupada(true);
  try {
    const ubicacion = await obtener();
    if (!ubicacion) throw new Error('No encontramos esa ciudad en el mapa. Probá con otra cercana o usá tu ubicación.');
    const { sinPush } = await guardarZona(ubicacion);
    zonaActiva = true;
    cerrarTarjeta();
    await actualizarInterruptor();
    if (sinPush) {
      showToast('Zona guardada, sin avisos en el dispositivo',
        'Este navegador no pudo activar los avisos push: vas a ver las alertas de tu zona en el centro de notificaciones. Podés reintentarlo desde el menú, con "Cambiar mi zona".');
      anunciar('Zona guardada. Las alertas se verán en el centro de notificaciones.');
    } else {
      showToast('Alertas de tu zona activadas', `Te avisaremos de casos a ${RADIO_ALERTA_KM} km o menos.`, 'success');
      anunciar('Alertas de tu zona activadas.');
    }
  } catch (error) {
    ocupada(false);
    mostrarError(error.message);
  }
}

export function usarMiUbicacionAvisos() {
  return guardarUbicacion(obtenerUbicacion);
}

export async function elegirZonaAvisos() {
  mostrarError('');
  document.getElementById('avisosZonaLista')?.classList.remove('hidden');
  const departamento = document.getElementById('avisosDepartamento');
  try {
    const departamentos = await loadParaguayLocations();
    fillSelect(departamento, 'Elegí un departamento', departamentos.map(item => item.departamento));
    departamento.focus();
  } catch (error) {
    mostrarError(error.message);
  }
}

export async function cambiarDepartamentoAvisos() {
  const departamentos = await loadParaguayLocations();
  const elegido = departamentos.find(item => item.departamento === document.getElementById('avisosDepartamento').value);
  fillSelect(document.getElementById('avisosCiudad'), elegido ? 'Elegí una ciudad' : 'Elegí un departamento',
    elegido ? elegido.ciudades.map(item => item.ciudad) : []);
}

export async function guardarZonaElegidaAvisos() {
  mostrarError('');
  const departamento = document.getElementById('avisosDepartamento')?.value;
  const ciudad = document.getElementById('avisosCiudad')?.value;
  if (!departamento || !ciudad) {
    mostrarError('Elegí el departamento y la ciudad.');
    return;
  }
  return guardarUbicacion(() => ubicarZona([ciudad, departamento]));
}

export function omitirZonaAvisos() {
  cerrarTarjeta();
  showToast('Notificaciones activadas, sin alertas de zona',
    'Te avisamos de novedades de tus casos y pistas. Para recibir alertas de casos cercanos, agregá tu zona desde el menú, en "Notificaciones y alertas".');
  anunciar('Notificaciones activadas, sin alertas de zona.');
}

// "Agregar / Cambiar mi zona" del menú.
export function elegirZonaDesdeMenu() {
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('drawerOverlay')?.classList.add('hidden');
  abrirTarjeta('zona');
}

// Después de iniciar sesión (y de aceptar las bases, si faltaba): la tarjeta, si
// corresponde. Nunca pide el permiso del navegador por sí sola.
export async function ofrecerAvisosTrasIngreso() {
  const actual = usuario();
  if (!actual || debeAceptarBases(actual)) return;
  zonaActiva = null;
  try {
    const disp = disponibilidad();
    const suscripcionActiva = disp === 'ok' && Boolean(await suscripcionDelDispositivo());
    const tipo = tarjetaAMostrar({
      rol: actual.rol, permiso: permisoActual(), disponibilidad: disp, suscripcionActiva, estado: leer(), ahora: Date.now()
    });
    if (tipo) abrirTarjeta(tipo === 'activar' ? 'pedir' : 'instalar');
  } catch (error) {
    // Nunca bloquea el ingreso: la persona puede activarlas desde el menú.
    console.error('No se pudo ofrecer la activación de notificaciones:', error.message);
  }
}

export function iniciarAvisos() {
  // El estado se recalcula al abrir el menú (el permiso puede cambiar desde la
  // configuración del navegador).
  document.addEventListener('rastreo:menu-abierto', () => { actualizarInterruptor(); });
  document.getElementById('avisosTarjeta')?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cerrarTarjetaAvisos();
    }
  });
}
