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

  // Reportar caso (7)
  // reportEdicion: al editar un caso propio en revisión, { casoId, teniaFoto,
  // fotoAccion: 'mantener' | 'reemplazar' | 'quitar' }; null al reportar uno nuevo.
  reportEdicion: null,
  reportMarker: null,
  reportGeocodeToken: 0,
  selectedReportPhoto: null,
  reportPhotoPreviewUrl: '',
  reportEnviando: false,
  paraguayLocationsPromise: null,

  // Aportar pista (3)
  leadMarker: null,
  selectedLeadPhotos: [],
  leadPhotoPreviewUrls: [],

  // Interfaz de usuario (2)
  toastTimeout: null,
  notificationRefreshTimer: null
};

if (typeof window !== 'undefined') {
  window.estado = estado;
}
