const CACHE_NAME = 'pablometro-pwa-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './favicon.png',
  './municipios.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Fuerza al Service Worker a activarse inmediatamente
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Dejar pasar libremente a Google Analytics y a la API meteorológica (gestionada en app.js)
  if (event.request.url.includes('workers.dev') || event.request.url.includes('google-analytics.com')) {
    return;
  }

  // Patrón Stale-While-Revalidate para los archivos estáticos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Solo cachear respuestas exitosas (evita guardar pantallas de error de red)
        if (networkResponse && networkResponse.ok && event.request.url.startsWith('http')) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallar silenciosamente si estamos sin conexión
      });

      // Si existe en caché, devolver instantáneamente. La red actualiza la caché en segundo plano.
      return cachedResponse || fetchPromise;
    })
  );
});