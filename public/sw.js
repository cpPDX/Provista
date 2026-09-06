// Provista Service Worker
// Network-first for navigations, JS/CSS, and API data; cache-first for static assets.

const SHELL_CACHE = 'provista-shell-v15';
const API_CACHE = 'provista-api-v5';

const SHELL_ASSETS = [
  '/',
  '/landing.html',
  '/login.html',
  '/css/landing.css',
  '/css/style.css',
  '/css/auth.css',
  '/js/landing.js',
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
    // Installation can finish without an authenticated React shell cache.
  }
}

// Install: pre-cache the public/auth surfaces plus the current React app shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await cache.addAll(SHELL_ASSETS);
      await cacheReactAppShell(cache);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches, including legacy authenticated shell assets.
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // JS and CSS stay network-first so deploys take effect immediately. Vite's
  // hashed assets are cached dynamically from the current React shell.
  if (
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/react-preview/assets/')
  ) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

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
  if (url.pathname === '/legacy-app' || url.pathname.startsWith('/app')) return '/app';
  return '/';
}

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
