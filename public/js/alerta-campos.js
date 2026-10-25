// Datos que el reportante elige mostrar en la alerta temprana (antes de que la
// administración valide el caso). Lo usan el formulario de reporte (vista previa)
// y el backend (backend/alertas.js), así los dos arman el mismo texto. Sin DOM.
//
// Nunca se ofrecen: contacto, número de denuncia, documento, dirección exacta ni
// ubicación exacta. Lo que llegue fuera de esta lista se ignora.

export const ETIQUETA_NO_VERIFICADA = 'Pendiente / En revisión – No verificada';

// etiqueta: cómo se titula el dato en la alerta. texto y ayuda: lo que lee quien
// reporta al elegir (frases simples, sin palabras técnicas). Por defecto solo la
// zona, que es lo más privado.
export const CAMPOS_ALERTA = [
  { clave: 'departamento', etiqueta: 'Departamento', porDefecto: true,
    texto: 'Departamento', ayuda: 'Por ejemplo: Central.' },
  { clave: 'ciudad', etiqueta: 'Ciudad', porDefecto: true,
    texto: 'Ciudad', ayuda: 'Por ejemplo: Luque.' },
  { clave: 'barrio', etiqueta: 'Barrio o zona', porDefecto: true,
    texto: 'Barrio o zona', ayuda: 'Solo el nombre del barrio, nunca la dirección.' },
  { clave: 'rangoEdad', etiqueta: 'Edad aproximada', porDefecto: false,
    texto: 'Edad aproximada', ayuda: 'No se muestra la edad exacta, sino un rango. Por ejemplo: entre 15 y 19 años.' },
  { clave: 'sexo', etiqueta: 'Sexo', porDefecto: false,
    texto: 'Sexo', ayuda: '' },
  { clave: 'descripcionFisica', etiqueta: 'Cómo es', porDefecto: false,
    texto: 'Cómo es físicamente', ayuda: 'Lo que escribiste en «Descripción física».' },
  { clave: 'vestimenta', etiqueta: 'Ropa que llevaba', porDefecto: false,
    texto: 'Ropa que llevaba', ayuda: 'Lo que escribiste en «Vestimenta».' },
  { clave: 'primerNombre', etiqueta: 'Primer nombre', porDefecto: false,
    texto: 'Primer nombre', ayuda: 'Solo se muestra el primer nombre, nunca el apellido.' },
  { clave: 'iniciales', etiqueta: 'Iniciales', porDefecto: false,
    texto: 'Iniciales del nombre', ayuda: 'Solo las iniciales. Por ejemplo: M. J. B.' },
  { clave: 'foto', etiqueta: 'Fotografía', porDefecto: false,
    texto: 'Foto', ayuda: 'Si se trata de una persona menor de edad, la foto no se mostrará.' }
];

export const CAMPOS_POR_DEFECTO = CAMPOS_ALERTA.filter(campo => campo.porDefecto).map(campo => campo.clave);

// La foto de una persona menor de 18 años nunca va en la alerta temprana.
export function fotoPermitida(edad, tieneFoto) {
  return Boolean(tieneFoto) && Number.isFinite(Number(edad)) && Number(edad) >= 18;
}

// Lista válida y sin repetidos, en el orden del catálogo. Si no vino una lista
// (cliente viejo), se usan los campos por defecto.
export function normalizarCamposAlerta(valor, { edad, tieneFoto } = {}) {
  if (!Array.isArray(valor)) return [...CAMPOS_POR_DEFECTO];
  const elegidos = new Set(valor.filter(item => typeof item === 'string'));
  return CAMPOS_ALERTA.map(campo => campo.clave)
    .filter(clave => elegidos.has(clave))
    .filter(clave => clave !== 'foto' || fotoPermitida(edad, tieneFoto));
}

export function rangoEdad(edad) {
  const desde = Math.floor(Number(edad) / 5) * 5;
  return `entre ${desde} y ${desde + 4} años`;
}

export function primerNombre(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || '';
}

export function iniciales(nombre) {
  return String(nombre || '').trim().split(/\s+/).filter(Boolean)
    .map(parte => `${parte[0].toUpperCase()}.`).join(' ');
}

const recortar = texto => {
  const limpio = String(texto || '').trim().replace(/\s+/g, ' ');
  return limpio.length > 160 ? `${limpio.slice(0, 157)}…` : limpio;
};

// caso: { nombreCompleto, edad, sexo, departamento, ciudad, barrio,
// descripcionFisica, vestimenta }. Devuelve [{ clave, etiqueta, valor }] de los
// campos elegidos que tienen valor (la foto va aparte).
export function datosAlerta(caso, campos) {
  const valores = {
    departamento: caso.departamento,
    ciudad: caso.ciudad,
    barrio: caso.barrio,
    rangoEdad: Number.isFinite(Number(caso.edad)) && caso.edad !== '' && caso.edad !== null ? rangoEdad(caso.edad) : '',
    sexo: caso.sexo,
    descripcionFisica: caso.descripcionFisica,
    vestimenta: caso.vestimenta,
    primerNombre: primerNombre(caso.nombreCompleto),
    iniciales: iniciales(caso.nombreCompleto)
  };
  return CAMPOS_ALERTA
    .filter(campo => campo.clave !== 'foto' && campos.includes(campo.clave))
    .map(campo => ({ clave: campo.clave, etiqueta: campo.etiqueta, valor: recortar(valores[campo.clave]) }))
    .filter(item => item.valor);
}

// Mensaje del centro de notificaciones.
export function textoAlertaTemprana(caso, campos) {
  const datos = datosAlerta(caso, campos)
    .map(item => `${item.etiqueta}: ${item.valor}${/[.…!?]$/.test(item.valor) ? '' : '.'}`);
  return [`${ETIQUETA_NO_VERIFICADA}.`, ...datos].join(' ');
}

// "a unos 40 km": la distancia del aviso, redondeada (la ubicación guardada de
// quien recibe ya está redondeada a ~1 km).
export function distanciaAproximada(km) {
  if (km === null || km === undefined || km === '' || !Number.isFinite(Number(km))) return '';
  const valor = Number(km);
  if (valor < 1) return 'a menos de 1 km';
  if (valor < 10) return `a unos ${Math.round(valor)} km`;
  return `a unos ${Math.round(valor / 5) * 5} km`;
}

// Aviso push de la alerta temprana: título con la zona (la ciudad o, si no, el
// barrio, solo si el reportante los eligió) y un cuerpo corto que dice que no
// está verificada. Sin nombre, edad, foto ni ubicación exacta.
export function avisoPushAlertaTemprana(caso, campos, distanciaKm = null) {
  const ciudad = campos.includes('ciudad') ? recortar(caso.ciudad) : '';
  const barrio = campos.includes('barrio') ? recortar(caso.barrio) : '';
  const zona = ciudad || barrio;
  const lugar = ciudad && barrio ? (/^barrio\b/i.test(barrio) ? barrio : `Barrio ${barrio}`) : '';
  const detalle = [lugar, distanciaAproximada(distanciaKm)].filter(Boolean).join(', ');
  return {
    titulo: zona ? `Alerta en tu zona · ${zona}` : 'Alerta en tu zona',
    cuerpo: `Caso en revisión, aún no verificado.${detalle ? ` ${detalle[0].toUpperCase()}${detalle.slice(1)}.` : ''}`
  };
}
