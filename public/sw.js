// Un solo service worker en /sw.js (scope "/") para la web (/) y la app (/app/).
// Al activarse borra los cachés rastreopy-shell-* anteriores (v6, v7, v8...).
const CACHE_NAME = 'rastreopy-shell-v17';
const OFFLINE_PAGE = '/offline.html';
const APP_SHELL = [
  '/',
  OFFLINE_PAGE,
  '/styles.css',
  // App para celular (/app/): página, estilos, manifest y su entrada propia.
  '/app/',
  '/app/app.css',
  '/app/manifest.webmanifest',
  '/app/app-movil.js',
  '/app/pwa.js',
  '/app/zona.js',
  '/icons/rastreopy.svg',
  '/icons/rastreopy-192.png',
  '/icons/rastreopy-512.png',
  '/icons/rastreopy-badge-96.png',
  '/icons/rastreopy-maskable-192.png',
  '/icons/rastreopy-maskable-512.png',
  '/js/conexion.js',
  '/js/web.js',
  '/js/sesion.js',
  '/js/verificacion.js',
  '/js/estado.js',
  '/js/config.js',
  '/js/api.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/router.js',
  '/js/auth.js',
  '/js/sync.js',
  '/js/feed.js',
  '/js/map.js',
  '/js/report.js',
  '/js/lead.js',
  '/js/stats.js',
  '/js/my-cases.js',
  '/js/admin.js',
  '/js/notifications.js',
  '/js/alerta.js',
  '/js/alerta-campos.js',
  '/js/radio-alerta.js',
  '/js/push-dispositivo.js',
  '/js/eventos.js',
  '/js/tema-inicial.js',
  '/js/app.js',
  // Las que declara styles.css (@font-face): sin ellas offline.html se ve con la
  // tipografía del sistema.
  '/fonts/Inter-400.ttf',
  '/fonts/Inter-500.ttf',
  '/fonts/Inter-600.ttf',
  '/fonts/Inter-700.ttf',
  '/fonts/Inter-800.ttf',
  '/fonts/Sora-600.ttf',
  '/fonts/Sora-700.ttf',
  '/fonts/Sora-800.ttf'
];

// PENDIENTE (sin cambiar por ahora): el middleware cors de backend/server.js
// responde "Vary: Origin" cuando el pedido trae Origin, y los módulos ES
// (<script type="module">) lo traen. La copia que guarda el fetch de abajo queda
// atada a ese Origin, así que caches.match('/js/x.js') sin Origin no la encuentra
// (con el mismo pedido del navegador sí). Hoy no afecta: sin red se muestra
// offline.html. Si algún día la app tiene que arrancar entera sin red, habría que
// guardar los estáticos sin Vary o buscar con { ignoreVary: true }.

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(name => name.startsWith('rastreopy-shell-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
    if (response.ok && APP_SHELL.includes(url.pathname)) {
        await caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    }
    return response;
    } catch {
      // Abrir la app sin red: el HTML cacheado arrancaría sin poder pedir sesión
      // ni casos (la API no se cachea), así que se muestra la pantalla offline.
      // Dentro de la app ya abierta no hay navegaciones (rutas con #), así que
      // el feed en pantalla no se pierde: solo aparece la franja de pwa.js.
      if (request.mode === 'navigate') {
        const offline = await caches.match(OFFLINE_PAGE);
        if (offline) return offline;
      }
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response('Sin conexión. Conéctese a Internet para usar Rastreo PY.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});

// Web Push (backend/push.js). El servidor manda título, texto, la dirección del
// caso en la app y un tag por caso: un aviso nuevo del mismo caso reemplaza al
// anterior. Las alertas tempranas (discreta) llegan sin sonido ni vibración; la
// oficial suena, vibra, queda en pantalla hasta tocarla y vuelve a sonar si
// reemplaza a otro aviso del mismo caso.
const ICONO_AVISO = '/icons/rastreopy-192.png';
// Monocromo (blanco sobre transparente) para la barra de estado de Android.
const BADGE_AVISO = '/icons/rastreopy-badge-96.png';

function opcionesAviso(datos) {
  const texto = (valor, largo = 200) => (typeof valor === 'string' ? valor.slice(0, largo) : '');
  const url = texto(datos.url).startsWith('/') ? texto(datos.url) : '/app/';
  const importante = datos.discreta === false;
  const acciones = (Array.isArray(datos.acciones) ? datos.acciones : [])
    .filter(item => /^[a-z]{1,20}$/.test(item?.accion) && texto(item.titulo, 30))
    .slice(0, 2)
    .map(item => ({ action: item.accion, title: texto(item.titulo, 30) }));
  const opciones = {
    body: texto(datos.cuerpo) || 'Tenés una novedad en Rastreo PY.',
    icon: ICONO_AVISO,
    badge: BADGE_AVISO,
    lang: 'es',
    dir: 'ltr',
    tag: texto(datos.tag, 100) || 'rastreo-py',
    renotify: importante,
    silent: !importante,
    requireInteraction: importante,
    timestamp: Date.now(),
    data: { url }
  };
  if (importante) opciones.vibrate = [200, 100, 200];
  if (acciones.length) opciones.actions = acciones;
  return { titulo: texto(datos.titulo, 100) || 'Rastreo PY', opciones };
}

// Todo push termina en un aviso visible: Chrome penaliza al sitio si un push
// llega y no se muestra nada. Si los datos no se pueden leer o el navegador
// rechaza alguna opción, se muestra un aviso genérico.
self.addEventListener('push', event => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }
  event.waitUntil((async () => {
    let url = '/app/';
    try {
      const { titulo, opciones } = opcionesAviso(datos && typeof datos === 'object' ? datos : {});
      url = opciones.data.url;
      await self.registration.showNotification(titulo, opciones);
    } catch {
      await self.registration.showNotification('Rastreo PY', {
        body: 'Tenés una novedad en Rastreo PY.', icon: ICONO_AVISO, badge: BADGE_AVISO,
        lang: 'es', dir: 'ltr', tag: 'rastreo-py', data: { url }
      });
    }
  })());
});

// Tocar el aviso o su botón "Ver" abre lo mismo: la dirección del aviso.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    // Si el aviso es de la app (/app/...), se prefiere una ventana de la app.
    const appPath = new URL(target).pathname.startsWith('/app/') ? `${self.location.origin}/app/` : self.location.origin;
    const existing = clients.find(client => client.url.startsWith(appPath))
      || clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return self.clients.openWindow(target);
  }));
});
