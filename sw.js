// Service worker: keeps the app usable offline. BUILD is stamped by the deploy workflow.
const BUILD = '__BUILD__';
const SHELL = `ff-shell-${BUILD}`;
const DATA = 'ff-data-v1';

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'assets/css/app.css',
  'assets/js/app.js', 'assets/js/api.js', 'assets/js/store.js', 'assets/js/ui.js', 'assets/js/charts.js',
  'assets/js/components.js', 'assets/js/tdee.js', 'assets/js/pwa.js',
  'assets/js/views/today.js', 'assets/js/views/food.js', 'assets/js/views/weight.js', 'assets/js/views/train.js',
  'assets/js/views/progress.js', 'assets/js/views/whoop.js', 'assets/js/views/settings.js',
  'assets/js/views/plans.js', 'assets/js/views/cardio.js', 'assets/js/views/health.js', 'assets/js/views/habits.js',
  'assets/js/views/journal.js', 'assets/js/views/more.js', 'assets/js/quickadd.js',
  'assets/js/sortable.js', 'assets/js/push.js', 'assets/js/stats.js', 'assets/js/views/foodhome.js', 'assets/js/views/trainhome.js',
  'assets/js/views/body.js', 'assets/js/views/insights.js', 'assets/js/views/report.js', 'assets/js/views/projection.js', 'assets/js/views/sync.js',
  'assets/js/nutrients.js', 'assets/js/fill.js', 'assets/js/phases.js', 'assets/js/views/micros.js', 'assets/js/views/fillmacros.js',
  'assets/js/views/drinks.js', 'assets/js/views/phases.js', 'assets/js/views/users.js',
  'icons/icon-v2.svg', 'icons/logo-mark.svg', 'icons/favicon-v2-32.png', 'icons/icon-v2-192.png', 'icons/apple-touch-icon-v2.png',
  'assets/fonts/barlow-latin-400-normal.woff2', 'assets/fonts/barlow-latin-500-normal.woff2', 'assets/fonts/barlow-latin-600-normal.woff2',
  'assets/fonts/barlow-condensed-latin-500-normal.woff2', 'assets/fonts/barlow-condensed-latin-600-normal.woff2', 'assets/fonts/barlow-condensed-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ff-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// API routes that must never be served from cache.
// Photos and backups are private files: never kept in the offline cache.
const NO_CACHE = /r=(whoop\/connect|whoop\/callback|export|cron|photos\/file|backups\/download)/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/api/')) {
    if (NO_CACHE.test(url.search)) return;
    e.respondWith(networkFirst(req, DATA));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, 'index.html'));
    return;
  }
  e.respondWith(networkFirst(req, SHELL));
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (hit) return hit;
    if (req.url.includes('/api/')) {
      return new Response(JSON.stringify({ error: "You're offline and this hasn't been loaded before." }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}

/* ---------- reminders (web push) ---------- */

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Farrell Fitness', {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: 'icons/icon-v2-192.png',
    badge: 'icons/favicon-v2-32.png',
    data: { url: m.url || '#/today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data?.url || '#/today'), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); try { await w.navigate(target); } catch { w.postMessage({ type: 'open', url: target }); } return; }
    }
    await self.clients.openWindow(target);
  })());
});
