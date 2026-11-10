/* Finance Real — service worker. Cache do "app shell" para uso offline.
 * Ao publicar uma versão nova, mude VERSION (o scripts/check.js confere com o package.json). */
const VERSION = "5.1.0";
const CACHE = `finance-real-v${VERSION}`;
const SHELL = [
  "./", "index.html", "config.js", "manifest.webmanifest",
  "css/app.css",
  "js/core.js", "js/i18n.js", "js/drive.js", "js/app.js",
  "vendor/react.production.min.js", "vendor/react-dom.production.min.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/syne-latin-400-normal.woff2", "fonts/syne-latin-500-normal.woff2", "fonts/syne-latin-600-normal.woff2",
  "fonts/syne-latin-700-normal.woff2", "fonts/syne-latin-800-normal.woff2",
  "fonts/jetbrains-mono-latin-400-normal.woff2", "fonts/jetbrains-mono-latin-500-normal.woff2", "fonts/jetbrains-mono-latin-600-normal.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("finance-real-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google/Drive etc. nunca passam pelo cache

  // Navegação e config.js: rede primeiro (pega atualizações/ajustes), cache como reserva offline.
  if (req.mode === "navigate" || url.pathname.endsWith("/config.js")) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match("index.html")))
    );
    return;
  }
  // Demais arquivos estáticos: cache primeiro.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
