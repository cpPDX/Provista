// Provista Service Worker
// Cache-first for static assets (images, fonts), network-first for JS/CSS and API data

const SHELL_CACHE = 'provista-shell-v4';
const API_CACHE = 'provista-api-v4';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/auth.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/autocomplete.js',
  '/js/prices.js',
  '/js/shoppingList.js',
  '/js/csvImport.js',
  '/js/spend.js',
  '/js/more.js',
  '/js/mealPlan.js',
  '/js/onboarding.js',
  '/js/app.js',
  '/js/vendor/idb.min.js',
  '/js/offline.js',
  '/js/install-prompt.js',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-512-maskable.svg',
  '/manifest.json'
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // JS and CSS: network-first so deploys take effect immediately; cache fallback when offline
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // Static assets (images, icons, fonts): cache-first
  event.respondWith(cacheFirstWithNetworkFallback(request));
});

// Cache-first: serve from cache immediately, fall back to network
async function cacheFirstWithNetworkFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Cache successful responses for future use
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // For navigation requests, return cached index.html (SPA fallback)
    if (request.mode === 'navigate') {
      const cachedIndex = await caches.match('/index.html');
      if (cachedIndex) return cachedIndex;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Network-first: try network, fall back to cache, then structured error
async function networkFirstWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    // Cache successful GET responses
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network failed — try cache
    if (request.method === 'GET') {
      const cached = await caches.match(request);
      if (cached) return cached;
    }

    // No cache available — return structured offline error
    return new Response(
      JSON.stringify({ error: 'offline', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
