import assert from 'node:assert/strict';
import test from 'node:test';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Formulario de reporte (Clase 09): etiquetas de cada campo, indicador de paso,
// ayuda de la autorización parental y borrador en sessionStorage con aviso al salir.
const publicDir = new URL('../../public/', import.meta.url);
const report = await import(new URL('js/report.js', publicDir));
const { renderReportView, updateMinorAuthorization } = report;
const { estado } = await import(new URL('js/estado.js', publicDir));
const { CLAVE_BORRADOR_REPORTE, olvidarSesion } = await import(new URL('js/sesion.js', publicDir));
const { renderLeadView } = await import(new URL('js/lead.js', publicDir));
const { renderLoginForm, renderRegisterForm } = await import(new URL('js/auth.js', publicDir));

const VACIOS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source']);

// Árbol mínimo del HTML: cada elemento con sus atributos y ancestros.
function elementos(html) {
  const lista = [];
  const pila = [];
  for (const [, cierre, etiqueta, resto] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const nombre = etiqueta.toLowerCase();
    if (cierre) {
      const indice = pila.map(el => el.etiqueta).lastIndexOf(nombre);
      if (indice >= 0) pila.length = indice;
      continue;
    }
    const atributos = Object.fromEntries([...resto.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)")?/g)].map(([, n, v]) => [n.toLowerCase(), v ?? '']));
    const elemento = { etiqueta: nombre, atributos, ancestros: [...pila] };
    lista.push(elemento);
    if (!VACIOS.has(nombre)) pila.push(elemento);
  }
  return lista;
}

// Lo mismo que mira field.labels (más aria-label): sin etiqueta, o <label> sin campo.
function problemasDeEtiquetas(html) {
  const todos = elementos(html);
  const campos = todos.filter(el => ['input', 'select', 'textarea'].includes(el.etiqueta) && el.atributos.type !== 'hidden');
  const ids = new Set(campos.map(el => el.atributos.id).filter(Boolean));
  const etiquetas = todos.filter(el => el.etiqueta === 'label');
  const conFor = new Set(etiquetas.map(el => el.atributos.for).filter(Boolean));
  const sinEtiqueta = campos.filter(el => !conFor.has(el.atributos.id)
    && !el.ancestros.some(a => a.etiqueta === 'label') && !el.atributos['aria-label'] && !el.atributos['aria-labelledby'])
    .map(el => el.atributos.id || el.atributos.name || el.etiqueta);
  const huerfanas = etiquetas.filter(el => el.atributos.for ? !ids.has(el.atributos.for)
    : !campos.some(campo => campo.ancestros.includes(el)));
  return { sinEtiqueta, huerfanas: huerfanas.map(el => el.atributos.for || el.atributos.class || 'label') };
}

test('etiquetas: ningún campo sin etiqueta ni etiqueta sin campo (reporte, edición, pista, ingreso y registro)', () => {
  const dom = instalarDom();
  let formularios;
  try {
    globalThis.window.backendCaseData.casos = [{ id: 'cas_1', nombreCompleto: 'Ana Prueba', estado: 'VALIDADO', ciudad: 'Asunción', ubicacion: { lat: -25.3, lng: -57.6 } }];
    formularios = {
      reporte: renderReportView(),
      edicion: renderReportView({ id: 'cas_1' }),
      pista: renderLeadView('cas_1'),
      ingreso: renderLoginForm(),
      registro: renderRegisterForm()
    };
  } finally {
    dom.restaurar();
  }
  assert.match(formularios.pista, /id="leadDesc"/, 'se dibujó el formulario de la pista');
  for (const [nombre, html] of Object.entries(formularios)) {
    assert.deepEqual(problemasDeEtiquetas(html), { sinEtiqueta: [], huerfanas: [] }, nombre);
  }
  const reporte = elementos(formularios.reporte);
  const etiquetaDe = id => reporte.find(el => el.etiqueta === 'label' && el.atributos.for === id);
  assert.ok(etiquetaDe('repDenuncia') && etiquetaDe('repFotoFile'));
  // El mapa no es un campo: el grupo lleva el nombre del título.
  const grupo = reporte.find(el => el.atributos.role === 'group' && el.atributos['aria-labelledby'] === 'repLugarTitulo');
  assert.ok(grupo, 'el lugar exacto es un grupo con título');
  assert.ok(reporte.some(el => el.atributos.id === 'repLugarTitulo' && el.etiqueta !== 'label'));
  assert.ok(reporte.some(el => el.atributos.id === 'reportMap' && el.ancestros.includes(grupo)), 'el mapa está dentro del grupo');
});

test('paso actual: "Paso 1 de 3" en los datos, 2 en la alerta y 3 en la vista previa', () => {
  const html = renderReportView();
  const texto = (desde, hasta) => html.slice(html.indexOf(desde), html.indexOf(hasta, html.indexOf(desde)));
  assert.match(texto('id="reportPaso"', '</span>'), /Paso 1 de 3 · Datos de la persona/);
  assert.match(texto('id="alertPreviewSection"', '</h2>'), /Paso 2 de 3 · Qué verán en tu zona/);
  assert.match(texto('id="reportPreview"', '</h2>'), /Paso 3 de 3 · Revisión final/);
  // Al editar, la alerta ya está a la vista: se arranca en el paso 2.
  assert.match(renderReportView({ id: 'cas_1' }), /id="reportPaso"[^>]*>Paso 2 de 3/);
  assert.match(html, /id="reportPaso"[^>]*aria-live="polite"/);

  const dom = instalarDom();
  try {
    report.actualizarPasoReporte(3);
    assert.equal(dom.obtener('reportPaso').textContent, 'Paso 3 de 3 · Revisión final');
    report.editarReporte();
    assert.equal(dom.obtener('reportPaso').textContent, 'Paso 2 de 3 · Qué verán en tu zona');
  } finally {
    dom.restaurar();
  }
});

test('autorización parental: deshabilitada sin edad, con ayuda, y obligatoria solo para menores', () => {
  const casilla = elementos(renderReportView()).find(el => el.atributos.id === 'minorAuthorization');
  assert.ok('disabled' in casilla.atributos, 'arranca deshabilitada');
  assert.ok(!('required' in casilla.atributos));
  assert.match(renderReportView(), /id="minorAuthorizationAyuda"[^>]*>Se activa si la persona tiene menos de 18 años\./);

  const dom = instalarDom();
  try {
    const autorizacion = dom.obtener('minorAuthorization');
    const ayuda = dom.obtener('minorAuthorizationAyuda');
    for (const [edad, menor] of [['', false], ['  ', false], ['15', true], ['0', true], ['17', true], ['18', false], ['40', false]]) {
      dom.obtener('repEdad').value = edad;
      autorizacion.checked = true;
      updateMinorAuthorization();
      assert.equal(autorizacion.required, menor, `edad "${edad}"`);
      assert.equal(autorizacion.disabled, !menor, `edad "${edad}"`);
      assert.equal(autorizacion.checked, menor, `edad "${edad}": fuera de uso se desmarca`);
      assert.equal(ayuda.textContent, menor ? 'Obligatoria: la persona tiene menos de 18 años.' : 'Se activa si la persona tiene menos de 18 años.');
    }
  } finally {
    dom.restaurar();
  }
});

// sessionStorage simulado; fallar: setItem/getItem lanzan (cuota llena o bloqueado).
function almacen({ fallar = false } = {}) {
  const datos = new Map();
  return {
    datos,
    getItem: clave => { if (fallar) throw new Error('bloqueado'); return datos.get(clave) ?? null; },
    setItem: (clave, valor) => { if (fallar) throw new Error('QuotaExceededError'); datos.set(clave, String(valor)); },
    removeItem: clave => { datos.delete(clave); }
  };
}

function formularioCon(valores, campos = []) {
  const dom = instalarDom(valores, [], consulta => consulta.startsWith('input[name="alertaCampo"]')
    ? campos.filter(campo => !consulta.includes(':checked') || campo.checked) : []);
  globalThis.window.backendCurrentUser = { id: 7 };
  return dom;
}

test('borrador: se guarda sin foto ni casillas de aceptación, es de la cuenta y se borra al cerrar sesión', () => {
  const alerta = [{ value: 'ciudad', checked: true }, { value: 'foto', checked: false }];
  const dom = formularioCon({ repNombre: 'Ana Prueba', repEdad: '15', repSexo: 'Femenino', repFisica: 'Alta', replat: '-25.3', replng: '-57.6' }, alerta);
  const sesion = almacen();
  try {
    dom.obtener('repAvisoPrivacidad').checked = true;
    estado.reportEdicion = null;
    report.guardarBorradorReporte(sesion);
    const guardado = JSON.parse(sesion.datos.get(CLAVE_BORRADOR_REPORTE));
    assert.equal(guardado.campos.repNombre, 'Ana Prueba');
    assert.equal(guardado.campos.repEdad, '15');
    assert.deepEqual(guardado.ubicacion, { lat: -25.3, lng: -57.6 });
    assert.deepEqual(guardado.alertaCampos, ['ciudad']);
    assert.equal(guardado.usuarioId, 7);
    assert.doesNotMatch(JSON.stringify(guardado), /repAvisoPrivacidad|reporterAdult|minorAuthorization|foto"/, 'ni casillas de aceptación ni foto');
    assert.deepEqual(report.leerBorradorReporte(sesion), guardado);

    // Otra cuenta en la misma pestaña no lo ve.
    globalThis.window.backendCurrentUser = { id: 8 };
    assert.equal(report.leerBorradorReporte(sesion), null);
    globalThis.window.backendCurrentUser = { id: 7 };

    // Formulario vacío (el sexo viene elegido por defecto): no hay borrador.
    for (const id of ['repNombre', 'repEdad', 'repFisica']) dom.obtener(id).value = '';
    report.guardarBorradorReporte(sesion);
    assert.equal(sesion.datos.has(CLAVE_BORRADOR_REPORTE), false);

    // Al editar un caso no se guarda nada.
    dom.obtener('repNombre').value = 'Otra';
    estado.reportEdicion = { casoId: 'cas_1', teniaFoto: false, fotoAccion: 'mantener' };
    report.guardarBorradorReporte(sesion);
    assert.equal(sesion.datos.has(CLAVE_BORRADOR_REPORTE), false);
    estado.reportEdicion = null;

    // Almacenamiento lleno o bloqueado: no rompe el formulario.
    const roto = almacen({ fallar: true });
    assert.doesNotThrow(() => report.guardarBorradorReporte(roto));
    assert.equal(report.leerBorradorReporte(roto), null);
    sesion.datos.set(CLAVE_BORRADOR_REPORTE, '{roto');
    assert.equal(report.leerBorradorReporte(sesion), null, 'JSON dañado');

    report.guardarBorradorReporte(sesion);
    olvidarSesion(sesion);
    assert.equal(sesion.datos.has(CLAVE_BORRADOR_REPORTE), false, 'cerrar sesión borra el borrador');
  } finally {
    estado.reportEdicion = null;
    dom.restaurar();
  }
});

test('borrador: al volver a Reportar se restaura (selects sin geocodificar) y "Empezar de nuevo" lo descarta', async () => {
  const alerta = [{ value: 'departamento', checked: true }, { value: 'ciudad', checked: true }, { value: 'sexo', checked: false }];
  const dom = formularioCon({}, alerta);
  const pedidos = [];
  const anteriores = { Option: globalThis.Option, sesion: globalThis.sessionStorage, setTimeout: globalThis.setTimeout };
  globalThis.Option = class { constructor(texto, valor) { this.text = texto; this.value = valor; } };
  globalThis.setTimeout = () => 0; // sin Leaflet: el mapa no se dibuja en el test
  globalThis.fetch = async url => {
    pedidos.push(String(url));
    return { ok: true, json: async () => ({ departamentos: [{ departamento: 'Capital', ciudades: [{ ciudad: 'Asunción', barrios: ['Sajonia'] }] }] }) };
  };
  const sesion = almacen();
  globalThis.sessionStorage = sesion;
  sesion.setItem(CLAVE_BORRADOR_REPORTE, JSON.stringify({
    usuarioId: 7, alertaCampos: ['sexo'], ubicacion: { lat: -25.28123, lng: -57.63456 },
    campos: { repNombre: 'Ana Prueba', repEdad: '15', repSexo: 'Otro', repDepartamento: 'Capital', repCiudad: 'Asunción', repBarrio: 'Sajonia', repFisica: 'Alta' }
  }));
  estado.paraguayLocationsPromise = null;
  try {
    await report.iniciarReporteNuevo();
    assert.equal(dom.obtener('repNombre').value, 'Ana Prueba');
    assert.equal(dom.obtener('repSexo').value, 'Otro');
    assert.equal(dom.obtener('repDepartamento').value, 'Capital');
    assert.equal(dom.obtener('repCiudad').value, 'Asunción');
    assert.equal(dom.obtener('repBarrio').value, 'Sajonia');
    assert.equal(dom.obtener('replat').value, '-25.28123');
    assert.deepEqual(alerta.filter(c => c.checked).map(c => c.value), ['sexo']);
    assert.equal(dom.obtener('minorAuthorization').disabled, false, 'edad 15: la autorización se activa');
    assert.equal(dom.obtener('reportDraftNotice').classList.contains('hidden'), false, 'aviso de borrador recuperado');
    assert.deepEqual(pedidos.filter(url => /nominatim/.test(url)), [], 'sin geocodificar');
    assert.equal(report.reporteConCambiosSinEnviar(), true, 'restaurado cuenta como algo sin enviar');
    // El borrador restaurado sigue entero (no se pisó antes de llenar los selects).
    assert.equal(JSON.parse(sesion.getItem(CLAVE_BORRADOR_REPORTE)).campos.repCiudad, 'Asunción');

    // "Empezar de nuevo" borra el borrador (la vista se vuelve a dibujar con navigateTo).
    globalThis.window.rastreoCurrentView = 'report';
    await report.descartarBorradorReporte().catch(() => {});
    assert.equal(sesion.getItem(CLAVE_BORRADOR_REPORTE), null);
    assert.equal(estado.reportCambios, false);
  } finally {
    globalThis.Option = anteriores.Option;
    globalThis.setTimeout = anteriores.setTimeout;
    estado.paraguayLocationsPromise = null;
    estado.reportCambios = false;
    dom.restaurar();
    globalThis.sessionStorage = anteriores.sesion;
  }
});

test('aviso al salir: solo con cambios sin enviar; texto distinto al editar; beforeunload solo en el reporte', async () => {
  const dom = formularioCon({ repSexo: 'Femenino' });
  try {
    estado.reportEdicion = null;
    estado.reportCambios = true;
    assert.equal(report.reporteConCambiosSinEnviar(), false, 'tocó algo pero el formulario quedó vacío');
    dom.obtener('repVestimenta').value = 'Remera roja';
    assert.equal(report.reporteConCambiosSinEnviar(), true);
    estado.reportCambios = false;
    assert.equal(report.reporteConCambiosSinEnviar(), false, 'publicado o recién abierto');

    let pedido;
    const pedir = async opciones => { pedido = opciones; return false; };
    assert.equal(await report.confirmarSalidaDelReporte({ pedir }), false);
    assert.equal(pedido.titulo, '¿Salir del reporte?');
    assert.match(pedido.mensaje, /queda guardado en esta pestaña/);
    assert.match(pedido.mensaje, /La foto no se guarda/);
    estado.reportEdicion = { casoId: 'cas_1', teniaFoto: false, fotoAccion: 'mantener' };
    await report.confirmarSalidaDelReporte({ pedir });
    assert.equal(pedido.titulo, '¿Salir sin guardar los cambios?');
    assert.equal(pedido.textoConfirmar, 'Salir sin guardar');

    // Al editar, cualquier cambio cuenta (no hay borrador que lo conserve).
    estado.reportCambios = true;
    const evento = () => ({ prevenido: false, returnValue: undefined, preventDefault() { this.prevenido = true; } });
    globalThis.window.rastreoCurrentView = 'report';
    const conCambios = evento();
    report.avisarAntesDeCerrar(conCambios);
    assert.equal(conCambios.prevenido, true);
    assert.equal(conCambios.returnValue, '');
    globalThis.window.rastreoCurrentView = 'feed';
    const enOtraVista = evento();
    report.avisarAntesDeCerrar(enOtraVista);
    assert.equal(enOtraVista.prevenido, false);
  } finally {
    estado.reportEdicion = null;
    estado.reportCambios = false;
    dom.restaurar();
  }
});
