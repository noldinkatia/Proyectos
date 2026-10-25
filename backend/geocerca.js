// Geocerca de las alertas de zona: distancia de Haversine (en JS y en SQL) y
// radio de 160 km (documento del Workshop, sección 5.2).

export const RADIO_ALERTA_KM = 160;
const RADIO_TIERRA_KM = 6371;
// Margen de 1 mm: un punto calculado justo sobre el borde cuenta como adentro
// aunque el redondeo de coma flotante lo deje en 160,000000000001.
const MARGEN_BORDE_KM = 1e-6;

const radianes = grados => grados * Math.PI / 180;

export function distanciaKm(lat1, lng1, lat2, lng2) {
  const a = Math.sin(radianes(lat2 - lat1) / 2) ** 2
    + Math.cos(radianes(lat1)) * Math.cos(radianes(lat2)) * Math.sin(radianes(lng2 - lng1) / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function dentroDelRadio(distancia, radio = RADIO_ALERTA_KM) {
  return distancia <= radio + MARGEN_BORDE_KM;
}

// La misma fórmula en SQL, entre la columna (alias.latitud, alias.longitud) y los
// parámetros posicionales de latitud y longitud del caso.
export function distanciaSql(alias, latParam, lngParam) {
  return `(2 * ${RADIO_TIERRA_KM} * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS(${alias}.latitud - ${latParam}::double precision) / 2), 2)
    + COS(RADIANS(${latParam}::double precision)) * COS(RADIANS(${alias}.latitud))
      * POWER(SIN(RADIANS(${alias}.longitud - ${lngParam}::double precision) / 2), 2)))))`;
}

export function dentroDelRadioSql(expresionDistancia) {
  return `${expresionDistancia} <= ${RADIO_ALERTA_KM + MARGEN_BORDE_KM}`;
}

// La ubicación del usuario se guarda redondeada a 2 decimales (≈1,1 km).
export function ubicacionAproximada(valor) {
  return Math.round(Number(valor) * 100) / 100;
}
