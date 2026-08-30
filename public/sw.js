// Provista Service Worker
// Network-first for navigations, JS/CSS, and API data; cache-first for static assets.

const SHELL_CACHE = 'provista-shell-v14';
const API_CACHE = 'provista-api-v5';

const SHELL_ASSETS = [
  '/',
  '/landing.html',
  '/index.html',
  '/legacy-app',
  '/login.html',
  '/css/landing.css',
  '/css/style.css',
  '/css/auth.css',
  '/css/parentExperience.css',
  '/css/rapidShoppingCapture.css',
  '/js/auth.js',
  '/js/landing.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/autocomplete.js',
  '/js/prices.js',
  '/js/shoppingList.js',
  '/js/rapidShoppingCapture.js',
  '/js/csvImport.js',
  '/js/spend.js',
  '/js/more.js',
  '/js/moreInit.js',
  '/js/pantry.js',
  '/js/mealPlan.js',
  '/js/home.js',
  '/js/onboarding.js',
  '/js/reactHomeBridge.js',
  '/js/scan.js',
  '/js/scanner.js',
  '/js/app.js',
  '/js/vendor/idb.min.js',
  '/js/offline.js',
  '/js/install-prompt.js',
  '/brand/provista-mark.svg',
  '/screenshots/meal-plan.jpg',
  '/screenshots/shopping-list.jpg',
  '/screenshots/pantry.jpg',
  '/og.jpg',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-512-maskable.svg',
  '/manifest.json'
];

async function cacheReactAppShell(cache) {
  try {
    const response = await fetch('/app', { credentials: 'same-origin' });
    if (!response.ok) return;

    const html = await response.clone().text();
    await cache.put('/app', response);

    const assetPaths = [...html.matchAll(/(?:src|href)="(\/react-preview\/assets\/[^"]+)"/g)]
      .map(match => match[1]);
    const uniqueAssets = [...new Set(assetPaths)];
    await Promise.all(uniqueAssets.map(asset => cache.add(asset).catch(() => undefined)));
  } catch {
    // The legacy shell remains available if the React build cannot be cached.
  }
}

// Install: pre-cache both the legacy compatibility shell and the current React Home shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await cache.addAll(SHELL_ASSETS);
      await cacheReactAppShell(cache);
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

  // Navigations should pick up the latest deployed shell when online, while
  // still falling back to the appropriate cached React or legacy app offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // JS and CSS: network-first so deploys take effect immediately; cache fallback when offline.
  // Vite emits hashed React assets under /react-preview/assets/; those are also
  // shell resources even though their filenames are generated at build time.
  if (
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/react-preview/assets/')
  ) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // Static assets (images, icons, fonts): cache-first
  event.respondWith(cacheFirstWithNetworkFallback(request));
});

function cacheNameForRequest(request) {
  const url = new URL(request.url);
  if (
    request.mode === 'navigate' ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/react-preview/assets/')
  ) {
    return SHELL_CACHE;
  }
  return API_CACHE;
}

function navigationFallbackPath(request) {
  const url = new URL(request.url);
  const legacyFeature = url.pathname === '/legacy-app' ||
    (url.pathname === '/app' && (url.searchParams.has('tab') || url.searchParams.get('legacy') === '1'));
  return legacyFeature ? '/legacy-app' : '/app';
}

// Cache-first: serve from cache immediately, fall back to network
async function cacheFirstWithNetworkFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Network-first: try network, fall back to cache, then structured error
async function networkFirstWithCacheFallback(request) {
  const cacheName = cacheNameForRequest(request);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.method === 'GET') {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const fallback = await cache.match(navigationFallbackPath(request));
        if (fallback) return fallback;
      }
    }

    return new Response(
      JSON.stringify({ error: 'offline', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
