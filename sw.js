// ══════════════════════════════════════════════════════
//  ZAS Mensajería — Service Worker
//  Cache del app shell + notificaciones locales + offline
// ══════════════════════════════════════════════════════

const SW_VERSION   = 'v1.0.0';
const SHELL_CACHE   = `zas-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `zas-runtime-${SW_VERSION}`;

// Archivos que forman el "esqueleto" de la app y deben funcionar offline
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png',
  './icons/icon-maskable-192x192.png',
  './icons/icon-maskable-512x512.png'
];

// Hosts externos cuyo contenido sí conviene cachear (CDN de librerías/fuentes).
// No incluye el backend de la app (Apps Script) ni servicios de geocodificación,
// esos siempre deben ir a la red para tener datos frescos.
const RUNTIME_CACHEABLE_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Hosts que NUNCA deben pasar por caché (datos dinámicos / API)
const NEVER_CACHE_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'nominatim.openstreetmap.org',
  'tile.openstreetmap.org'
];

// ── INSTALL: precachear el app shell ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Error precacheando app shell:', err))
  );
});

// ── ACTIVATE: limpiar cachés viejas y tomar control ───────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estrategias por tipo de recurso ────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo manejamos GET; el resto (POST a la API, etc.) va directo a la red
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) Backend / geocodificación / mapas en vivo: SIEMPRE red, nunca caché
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) {
    return; // dejamos que el navegador maneje la petición normalmente
  }

  // 2) Navegación (cargar la app / index.html): red primero, con fallback offline
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3) Recursos del propio origen (icons, manifest): caché primero
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4) CDNs conocidas (Leaflet, Google Fonts): caché primero con refresco en segundo plano
  if (RUNTIME_CACHEABLE_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 5) Cualquier otra cosa: dejar pasar tal cual
});

// ── Estrategias de caché ───────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match('./index.html') || await caches.match(request);
    return cached || new Response(
      '<h1>Sin conexión</h1><p>ZAS no pudo cargar. Verifica tu internet e intenta de nuevo.</p>',
      { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// ── NOTIFICACIONES: click en una notificación ─────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientsArr) => {
        const existing = clientsArr.find((c) => c.url.includes('index.html'));
        if (existing) return existing.focus();
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ── PUSH: soporte preparado por si en el futuro se agrega push real ──
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch (e) { payload = { title: 'ZAS', body: event.data.text() }; }

  const title = payload.title || 'ZAS Mensajería';
  const options = {
    body: payload.body || '',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    tag: payload.tag || 'zas-push',
    renotify: true,
    data: { url: payload.url || './index.html' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Permitir que la página fuerce la activación inmediata del SW nuevo ──
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
