// A simple Service Worker to satisfy PWA install requirements
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installed');
});

self.addEventListener('fetch', (event) => {
    // We just pass the request through normally so the app stays live
    event.respondWith(fetch(event.request));
});