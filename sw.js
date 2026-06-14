/* ══════════════════════════════════════════════
   ZAS Mensajería — Service Worker v1.0
   • Cache offline
   • Push notifications
   ══════════════════════════════════════════════ */

const CACHE_NAME = 'zas-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Exo+2:wght@300;400;500;600&display=swap'
];

// ── INSTALL: pre-cache assets ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ─────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: network-first, fallback to cache ────
self.addEventListener('fetch', event => {
  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension')) return;

  // For Google Sheets API calls — always network only
  if (event.request.url.includes('script.google.com') || event.request.url.includes('sheets.googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── PUSH: receive push notification ───────────
self.addEventListener('push', event => {
  let data = { title: 'ZAS Mensajería', body: 'Nueva actualización', tag: 'zas-general' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    tag: data.tag || 'zas-general',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: data.url || './index.html' },
    actions: [
      { action: 'open',    title: '📦 Ver solicitud' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── NOTIFICATION CLICK ─────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Si ya hay una ventana abierta, enfocala
      for (const client of clientList) {
        if ((client.url.includes('index') || client.url.includes('ZasTracker')) && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abre una nueva
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── BACKGROUND SYNC (polling de nuevas solicitudes) ──
self.addEventListener('sync', event => {
  if (event.tag === 'zas-check-nuevas') {
    event.waitUntil(checkNuevasSolicitudes());
  }
});

async function checkNuevasSolicitudes() {
  // El cliente guarda el endpoint en IndexedDB; lo leemos aquí
  try {
    const db = await openDB();
    const endpoint = await dbGet(db, 'apiEndpoint');
    const lastCount = (await dbGet(db, 'lastCount')) || 0;
    if (!endpoint) return;

    const res = await fetch(endpoint + '?action=getSolicitudes');
    const data = await res.json();
    const solicitudes = data.solicitudes || [];
    const nuevas = solicitudes.filter(s => s.status === 'nueva' || s.status === 'pendiente');

    if (nuevas.length > lastCount) {
      await dbSet(db, 'lastCount', nuevas.length);
      await self.registration.showNotification('ZAS — Nueva solicitud 📦', {
        body: `Hay ${nuevas.length - lastCount} solicitud(es) nueva(s)`,
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-72x72.png',
        tag: 'zas-nuevas',
        renotify: true,
        vibrate: [200, 100, 200]
      });
    }
  } catch (e) {
    console.warn('[ZAS SW] checkNuevasSolicitudes error:', e);
  }
}

// ── Mini IndexedDB helpers ─────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zasDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('store');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}
function dbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('store').objectStore('store').get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}
function dbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('store', 'readwrite').objectStore('store').put(value, key);
    req.onsuccess = resolve;
    req.onerror = reject;
  });
}
