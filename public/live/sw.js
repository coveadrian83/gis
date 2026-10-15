// Service worker Iași Live: aplicația și datele statice merg și fără semnal (ultima versiune descărcată);
// pozițiile în timp real (/live/vehicule) și hărțile de fundal vin mereu din rețea.
const CACHE = 'iasi-live-v1';   // la schimbarea aplicației: v2, v3… (altfel telefonul păstrează versiunea veche)
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon.svg',
  '../vendor/maplibre-gl/maplibre-gl.mjs', '../vendor/maplibre-gl/maplibre-gl-shared.mjs', '../vendor/maplibre-gl/maplibre-gl-worker.mjs',
  '../vendor/maplibre-gl/maplibre-gl.css', '../data/transport/live/forme.json', '../data/transport/gtfs_servicii.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// din cache imediat, actualizat în fundal (stale-while-revalidate) – doar fișierele site-ului, fără API
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/live/vehicule') || u.pathname.startsWith('/live/arhiva')) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
