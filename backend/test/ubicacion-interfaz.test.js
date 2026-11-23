import assert from 'node:assert/strict';
import test from 'node:test';
import { instalarDom } from '../ayuda-tests/dom-falso.js';

// Interfaz (DOM falso, sin servidor): bloqueo del punto fuera de Paraguay en el
// reporte y en las pistas, aviso de "Usar mi ubicación actual", aviso de distancia
// a la ciudad elegida (también sin Nominatim) y lo que ve la administración.
const publicDir = new URL('../../public/', import.meta.url);
const report = await import(new URL('js/report.js', publicDir));
const { handleLeadSubmit } = await import(new URL('js/lead.js', publicDir));
const { estado } = await import(new URL('js/estado.js', publicDir));
const { textoAlertaTemprana, avisoFueraDeParaguay, renderAdminView } = await import(new URL('js/admin.js', publicDir));
const L = await import(new URL('js/limites-paraguay.js', publicDir));

const ASUNCION = { lat: '-25.28670', lng: '-57.63330' };
const MIAMI = { lat: '25.76170', lng: '-80.19180' };

// DOM falso con fetch espiado y un <dialog> que responde solo ("dejar" o "corregir").
function entorno({ valores = {}, respuestaDialogo = null } = {}) {
  const dom = instalarDom(valores);
  const pedidos = [];
  const dialogos = [];
  const anteriores = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  globalThis.fetch = async url => { pedidos.push(String(url)); throw new Error('sin red'); };
  globalThis.setTimeout = () => 0; // el aviso (toast) se ocultaría a los 7 s
  globalThis.document.activeElement = null;
  globalThis.document.body = { append: d => dialogos.push(d) };
  globalThis.document.createElement = () => {
    const oyentes = {};
    const partes = new Map();
    const dialogo = {
      innerHTML: '', oyentes, setAttribute() {},
      addEventListener: (tipo, fn) => { (oyentes[tipo] ||= []).push(fn); },
      querySelector(sel) {
        const clase = sel.replace(/^\./, '');
        if (sel === 'form' ? !this.innerHTML.includes('<form') : !this.innerHTML.includes(clase)) return null;
        if (!partes.has(sel)) {
          const o = {};
          partes.set(sel, { oyentes: o, addEventListener: (t, fn) => { (o[t] ||= []).push(fn); }, setAttribute() {}, removeAttribute() {}, focus() {}, textContent: '' });
        }
        return partes.get(sel);
      },
      showModal() {
        queueMicrotask(() => {
          if (respuestaDialogo === 'dejar') (partes.get('form')?.oyentes.submit || []).forEach(fn => fn({ preventDefault() {} }));
          else (partes.get('.dialogo-cancelar')?.oyentes.click || []).forEach(fn => fn());
        });
      },
      close() { (oyentes.close || []).forEach(fn => fn()); },
      remove() {}
    };
    return dialogo;
  };
  return {
    dom, pedidos, dialogos,
    aviso: () => (dom.obtener('toastNotification').classList.contains('hidden') ? null : `${dom.obtener('toastTitle').innerText} | ${dom.obtener('toastMessage').innerText}`),
    restaurar: () => { Object.assign(globalThis, anteriores); dom.restaurar(); }
  };
}

test('reporte: con el punto fuera de Paraguay no se sigue; el error se ve y el formulario queda igual', () => {
  const e = entorno({ valores: { replat: MIAMI.lat, replng: MIAMI.lng } });
  try {
    e.dom.obtener('reportFormError').classList.add('hidden');
    assert.equal(report.revisarPuntoEnParaguay(), false);
    assert.equal(e.dom.obtener('reportFormError').textContent, 'El punto del mapa quedó fuera de Paraguay. Marcá en el mapa el lugar de la desaparición.');
    assert.equal(e.dom.obtener('reportFormError').classList.contains('hidden'), false);
    assert.equal(e.dom.obtener('replat').value, MIAMI.lat, 'no toca el punto (ni el borrador)');
    // Con el punto en Paraguay se sigue.
    e.dom.obtener('replat').value = ASUNCION.lat;
    e.dom.obtener('replng').value = ASUNCION.lng;
    assert.equal(report.revisarPuntoEnParaguay(), true);
  } finally {
    e.restaurar();
  }
});

test('"Usar mi ubicación actual" fuera de Paraguay: aviso inmediato y el punto no se mueve', () => {
  const e = entorno({ valores: { replat: ASUNCION.lat, replng: ASUNCION.lng } });
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { geolocation: { getCurrentPosition: ok => ok({ coords: { latitude: 25.7617, longitude: -80.1918 } }) } }
    });
    report.useBrowserLocation('replat', 'replng', null, 'repCoordsText');
    assert.equal(e.aviso(), `Ubicación fuera de Paraguay | ${L.MENSAJE_UBICACION_FUERA_DE_PARAGUAY}`);
    assert.equal(L.MENSAJE_UBICACION_FUERA_DE_PARAGUAY, 'Tu ubicación no parece estar en Paraguay (el navegador de la PC puede ubicarte mal). Marcá el punto en el mapa.');
    assert.equal(e.dom.obtener('replat').value, ASUNCION.lat);
    assert.equal(e.dom.obtener('replng').value, ASUNCION.lng);
  } finally {
    Object.defineProperty(globalThis, 'navigator', anterior);
    e.restaurar();
  }
});

const SELECCION = { repDepartamento: 'Itapúa', repCiudad: 'Encarnación', repBarrio: '' };
const ENCARNACION = { lat: -27.3306, lng: -55.8667 };

test('aviso de distancia: lejos de la ciudad pregunta con dos botones; "Dejarlo así" sigue y no vuelve a preguntar', async () => {
  const e = entorno({ valores: SELECCION, respuestaDialogo: 'dejar' });
  try {
    estado.reportReferencia = { ...ENCARNACION, nombre: 'Encarnación', umbralKm: report.UMBRAL_CIUDAD_KM, clave: 'Itapúa|Encarnación|' };
    estado.reportDistanciaAceptada = null;
    const pin = { lat: -25.2867, lng: -57.6333 }; // Asunción: ~287 km
    assert.equal(await report.confirmarDistanciaACiudad(pin), true);
    assert.equal(e.dialogos.length, 1);
    assert.match(e.dialogos[0].innerHTML, /El punto del mapa está a 287 km de Encarnación\. ¿Lo corregís o lo dejás así\?/);
    assert.match(e.dialogos[0].innerHTML, />Corregir el punto<\/button>/);
    assert.match(e.dialogos[0].innerHTML, />Dejarlo así<\/button>/);
    assert.equal(await report.confirmarDistanciaACiudad(pin), true);
    assert.equal(e.dialogos.length, 1, 'el mismo punto ya aceptado no pregunta otra vez');
    // Cerca (dentro de ~30 km): no pregunta.
    assert.equal(await report.confirmarDistanciaACiudad({ lat: -27.30, lng: -55.90 }), true);
    assert.equal(e.dialogos.length, 1);
    assert.deepEqual(e.pedidos, [], 'no consulta Nominatim al enviar');
  } finally {
    estado.reportReferencia = null;
    e.restaurar();
  }
});

test('aviso de distancia: "Corregir el punto" no sigue; con solo departamento el umbral es ~100 km', async () => {
  const e = entorno({ valores: SELECCION, respuestaDialogo: 'corregir' });
  try {
    estado.reportReferencia = { ...ENCARNACION, nombre: 'Encarnación', umbralKm: report.UMBRAL_CIUDAD_KM, clave: 'Itapúa|Encarnación|' };
    estado.reportDistanciaAceptada = null;
    assert.equal(await report.confirmarDistanciaACiudad({ lat: -26.9, lng: -55.87 }), false, '~48 km de la ciudad');
    // Solo departamento: 48 km está dentro de los ~100 km.
    e.dom.obtener('repCiudad').value = '';
    estado.reportReferencia = { ...ENCARNACION, nombre: 'Itapúa', umbralKm: report.UMBRAL_DEPARTAMENTO_KM, clave: 'Itapúa||' };
    assert.equal(await report.confirmarDistanciaACiudad({ lat: -26.9, lng: -55.87 }), true);
    assert.equal(report.UMBRAL_CIUDAD_KM, 30);
    assert.equal(report.UMBRAL_DEPARTAMENTO_KM, 100);
  } finally {
    estado.reportReferencia = null;
    e.restaurar();
  }
});

test('aviso de distancia sin Nominatim (falla o no responde): no pregunta ni bloquea', async () => {
  const e = entorno({ valores: SELECCION, respuestaDialogo: 'corregir' });
  try {
    estado.activeMap = { setView() {} };
    estado.reportMarker = { setLatLng() {} };
    estado.reportReferencia = { ...ENCARNACION, nombre: 'vieja', umbralKm: 30, clave: 'Itapúa|Encarnación|' };
    await report.centerReportMapOnSelection(); // fetch a Nominatim falla
    assert.equal(e.pedidos.length, 1);
    assert.match(e.pedidos[0], /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    assert.equal(estado.reportReferencia, null, 'sin referencia');
    assert.equal(await report.confirmarDistanciaACiudad({ lat: -25.2867, lng: -57.6333 }), true);
    assert.equal(e.dialogos.length, 0, 'no pregunta');
    // Una referencia de otra selección tampoco sirve.
    estado.reportReferencia = { ...ENCARNACION, nombre: 'Encarnación', umbralKm: 30, clave: 'Capital|Asunción|' };
    assert.equal(await report.confirmarDistanciaACiudad({ lat: -25.2867, lng: -57.6333 }), true);
    assert.equal(e.dialogos.length, 0);
  } finally {
    estado.activeMap = null;
    estado.reportMarker = null;
    estado.reportReferencia = null;
    e.restaurar();
  }
});

test('pistas: con el punto fuera de Paraguay no se envía (aviso) y no hay pedido al servidor', async () => {
  const e = entorno({ valores: { leadCaseId: 'cas_1', leadDesc: 'La vi', leadFecha: '2026-11-23T10:00', leadlat: MIAMI.lat, leadlng: MIAMI.lng } });
  try {
    await handleLeadSubmit({ preventDefault() {} });
    assert.equal(e.aviso(), `Revisá el punto del mapa | ${L.MENSAJE_PISTA_FUERA_DE_PARAGUAY}`);
    assert.deepEqual(e.pedidos, []);
  } finally {
    e.restaurar();
  }
});

test('panel: motivo exacto de la alerta temprana', () => {
  const base = { alertaTempranaEn: null, alertaTemprana: { avisoDuplicado: null, otraAlertaEn: null, destinatarios: 0 } };
  const enviada = textoAlertaTemprana({ ...base, alertaTempranaEn: '2026-11-23T13:00:00Z', alertaTemprana: { ...base.alertaTemprana, destinatarios: 3 } });
  assert.match(enviada, /^enviada el .+ a 3 personas$/);
  assert.match(textoAlertaTemprana({ ...base, alertaTempranaEn: '2026-11-23T13:00:00Z', alertaTemprana: { ...base.alertaTemprana, destinatarios: 1 } }), / a 1 persona$/);
  assert.equal(textoAlertaTemprana({ ...base, alertaTemprana: { ...base.alertaTemprana, avisoDuplicado: 'El reporte de Ana (30 años, Asunción) se parece al caso de Ana (30 años, Asunción) reportado el 22/11. No se envió alerta temprana a la zona.' } }),
    'no enviada por posible duplicado. El reporte de Ana (30 años, Asunción) se parece al caso de Ana (30 años, Asunción) reportado el 22/11.');
  const limite = textoAlertaTemprana({ ...base, alertaTemprana: { ...base.alertaTemprana, otraAlertaEn: '2026-11-23T10:15:00Z' } });
  assert.match(limite, /^no enviada por el límite por reportante: ya había enviado otra alerta el .+\.$/);
  assert.doesNotMatch(limite, /\.\.$/, 'sin punto doble (la hora puede terminar en "a. m.")');
  assert.equal(textoAlertaTemprana(base), 'no enviada (motivo no registrado)');
  assert.equal(textoAlertaTemprana({}), 'no enviada (motivo no registrado)', 'sin datos');
  assert.doesNotMatch([enviada, textoAlertaTemprana(base)].join(' '), /posible duplicado o límite/);
});

test('panel: aviso destacado si el punto está fuera de Paraguay (ficha, bandeja y Casos); nada si está adentro', () => {
  const fuera = { id: 'c_fuera', estado: 'PENDIENTE', nombreCompleto: 'Mia Chamorro', edad: 20, ciudad: 'Asunción', fechaCreacion: '2026-11-23T12:00:00Z', ubicacion: { lat: 25.76, lng: -80.19 } };
  const dentro = { ...fuera, id: 'c_dentro', ubicacion: { lat: -25.28, lng: -57.63 } };
  const detalle = avisoFueraDeParaguay(fuera, { detalle: true });
  assert.match(detalle, /^<p class="aviso-ubicacion" role="note"><svg class="aviso-ubicacion-icono"[^>]*aria-hidden="true"/, 'icono y texto, no solo color');
  // En revisión (PENDIENTE): rechazar con motivo o esperar la corrección de quien reportó.
  assert.match(detalle, /<strong>Ubicación fuera de Paraguay\.<\/strong> El punto del mapa está fuera de Paraguay\. Rechazalo indicando el motivo, o esperá a que quien reportó lo corrija desde «Editar reporte»\.<\/span>/);
  assert.doesNotMatch(detalle, /Devolvelo a revisión|Devolvé el reporte/);
  // En otro estado: devolverlo a revisión.
  for (const estadoCaso of ['VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO']) {
    const otro = avisoFueraDeParaguay({ ...fuera, estado: estadoCaso }, { detalle: true });
    assert.match(otro, /El punto del mapa está fuera de Paraguay\. Devolvelo a revisión para que lo corrija\.<\/span>/, estadoCaso);
    assert.doesNotMatch(otro, /Rechazalo/, estadoCaso);
  }
  // La versión corta (bandeja y Casos) es la misma en cualquier estado.
  assert.equal(avisoFueraDeParaguay({ ...fuera, estado: 'VALIDADO' }), avisoFueraDeParaguay(fuera));
  assert.match(avisoFueraDeParaguay(fuera), /aviso-ubicacion-corto.*Punto del mapa fuera de Paraguay/);
  assert.equal(avisoFueraDeParaguay(dentro, { detalle: true }), '');
  assert.equal(avisoFueraDeParaguay({ ...fuera, ubicacion: undefined }), '', 'sin punto no se avisa');
  const dom = instalarDom();
  try {
    globalThis.window.backendCaseData.casos = [fuera, dentro];
    const html = renderAdminView({ casos: [] }, [], []);
    const bandeja = html.slice(html.indexOf('data-admin-panel="validation"'), html.indexOf('data-admin-panel="cases"'));
    const casos = html.slice(html.indexOf('data-admin-panel="cases"'), html.indexOf('data-admin-panel="history"'));
    for (const [nombre, parte] of [['bandeja', bandeja], ['casos', casos]]) {
      assert.equal((parte.match(/Punto del mapa fuera de Paraguay/g) || []).length, 1, `${nombre}: solo el de afuera`);
    }
  } finally {
    dom.restaurar();
  }
});
