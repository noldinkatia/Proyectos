// Cuadros de diálogo propios en lugar de prompt() y confirm() del navegador: un
// <dialog> nativo (Esc cancela y el resto de la página queda inerte). Un solo
// componente para todo: pedir un motivo obligatorio, confirmar una acción o exigir
// una casilla (declaración de responsabilidad del reporte).
//   pedirMotivo(...)  → el motivo (sin espacios de más) o null si se canceló
//   confirmar(...)    → true o false
// Al cerrarse, el foco vuelve al botón que lo abrió.
import { escapeHtml } from './config.js';

let contador = 0;

// Valida lo que se completó. Devuelve el mensaje de error o '' si se puede seguir.
// El motivo se valida sin espacios: "   " no cuenta (el servidor también lo rechaza).
export function validarDialogo({ motivo, casillaMarcada } = {}, { pideMotivo = false, minimo = 1, pideCasilla = false } = {}) {
  if (pideMotivo && String(motivo ?? '').trim().length < minimo) {
    return minimo > 1 ? `Escribí el motivo (al menos ${minimo} caracteres) para continuar.` : 'Escribí el motivo para continuar.';
  }
  if (pideCasilla && !casillaMarcada) return 'Marcá la casilla para continuar.';
  return '';
}

// Abre el cuadro y resuelve con { confirmado, motivo } al aceptar o cancelar.
// opciones: titulo, mensaje (texto) o contenidoHtml (ya escapado), motivo:
// { etiqueta, ayuda, minimo }, casilla (texto), textoConfirmar, textoCancelar, peligro.
export function abrirDialogo(opciones) {
  const {
    titulo, mensaje = '', contenidoHtml = '', motivo = null, casilla = '',
    textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar', peligro = false
  } = opciones;
  const n = (contador += 1);
  const origen = document.activeElement;
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo';
  dialogo.setAttribute('aria-labelledby', `dialogo-titulo-${n}`);
  if (mensaje || contenidoHtml) dialogo.setAttribute('aria-describedby', `dialogo-texto-${n}`);
  dialogo.innerHTML = `
    <form method="dialog" class="dialogo-formulario" novalidate>
      <h2 id="dialogo-titulo-${n}" class="dialogo-titulo">${escapeHtml(titulo)}</h2>
      ${mensaje || contenidoHtml ? `<div id="dialogo-texto-${n}" class="dialogo-texto">${contenidoHtml || `<p>${escapeHtml(mensaje)}</p>`}</div>` : ''}
      ${motivo ? `
        <label for="dialogo-motivo-${n}" class="dialogo-etiqueta">${escapeHtml(motivo.etiqueta || 'Motivo')}</label>
        ${motivo.ayuda ? `<p id="dialogo-ayuda-${n}" class="dialogo-ayuda">${escapeHtml(motivo.ayuda)}</p>` : ''}
        <textarea id="dialogo-motivo-${n}" class="form-control dialogo-motivo" rows="3" required
          aria-describedby="${motivo.ayuda ? `dialogo-ayuda-${n} ` : ''}dialogo-error-${n}"></textarea>` : ''}
      ${casilla ? `
        <label class="check-fila dialogo-casilla"><input type="checkbox" class="dialogo-check" required aria-describedby="dialogo-error-${n}"><span class="check-fila-texto">${escapeHtml(casilla)}</span></label>` : ''}
      <p id="dialogo-error-${n}" class="dialogo-error" role="alert"></p>
      <div class="dialogo-botones">
        <button type="button" class="btn btn-outline dialogo-cancelar">${escapeHtml(textoCancelar)}</button>
        <button type="submit" class="btn ${peligro ? 'btn-red' : 'btn-primary'} dialogo-confirmar">${escapeHtml(textoConfirmar)}</button>
      </div>
    </form>`;
  document.body.append(dialogo);

  const campo = dialogo.querySelector('.dialogo-motivo');
  const check = dialogo.querySelector('.dialogo-check');
  const error = dialogo.querySelector('.dialogo-error');
  return new Promise(resolver => {
    let resultado = { confirmado: false, motivo: null };
    const mostrarError = texto => {
      error.textContent = texto;
      const destino = texto.includes('casilla') ? check : campo;
      destino?.setAttribute('aria-invalid', 'true');
      destino?.focus();
    };
    dialogo.querySelector('form').addEventListener('submit', evento => {
      evento.preventDefault();
      const texto = validarDialogo(
        { motivo: campo?.value, casillaMarcada: check?.checked },
        { pideMotivo: Boolean(motivo), minimo: motivo?.minimo || 1, pideCasilla: Boolean(casilla) }
      );
      if (texto) return mostrarError(texto);
      resultado = { confirmado: true, motivo: campo ? campo.value.trim() : null };
      dialogo.close();
    });
    for (const elemento of [campo, check]) {
      elemento?.addEventListener('input', () => { elemento.removeAttribute('aria-invalid'); error.textContent = ''; });
    }
    dialogo.querySelector('.dialogo-cancelar').addEventListener('click', () => dialogo.close());
    // Esc dispara "cancel" y después "close": cuenta como cancelar.
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (origen?.isConnected) origen.focus();
      resolver(resultado);
    });
    dialogo.showModal();
    (campo || check || dialogo.querySelector('.dialogo-confirmar'))?.focus();
  });
}

export async function pedirMotivo({ titulo, mensaje, etiqueta, ayuda, minimo, textoConfirmar = 'Confirmar', peligro = false }) {
  const { confirmado, motivo } = await abrirDialogo({ titulo, mensaje, motivo: { etiqueta, ayuda, minimo }, textoConfirmar, peligro });
  return confirmado ? motivo : null;
}

export async function confirmar({ titulo, mensaje, contenidoHtml, casilla, textoConfirmar = 'Confirmar', textoCancelar, peligro = false }) {
  return (await abrirDialogo({ titulo, mensaje, contenidoHtml, casilla, textoConfirmar, textoCancelar, peligro })).confirmado;
}
