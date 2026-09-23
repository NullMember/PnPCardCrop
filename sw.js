// PnPTools offline support. Canonical copy lives in the hub's shared/ folder;
// scripts/sync-shared.sh copies it to the hub root and every tool root (a
// service worker only controls pages at or below its own folder).
//
// - Same-origin files: network first, so users always get the latest version
//   when online, falling back to the cache when offline.
// - Pinned CDN libraries and fonts: cache first (a pinned version never changes).
// - Pages post the list of resources they loaded, so everything a tool needs
//   is cached right after the first visit.

const CACHE = 'pnptools-v1';
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('pnptools-') && k !== CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

function isCdn(url) {
    return CDN_HOSTS.includes(url.hostname);
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
    } else if (isCdn(url)) {
        event.respondWith(cacheFirst(request));
    }
});

// { type: 'precache', urls: [...] } — cache what the page has already loaded
// (and files it will load later, like workers) without waiting for a refetch.
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'precache' || !Array.isArray(data.urls)) return;
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(data.urls.map(async (href) => {
            try {
                const url = new URL(href, self.location.href);
                const sameOrigin = url.origin === self.location.origin;
                if (!sameOrigin && !isCdn(url)) return;
                if (!sameOrigin && await cache.match(url.href)) return;
                const response = await fetch(url.href, sameOrigin ? {} : { mode: 'no-cors' });
                if (response.ok || response.type === 'opaque') await cache.put(url.href, response);
            } catch (err) { /* offline or blocked: skip */ }
        }));
    })());
});
