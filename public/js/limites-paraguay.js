// Límites de Paraguay para validar el punto del mapa de reportes y pistas. Un
// rectángulo aproximado del país con un margen de ~50 km: así se aceptan las
// ciudades de frontera (Clorinda, Posadas, Foz do Iguaçu, Ponta Porã…) y se
// rechaza un punto que quedó en otro lado (un toque lejos en el mapa o la
// ubicación de una PC, que el navegador suele calcular por la IP).
// Sin dependencias: lo usan el servidor (case-routes.js, clue-routes.js) y la
// interfaz (report.js, lead.js, admin.js).

// Extremos del país (grados decimales; sur y oeste son negativos).
export const LIMITES_PARAGUAY = { latMin: -27.61, latMax: -19.29, lngMin: -62.65, lngMax: -54.26 };
export const MARGEN_KM = 50;

const KM_POR_GRADO = 111.32;

export const MENSAJE_FUERA_DE_PARAGUAY = 'El punto del mapa quedó fuera de Paraguay. Marcá en el mapa el lugar de la desaparición.';
export const MENSAJE_PISTA_FUERA_DE_PARAGUAY = 'El punto del mapa quedó fuera de Paraguay. Marcá en el mapa el lugar donde viste a la persona.';
export const MENSAJE_UBICACION_FUERA_DE_PARAGUAY = 'Tu ubicación no parece estar en Paraguay (el navegador de la PC puede ubicarte mal). Marcá el punto en el mapa.';
// Ficha de validación (admin.js): qué hacer depende del estado del caso. En
// revisión no existe "Devolver a revisión": se rechaza con motivo o lo corrige quien
// reportó; en cualquier otro estado, se devuelve a revisión.
export const MENSAJE_ADMIN_FUERA_DE_PARAGUAY = 'El punto del mapa está fuera de Paraguay.';
export const ACCION_ADMIN_FUERA_PENDIENTE = 'Rechazalo indicando el motivo, o esperá a que quien reportó lo corrija desde «Editar reporte».';
export const ACCION_ADMIN_FUERA_OTRO_ESTADO = 'Devolvelo a revisión para que lo corrija.';

// true si (lat, lng) está dentro del rectángulo más el margen. El margen en
// longitud se ajusta a la latitud (un grado de longitud mide menos lejos del ecuador).
export function dentroDeParaguay(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  const { latMin, latMax, lngMin, lngMax } = LIMITES_PARAGUAY;
  const margenLat = MARGEN_KM / KM_POR_GRADO;
  if (la < latMin - margenLat || la > latMax + margenLat) return false;
  const margenLng = MARGEN_KM / (KM_POR_GRADO * Math.cos(la * Math.PI / 180));
  return ln >= lngMin - margenLng && ln <= lngMax + margenLng;
}

// Distancia en km (Haversine), para el aviso de distancia a la ciudad elegida.
export function distanciaEntreKm(a, b) {
  const rad = g => g * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
