// Radio de las alertas de zona: 160 km (documento del Workshop, sección 5.2).
// Una sola constante para el servidor (backend/geocerca.js, a quién se avisa) y la
// interfaz (círculo del mapa, leyenda y textos): así no vuelven a desfasarse.
// Sin dependencias ni efectos al importarse: lo carga también Node.
export const RADIO_ALERTA_KM = 160;
