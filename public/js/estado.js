export const estado = {
  // Autenticación (5)
  pendingRegistration: null,
  resendTimer: null,
  activeOtpEmail: '',
  activeOtpPurpose: 'registro',
  resendSeconds: 0,

  // Mapa (2)
  activeMap: null,
  activeMarkers: [],

  // Feed y sincronización pública (7)
  locatedExpiryTimer: null,
  publicStatsTimer: null,
  liveSyncTimer: null,
  liveSyncTick: null,
  liveSyncInProgress: false,
  lastPublicCaseSignature: '',
  feedCurrentPage: 1,
  feedFilteredCases: [],

  // Mis casos (2)
  lastMyCasesSignature: '',
  misCasos: [],

  // Panel de administración y estadísticas (2)
  lastAdminDashboardSignature: '',
  activeStatsView: 'porMes',

  // Enrutador (3)
  currentRouteUrl: '',
  routeApplyToken: 0,
  pendingDestination: null,

  // Reportar caso (8)
  // reportEdicion: al editar un caso propio en revisión, { casoId, teniaFoto,
  // fotoAccion: 'mantener' | 'reemplazar' | 'quitar' }; null al reportar uno nuevo.
  reportEdicion: null,
  // reportCambios: hubo cambios desde que se abrió el formulario (aviso al salir).
  reportCambios: false,
  reportMarker: null,
  reportGeocodeToken: 0,
  // Punto de la ciudad elegida según Nominatim (aviso de distancia, report.js) y
  // el punto que se aceptó lejos de ella ("Dejarlo así").
  reportReferencia: null,
  reportDistanciaAceptada: null,
  selectedReportPhoto: null,
  reportPhotoPreviewUrl: '',
  reportEnviando: false,
  paraguayLocationsPromise: null,

  // Aportar pista (3)
  leadMarker: null,
  selectedLeadPhotos: [],
  leadPhotoPreviewUrls: [],

  // Panel de administración (1)
  // Horas que la ficha de un adulto localizado sigue pública (VENTANA_LOCALIZADOS_HORAS
  // del servidor, llega con /admin/casos).
  ventanaLocalizadosHoras: 24,

  // Interfaz de usuario (2)
  toastTimeout: null,
  notificationRefreshTimer: null
};

if (typeof window !== 'undefined') {
  window.estado = estado;
}
