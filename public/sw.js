// Offline cache for the production build: network first for navigations, cache first for the
// hashed files under ./assets/ (precached at install, since the page loads them before this
// worker exists). Everything else goes to the network untouched: in particular the Vite dev
// server's /src, /@vite and /node_modules modules, which a worker installed by a preview build
// on the same localhost origin would otherwise keep serving stale. Only OK responses are kept.
const CACHE = 'stellar-ear-v2'; // v1 also cached dev modules and error responses; activate drops it
const ASSETS = new URL('./assets/', location).pathname;
const SHELL = ['./manifest.webmanifest', './icon.svg'];
const SHELL_PATHS = new Set(SHELL.map((p) => new URL(p, location).pathname));

// Cache a built index.html together with every hashed file it names, assets first, so the
// offline copy never points at files that are not cached. A dev-server page names none of
// ./assets/ and is never kept.
async function keepShell(res) {
  const html = await res.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (!assets.length) return;
  const c = await caches.open(CACHE);
  const missing = [];
  for (const a of assets) if (!(await c.match(a))) missing.push(a);
  await c.addAll(missing);
  await c.put('./index.html', res);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const res = await fetch('./index.html', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`index.html: ${res.status}`);
      await keepShell(res);
      await (await caches.open(CACHE)).addAll(SHELL);
    })(),
  );
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) e.waitUntil(keepShell(r.clone()).catch(() => {}));
          return r;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith(ASSETS)) {
    // hashed names: a cached copy is never stale
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            }
            return r;
          }),
      ),
    );
    return;
  }
  if (SHELL_PATHS.has(url.pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())));
  }
});
