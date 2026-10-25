// Datos que el reportante elige mostrar en la alerta temprana (antes de que la
// administración valide el caso). Lo usan el formulario de reporte (vista previa)
// y el backend (backend/alertas.js), así los dos arman el mismo texto. Sin DOM.
//
// Nunca se ofrecen: contacto, número de denuncia, documento, dirección exacta ni
// ubicación exacta. Lo que llegue fuera de esta lista se ignora.

export const ETIQUETA_NO_VERIFICADA = 'Pendiente / En revisión – No verificada';

export const CAMPOS_ALERTA = [
  { clave: 'departamento', etiqueta: 'Departamento', porDefecto: true },
  { clave: 'ciudad', etiqueta: 'Ciudad', porDefecto: true },
  { clave: 'barrio', etiqueta: 'Zona / barrio aproximado', porDefecto: true },
  { clave: 'rangoEdad', etiqueta: 'Rango de edad', porDefecto: false },
  { clave: 'sexo', etiqueta: 'Sexo', porDefecto: false },
  { clave: 'descripcionFisica', etiqueta: 'Descripción física', porDefecto: false },
  { clave: 'vestimenta', etiqueta: 'Vestimenta', porDefecto: false },
  { clave: 'primerNombre', etiqueta: 'Primer nombre', porDefecto: false },
  { clave: 'iniciales', etiqueta: 'Iniciales', porDefecto: false },
  { clave: 'foto', etiqueta: 'Fotografía', porDefecto: false }
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
  return `${desde} a ${desde + 4} años`;
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

// Texto del push: genérico; a lo sumo la ciudad, si el reportante la eligió.
export function cuerpoPushAlertaTemprana(caso, campos) {
  const ciudad = campos.includes('ciudad') ? recortar(caso.ciudad) : '';
  return `Alerta en tu zona${ciudad ? ` (${ciudad})` : ''}: caso en revisión, aún no verificado`;
}
