import assert from 'node:assert/strict';
import test from 'node:test';
import { instalarDom, elementoFalso } from '../ayuda-tests/dom-falso.js';

// Edición del reporte en la interfaz: botón "Editar reporte" (Mis casos y ficha
// propia), formulario precargado y aviso "Modificado por el reportante" en el panel.
// El servidor (PUT /api/mis-casos/:id) se prueba en edicion-reporte.test.js.
const publicDir = new URL('../../public/', import.meta.url);
const { renderMyCasesView } = await import(new URL('js/my-cases.js', publicDir));
const { openOwnCaseDetail } = await import(new URL('js/feed.js', publicDir));
const { precargarReporte, confirmarYPublicarReporte, fechaConZona } = await import(new URL('js/report.js', publicDir));
const { avisoModificado, renderAdminView, adminAccept } = await import(new URL('js/admin.js', publicDir));
const { estado } = await import(new URL('js/estado.js', publicDir));

const caso = extra => ({
  id: 'cas_9', nombreCompleto: 'Ana Prueba', edad: 30, sexo: 'Femenino', ciudad: 'Asunción', departamento: 'Capital',
  barrio: 'Sajonia', descripcionFisica: 'Alta', vestimenta: 'Remera', senasParticulares: '', numeroDenuncia: '',
  estado: 'PENDIENTE', fechaCreacion: '2026-11-01T12:00:00Z', fechaHoraDesaparicion: '2026-11-01T13:30:00.000Z',
  ubicacion: { lat: -25.28123, lng: -57.63456, direccion: 'Asunción' }, alertaCampos: ['departamento', 'ciudad'],
  autorizacionParental: false, fotoUrl: '', edicionesDisponibles: 5, edicionesReportante: 0, modificadoEn: null, ...extra
});
const editarEn = html => [...html.matchAll(/<button[^>]*data-case-id="([^"]+)"[^>]*data-on-click="[^"]*navigateTo\('report', \{caseId:this\.dataset\.caseId\}\)"[^>]*>Editar reporte<\/button>/g)].map(m => m[1]);

test('"Editar reporte": solo en revisión y con ediciones disponibles (Mis casos y ficha propia)', () => {
  const html = renderMyCasesView([
    caso({ id: 'pendiente', edicionesDisponibles: 3 }),
    caso({ id: 'agotado', edicionesDisponibles: 0, edicionesReportante: 5, modificadoEn: '2026-11-01T15:00:00Z' }),
    caso({ id: 'validado', estado: 'VALIDADO' }),
    caso({ id: 'rechazado', estado: 'RECHAZADO' })
  ], []);
  assert.deepEqual(editarEn(html), ['pendiente']);
  assert.match(html, /Podés editarlo 3 veces más\./);
  assert.match(html, /Ya usaste todas las ediciones permitidas\./);

  const dom = instalarDom();
  try {
    estado.misCasos = [caso({ id: 'pendiente' }), caso({ id: 'validado', estado: 'VALIDADO' })];
    openOwnCaseDetail('pendiente');
    assert.deepEqual(editarEn(dom.obtener('caseDetailContent').innerHTML), ['pendiente']);
    openOwnCaseDetail('validado');
    assert.deepEqual(editarEn(dom.obtener('caseDetailContent').innerHTML), []);
  } finally {
    estado.misCasos = [];
    dom.restaurar();
  }
});

test('modo edición: precarga sin geocodificar, el pin queda donde estaba y guardar manda lo mismo', async () => {
  const campos = ['departamento', 'ciudad', 'barrio', 'sexo'].map(valor => ({ ...elementoFalso(valor), value: valor, name: 'alertaCampo' }));
  const dom = instalarDom({}, ['alertPreviewSection'], consulta => consulta.startsWith('input[name="alertaCampo"]')
    ? campos.filter(campo => !consulta.includes(':checked') || campo.checked) : []);
  const pedidos = [];
  const anterioresGlobales = { Option: globalThis.Option, crear: URL.createObjectURL };
  globalThis.Option = class { constructor(texto, valor) { this.text = texto; this.value = valor; } };
  URL.createObjectURL = () => 'blob:foto-guardada';
  globalThis.fetch = async (url, opciones = {}) => {
    pedidos.push({ url: String(url), opciones });
    if (String(url).includes('paraguay-ubicaciones')) {
      return { ok: true, json: async () => ({ departamentos: [{ departamento: 'Capital', ciudades: [{ ciudad: 'Asunción', barrios: ['Sajonia'] }] }] }) };
    }
    if (String(url).endsWith('/foto')) return { ok: true, blob: async () => new Blob(['x']) };
    return { ok: false, status: 400, json: async () => ({ error: 'No hay cambios para guardar.' }) };
  };
  estado.paraguayLocationsPromise = null;
  estado.reportEdicion = { casoId: 'cas_9', teniaFoto: true, fotoAccion: 'mantener' };
  try {
    const guardado = caso({ fotoUrl: '/api/mis-casos/cas_9/foto' });
    await precargarReporte(guardado);
    assert.equal(dom.obtener('replat').value, '-25.28123', 'el pin queda en lo guardado, sin redondear');
    assert.equal(dom.obtener('replng').value, '-57.63456');
    assert.deepEqual(pedidos.map(p => p.url).filter(url => /nominatim/.test(url)), [], 'sin geocodificar');
    assert.equal(dom.obtener('repDepartamento').value, 'Capital');
    assert.equal(dom.obtener('repBarrio').value, 'Sajonia');
    assert.equal(dom.obtener('repNombre').value, 'Ana Prueba');
    assert.equal(new Date(dom.obtener('repFechaHora').value).toISOString(), guardado.fechaHoraDesaparicion, 'la hora en la zona del navegador');
    assert.deepEqual(campos.filter(c => c.checked).map(c => c.value), ['departamento', 'ciudad']);
    assert.equal(dom.obtener('reportPhotoPreview').src, 'blob:foto-guardada', 'con la foto que tenía');
    assert.equal(dom.obtener('alertPreviewSection').classList.contains('hidden'), false);

    // Guardar sin tocar nada: viaja lo mismo que estaba guardado (el servidor responde 400).
    await confirmarYPublicarReporte({ pedir: async () => true });
    const envio = pedidos.find(p => p.opciones.method === 'PUT');
    assert.equal(envio.url, '/api/mis-casos/cas_9');
    const cuerpo = JSON.parse(envio.opciones.body);
    assert.deepEqual(cuerpo.ubicacion, { lat: -25.28123, lng: -57.63456, direccion: 'Asunción' });
    assert.equal(cuerpo.fechaHoraDesaparicion, fechaConZona(dom.obtener('repFechaHora').value), 'con fechaConZona, sin desfase');
    assert.equal(cuerpo.fechaHoraDesaparicion, guardado.fechaHoraDesaparicion);
    assert.equal(cuerpo.fotoAccion, 'mantener');
    assert.equal(cuerpo.foto, '', 'la foto guardada no se vuelve a mandar');
    assert.equal(cuerpo.declaracionAceptada, true, 'la declaración se volvió a pedir');
    assert.equal(dom.obtener('reportPreviewError').textContent, 'No hay cambios para guardar.');
    assert.equal(dom.obtener('reportConfirmButton').textContent, 'Confirmar cambios');
  } finally {
    globalThis.Option = anterioresGlobales.Option;
    URL.createObjectURL = anterioresGlobales.crear;
    estado.reportEdicion = null;
    estado.paraguayLocationsPromise = null;
    estado.reportPhotoPreviewUrl = '';
    dom.restaurar();
  }
});

test('panel: aviso "Modificado por el reportante" en la bandeja y en Casos, y el antes y el después', () => {
  const edicion = {
    editadoEn: '2026-11-01T15:00:00Z', declaracionVersion: '2026-10-20',
    cambios: [
      { campo: 'edad', anterior: 30, nuevo: 15 },
      { campo: 'autorizacionParental', anterior: false, nuevo: true },
      { campo: 'alertaCampos', anterior: ['departamento', 'foto'], nuevo: ['departamento'] },
      { campo: 'foto', anterior: 'con foto', nuevo: 'reemplazada' }
    ]
  };
  const pendiente = caso({ id: 'cas_p', alertaTempranaEn: '2026-11-01T17:00:00Z', modificadoEn: '2026-11-01T15:00:00Z', edicionesReportante: 1, ediciones: [edicion] });
  const validado = caso({ id: 'cas_v', estado: 'VALIDADO', modificadoEn: '2026-10-30T10:00:00Z', edicionesReportante: 1, ediciones: [edicion] });
  assert.equal(avisoModificado(caso()), '', 'sin ediciones no hay aviso');
  const dom = instalarDom();
  try {
    globalThis.window.backendCaseData.casos = [pendiente, validado, caso({ id: 'cas_n', nombreCompleto: 'Sin editar' })];
    const html = renderAdminView({ casos: [] }, [], []);
    const bandeja = html.slice(html.indexOf('data-admin-panel="validation"'), html.indexOf('data-admin-panel="cases"'));
    assert.equal((bandeja.match(/Modificado por el reportante el/g) || []).length, 1, 'el pendiente editado, como Pendiente normal');
    assert.match(bandeja, /status-PENDIENTE">En revisión/);
    const casos = html.slice(html.indexOf('data-admin-panel="cases"'), html.indexOf('data-admin-panel="history"'));
    assert.equal((casos.match(/Modificado por el reportante el/g) || []).length, 2, 'queda como historial aunque se haya validado');

    adminAccept('cas_p');
    const detalle = dom.obtener('reviewCaseDetails').innerHTML;
    assert.match(detalle, /<tr><td>Edad<\/td><td>30<\/td><td>15<\/td><\/tr>/);
    assert.match(detalle, /<tr><td>Autorización parental<\/td><td>No<\/td><td>Sí<\/td><\/tr>/);
    assert.match(detalle, /<tr><td>Fotografía<\/td><td>con foto<\/td><td>reemplazada<\/td><\/tr>/);
    assert.match(detalle, /volvió a aceptar la declaración, versión 2026-10-20/);
    assert.match(detalle, /Alerta temprana: enviada el [^<]+ · El reportante eligió mostrar/, 'sin punto doble tras «p. m.»');
  } finally {
    dom.restaurar();
  }
});
