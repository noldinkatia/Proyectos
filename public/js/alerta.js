// Vista de una alerta de zona (#/alerta/<caso>), web y app. Mientras el caso está
// en revisión muestra solo la vista mínima que devuelve el servidor; cuando ya es
// público, el router abre la ficha completa.
import { escapeHtml } from './config.js';
import { navigateTo } from './router.js';

export function abrirAlerta(caseId) {
  document.getElementById('notifModal')?.classList.add('hidden');
  return navigateTo('alert', { caseId });
}

function distanciaTexto(distanciaKm) {
  return Number.isFinite(distanciaKm) ? `A unos ${Math.max(1, Math.round(distanciaKm))} km de tu zona.` : '';
}

export function renderAlertaView(alerta) {
  if (alerta.estado === 'RETRACTADA' || alerta.estado === 'FINALIZADA') {
    return `
      <section class="card alerta-zona">
        <h1>Alerta no vigente</h1>
        <p>${alerta.estado === 'RETRACTADA'
          ? 'La administración revisó este caso y no lo validó. No hace falta que hagas nada.'
          : 'Este caso ya no está activo en tu zona.'}</p>
        <button type="button" class="btn btn-outline" data-on-click="navigateTo('home')">Volver al inicio</button>
      </section>`;
  }
  const filas = (alerta.datos || []).map(({ etiqueta, valor }) =>
    `<p><strong>${escapeHtml(etiqueta)}:</strong> ${escapeHtml(valor)}</p>`).join('');
  return `
    <section class="card alerta-zona">
      <span class="status-tag status-PENDIENTE">${escapeHtml(alerta.etiqueta || 'Pendiente / En revisión – No verificada')}</span>
      <h1>Alerta en tu zona</h1>
      <p class="muted">${escapeHtml(distanciaTexto(alerta.distanciaKm))}</p>
      ${alerta.fotoUrl ? `<img class="alerta-zona-foto" src="data:," data-photo-url="${escapeHtml(alerta.fotoUrl)}" data-protected-photo alt="Fotografía compartida por quien reportó">` : ''}
      ${filas}
      <p class="notice notice-warning">El caso todavía no fue verificado por la administración. Si ves algo, avisá al 911; cuando se valide vas a ver la ficha completa.</p>
      <div class="case-detail-actions">
        <a class="btn btn-outline btn-sm" href="tel:911">Llamar al 911</a>
        <button type="button" class="btn btn-outline btn-sm" data-on-click="navigateTo('home')">Volver al inicio</button>
      </div>
    </section>`;
}
