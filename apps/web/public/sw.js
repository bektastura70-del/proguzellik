/* ProGüzellik service worker: uygulama kabuğunu önbelleğe alır, API yanıtlarını ASLA önbelleğe almaz. */
const CACHE = "proguzellik-v2";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("proguzellik-") && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Salon uygulamaları (/r/…) kendi service worker'larıyla çalışır; işletme önbelleği onlara karışmaz.
  if (url.pathname.startsWith("/r/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".png")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});
