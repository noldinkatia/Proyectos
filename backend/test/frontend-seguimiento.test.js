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

const { renderMyCasesView } = await import(new URL('js/my-cases.js', publicDir));

const caso = (id, estado) => ({
  id, estado, nombreCompleto: `Persona ${id}`, edad: 30, ciudad: 'Asunción', departamento: 'Capital',
  fechaCreacion: '2026-10-20T12:00:00Z'
});
// Botones de cada tarjeta de "Mis casos", por id de caso.
function accionesPorCaso(html) {
  return Object.fromEntries([...html.matchAll(/<article class="my-case-card">([\s\S]*?)<\/article>/g)].map(([, tarjeta]) => {
    const id = /<h3>Persona (\w+)<\/h3>/.exec(tarjeta)[1];
    return [id, botones(tarjeta)];
  }));
}

test('"Mis casos": cada caso activo ofrece solo "Persona localizada" y "Cerrar caso"', () => {
  const html = renderMyCasesView([
    caso('activo', 'VALIDADO'), caso('seguimiento', 'EN_SEGUIMIENTO'), caso('localizado', 'LOCALIZADO'),
    caso('pendiente', 'PENDIENTE'), caso('cerrado', 'CERRADO')
  ], [{ id: 1, tipo: 'SEGUIMIENTO', casoId: 'activo', titulo: 'Consulta de seguimiento', mensaje: '¿La búsqueda de Persona activo continúa activa?', creadaEn: '2026-10-25T12:00:00Z' }]);
  const dos = [
    ['Persona localizada', "respondToFollowup(this.dataset.caseId, 'LOCALIZADO')"],
    ['Cerrar caso', "respondToFollowup(this.dataset.caseId, 'CERRAR')"]
  ];
  assert.deepEqual(accionesPorCaso(html), { activo: dos, seguimiento: dos, localizado: [], pendiente: [], cerrado: [] });
  // Ni prórroga ni respuestas de seguimiento en ninguna parte de la vista, tampoco
  // en el panel de avisos aunque haya una consulta pendiente.
  assert.doesNotMatch(html, /SIGUE_ACTIVA|Sigue activ|PRORROGA|prórroga|respondToCaseFollowup/i);
});
