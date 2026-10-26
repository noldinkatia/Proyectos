// Mis casos del ciudadano. Cada caso activo ofrece solo "Persona localizada" y
// "Cerrar caso"; las consultas de seguimiento (con "Sigue activo") se responden
// desde su notificación (notifications.js).
import { apiRequest } from './api.js';
import { escapeHtml } from './config.js';
import { confirmar, pedirMotivo } from './dialogo.js';
import { renderNoticeItem } from './notifications.js';
import { navigateTo } from './router.js';
import { showToast } from './ui.js';

// ==========================================
// VISTA 7: PANEL DE ADMINISTRACIÓN (SECCIÓN 9)
// ==========================================
export function renderMyCasesView(cases, notifications) {
  const relevantNotifications = notifications.slice(0, 8);
  return `
    <section class="account-view">
      <div class="account-view-heading">
        <div><span class="section-kicker">Área ciudadana</span><h1>Mis casos</h1>
          <p>Consultá el estado de tus reportes. Las consultas de seguimiento llegan al centro de avisos.</p></div>
        <button type="button" class="btn btn-primary" data-on-click="navigateTo('report')">＋ Nuevo reporte</button>
      </div>
      <div class="my-cases-layout">
        <section class="card my-cases-list" aria-labelledby="myCasesHeading">
          <h2 id="myCasesHeading">Reportes registrados por vos</h2>
          ${cases.length ? cases.map(c => {
            const activo = ['VALIDADO', 'EN_SEGUIMIENTO'].includes(c.estado);
            return `<article class="my-case-card">
              <div class="my-case-card-heading"><div><h3>${escapeHtml(c.nombreCompleto)}</h3>
                <p>${Number(c.edad)} años · ${escapeHtml(c.ciudad)}${c.departamento ? `, ${escapeHtml(c.departamento)}` : ''}</p></div>
                <span class="status-tag status-${escapeHtml(c.estado)}">${escapeHtml(statusLabel(c.estado))}</span></div>
              <p class="my-case-meta">Reportado ${new Date(c.fechaCreacion).toLocaleString('es-PY')}</p>
              ${c.estado === 'PENDIENTE' ? '<p class="my-case-notice">Tu reporte está en revisión. Recibirás un aviso cuando se actualice.</p>' : ''}
              ${c.estado === 'LOCALIZADO' ? `<p class="my-case-notice">La persona fue localizada.${fechaCierre(c.cierreAutomaticoEn)}</p>` : ''}
              ${c.estado === 'RECHAZADO' ? `<p class="my-case-notice">${escapeHtml(c.motivoRechazo || 'El reporte no fue aprobado. Contactá a soporte para más información.')}</p>` : ''}
              ${activo ? `<div class="my-case-actions table-actions">
                <button type="button" class="btn btn-success btn-sm" data-case-id="${escapeHtml(c.id)}" data-on-click="respondToFollowup(this.dataset.caseId, 'LOCALIZADO')">Persona localizada</button>
                <button type="button" class="btn btn-outline btn-sm" data-case-id="${escapeHtml(c.id)}" data-on-click="respondToFollowup(this.dataset.caseId, 'CERRAR')">Cerrar caso</button>
              </div>` : ''}
            </article>`;
          }).join('') : '<div class="empty-state"><h3>Aún no registraste casos</h3><p>Tus reportes aparecerán aquí para que puedas consultar su estado.</p></div>'}
        </section>
        <aside class="card system-notices" aria-labelledby="systemNoticesHeading">
          <h2 id="systemNoticesHeading">Avisos</h2>
          ${relevantNotifications.length ? `<div class="notif-list">${relevantNotifications.map(notice => renderNoticeItem(notice)).join('')}</div>` : '<div class="notif-empty"><strong>Todo al día</strong><p>No tenés avisos por ahora.</p></div>'}
          <button type="button" class="btn btn-outline btn-sm" data-on-click="toggleNotificationsModal()">Abrir centro de avisos</button>
        </aside>
      </div>
    </section>`;
}

// Fecha del cierre automático de un caso localizado (backend/followups.js).
function fechaCierre(valor) {
  const fecha = valor ? new Date(valor) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) return '';
  return ` El caso se cerrará automáticamente el ${escapeHtml(fecha.toLocaleDateString('es-PY', { day: 'numeric', month: 'long' }))}.`;
}

export function statusLabel(status) {
  return ({
    PENDIENTE: 'En revisión',
    VALIDADO: 'Búsqueda activa',
    EN_SEGUIMIENTO: 'En seguimiento',
    LOCALIZADO: 'Localizado',
    CERRADO: 'Cerrado',
    RECHAZADO: 'Rechazado'
  })[status] || status;
}

export function timeSince(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Fecha no disponible';
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) return 'Hace menos de 1 hora';
  if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

// Confirmación o motivo de una respuesta de seguimiento ("Mis casos" y la
// notificación de seguimiento usan la misma). null si se canceló.
export async function prepararRespuestaSeguimiento(action) {
  if (action === 'LOCALIZADO') {
    const ok = await confirmar({ titulo: 'Persona localizada', mensaje: '¿Confirmás que la persona fue localizada?', textoConfirmar: 'Sí, fue localizada' });
    return ok ? {} : null;
  }
  if (action === 'CERRAR') {
    const motivo = await pedirMotivo({ titulo: 'Cerrar caso', etiqueta: '¿Por qué cerrás el caso?', textoConfirmar: 'Cerrar caso', peligro: true });
    return motivo === null ? null : { motivo };
  }
  return {};
}

export async function respondToFollowup(caseId, action) {
  const extra = await prepararRespuestaSeguimiento(action);
  if (!extra) return;
  const { motivo } = extra;
  try {
    await apiRequest(`/casos/${encodeURIComponent(caseId)}/seguimiento`, {
      method: 'POST',
      body: { accion: action, ...(motivo ? { motivo: motivo.trim() } : {}) }
    });
    showToast('Seguimiento actualizado', 'Tu respuesta fue registrada.', 'success');
    await navigateTo('my-cases');
  } catch (error) {
    showToast('No se pudo actualizar el seguimiento', error.message, 'error');
  }
}
