// This tool moved to https://nullmember.github.io/PnPTools/. This worker
// replaces the old one and removes itself, so the old copy stops serving.
// (Caches are left alone: the PnPTools site shares them.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(self.registration.unregister());
});
