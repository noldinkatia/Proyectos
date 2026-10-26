import assert from 'node:assert/strict';
import test from 'node:test';

// Seguimiento en la interfaz: las opciones (sigue activo, localizado, cerrar) van
// solo en la notificación de seguimiento (public/js/notifications.js).
const publicDir = new URL('../../public/', import.meta.url);
const { seguimientoHtml } = await import(new URL('js/notifications.js', publicDir));

const botones = html => [...html.matchAll(/<button[^>]*data-on-click="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
  .map(([, accion, texto]) => [texto.trim(), accion]);

test('notificación de seguimiento: un único "Sigue activo", localizado y cerrar; sin prórroga', () => {
  for (const tipo of ['SEGUIMIENTO', 'SEGUIMIENTO_VENCIDO']) {
    const html = seguimientoHtml({ tipo, casoId: 'c1' });
    assert.deepEqual(botones(html), [
      ['Sigue activo', "respondToCaseFollowup(this.dataset.caseId, 'SIGUE_ACTIVA')"],
      ['Persona localizada', "respondToCaseFollowup(this.dataset.caseId, 'LOCALIZADO')"],
      ['Cerrar caso', "respondToCaseFollowup(this.dataset.caseId, 'CERRAR')"]
    ], tipo);
    assert.doesNotMatch(html, /PRORROGA|prórroga/i);
  }
});

test('las opciones de seguimiento no aparecen en otros avisos', () => {
  for (const tipo of ['CASO_VALIDADO', 'CASO_LOCALIZADO', 'ALERTA_TEMPRANA', 'CASO_SIN_ACTUALIZAR']) {
    assert.equal(seguimientoHtml({ tipo, casoId: 'c1' }), '', tipo);
  }
  assert.equal(seguimientoHtml({ tipo: 'SEGUIMIENTO' }), '', 'sin caso no hay a qué responder');
});
