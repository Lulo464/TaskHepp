// Tasklog service worker: makes the app installable and usable offline.
// The app shell is cached; API data comes live and, without a connection, from the last copy.

const CACHE = 'tasklog-shell-v2';
const API_CACHE = 'tasklog-api-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
/** Without an answer by then the last copy is shown; the answer still updates it when it comes. */
const API_TIMEOUT_MS = 4000;
/** Not kept offline: photos (large), downloads, and things that only make sense live. */
const API_SKIP = /^\/api\/(attachments|me\/export|tags\/ha|health|ha\/|calendar-feed|feed)/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== API_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** A cached API answer, marked so the app knows it is offline and how old the data is. */
async function fromCache(req) {
  const hit = await caches.match(req, { cacheName: API_CACHE });
  if (!hit) return new Response(JSON.stringify({ error: 'Offline – diese Daten sind auf dem Gerät noch nicht gespeichert' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Tasklog-Offline': '1' } });
  const headers = new Headers(hit.headers);
  headers.set('X-Tasklog-Offline', '1');
  return new Response(hit.body, { status: hit.status, headers });
}

async function apiGet(event) {
  const req = event.request;
  const network = fetch(req).then(async res => {
    if (res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('X-Tasklog-Cached-At', new Date().toISOString());
      const copy = new Response(await res.clone().blob(), { status: 200, headers });
      await (await caches.open(API_CACHE)).put(req, copy);
    }
    // Signed out: nothing personal stays on the device.
    if (res.status === 401) await caches.delete(API_CACHE);
    return res;
  });
  // Keep going after a timeout so the late answer still lands in the cache.
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), API_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return fromCache(req);
  } catch {
    return fromCache(req);
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Only the app works offline; the admin UI and the wall display stay live.
    const from = req.referrer ? new URL(req.referrer).pathname : '/';
    if (/^\/(admin|monitor)/.test(from)) return;
    if (!API_SKIP.test(url.pathname)) event.respondWith(apiGet(event));
    return;
  }
  // Login, admin UI and wall display always go to the network.
  if (/^\/(auth|admin|monitor)(\/|$)/.test(url.pathname) || url.pathname === '/admin.html') return;

  // App pages: network first so updates arrive, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then(c => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })),
    );
  }
});

// The app asks to forget the data on sign-out.
self.addEventListener('message', event => {
  if (event.data === 'tasklog:clear') event.waitUntil(caches.delete(API_CACHE));
});
