import assert from 'node:assert/strict';
import test from 'node:test';

// Formulario de reporte (sin DOM: se revisa el HTML de report.js): el aviso "Primero
// hacé la denuncia" arriba del formulario, en la web y en la app (/app/ usa el mismo
// report.js). El número de denuncia sigue siendo opcional.
const publicDir = new URL('../../public/', import.meta.url);
const { renderReportView, AVISO_DENUNCIA, NOTA_NUMERO_DENUNCIA } = await import(new URL('js/report.js', publicDir));

test('formulario: el aviso destacado va arriba, antes de cualquier campo, con título, icono y role', () => {
  for (const edicion of [null, { id: 'c1' }]) {
    const html = renderReportView(edicion);
    const aviso = html.indexOf('<section class="aviso-denuncia" role="note" aria-labelledby="avisoDenunciaTitulo">');
    assert.ok(aviso > 0, 'está el aviso');
    assert.ok(aviso < html.indexOf('<form id="reportForm"'), 'antes del formulario');
    assert.ok(aviso < html.indexOf('id="repNombre"'), 'antes del primer campo');
    assert.match(html, /<h2 id="avisoDenunciaTitulo">Primero hacé la denuncia<\/h2>/);
    assert.match(html, /<svg class="aviso-denuncia-icono"[^>]*aria-hidden="true"/, 'icono decorativo, no solo color');
    assert.equal(html.match(/class="aviso-denuncia"/g).length, 1, 'un solo aviso');
  }
  assert.equal(AVISO_DENUNCIA.titulo, 'Primero hacé la denuncia');
  assert.equal(AVISO_DENUNCIA.cuerpo, 'Para que tu reporte pueda ser validado, tenés que hacer la denuncia en la policía, por llamada o en persona. Con los datos que brindes, la administración carga el número de denuncia y valida el reporte. Mientras tanto queda \'En revisión\' y no se publica en el sitio (la alerta a tu zona sale igual, como no verificada).');
});

test('formulario: el número de denuncia sigue siendo opcional y su nota ya no dice "No es obligatorio"', () => {
  const html = renderReportView();
  assert.match(html, /<input type="text" id="repDenuncia" placeholder="Ej: DEN-2026-XXXX" class="form-control" aria-describedby="repDenunciaAyuda">/);
  assert.doesNotMatch(html, /id="repDenuncia"[^>]*required/, 'no se volvió obligatorio');
  assert.equal(NOTA_NUMERO_DENUNCIA, 'No hace falta que cargues el número: si ya hiciste la denuncia, la administración lo agrega al verificarla. Si lo tenés, podés ponerlo acá o agregarlo después con \'Editar reporte\'.');
  assert.ok(html.includes('No hace falta que cargues el número: si ya hiciste la denuncia, la administración lo agrega al verificarla. Si lo tenés, podés ponerlo acá o agregarlo después con &#39;Editar reporte&#39;.'));
  assert.doesNotMatch(html, /No es obligatorio/);
  // El formulario no tiene enlaces de llamada (si los tuviera, irían al número de prueba).
  assert.doesNotMatch(html, /href="tel:/);
});
