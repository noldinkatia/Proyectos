// Declaración de responsabilidad que acepta quien reporta antes de publicar (la
// muestra report.js con dialogo.js). El servidor exige declaracionAceptada: true con
// esta misma versión y guarda la versión y la hora (servidor) en el caso
// (migración 007). Sin dependencias: lo carga también el backend.
// Si el texto cambia, cambiá DECLARACION_VERSION: así queda registro de qué
// versión aceptó cada reporte.
export const DECLARACION_VERSION = '2026-10-26';

export const DECLARACION_TITULO = 'Antes de publicar';

export const DECLARACION_PUNTOS = [
  'La información que cargaste es verdadera, según lo que sabés.',
  'Hiciste la denuncia ante la Policía, o vas a hacerla cuanto antes.',
  'Publicar datos falsos, usar el reporte para molestar a alguien o para pedir dinero puede tener consecuencias legales.'
];

export const DECLARACION_CASILLA = 'Entiendo y confirmo que la información es verdadera.';
