/* ProGüzellik service worker: uygulama kabuğunu önbelleğe alır, API yanıtlarını ASLA önbelleğe almaz. */
const CACHE = "proguzellik-v3";
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

// Ana ekran simgesindeki sayı (iOS 16.4+ ana ekran uygulaması, Android/masaüstü Chrome). Desteklenmezse sessizce geçilir.
function updateBadge() {
  return self.registration.getNotifications().then((list) => {
    const nav = self.navigator;
    if (!nav || !nav.setAppBadge) return;
    return list.length ? nav.setAppBadge(list.length) : nav.clearAppBadge();
  }).catch(() => undefined);
}

/* Anlık bildirim (işletme paneli). Yük yalnızca başlık, kısa metin ve panel içi adres içerir. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const url = typeof d.url === "string" && d.url.startsWith("/panel") ? d.url : "/panel/bildirim-merkezi";
  e.waitUntil(self.registration.showNotification(typeof d.title === "string" ? d.title.slice(0, 80) : "ProGüzellik", {
    body: typeof d.body === "string" ? d.body.slice(0, 200) : "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: typeof d.tag === "string" ? d.tag.slice(0, 100) : undefined,
    renotify: typeof d.tag === "string",
    silent: false,
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url },
  }).then(updateBadge));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  updateBadge();
  const raw = e.notification.data && e.notification.data.url;
  const url = typeof raw === "string" && raw.startsWith("/panel") ? raw : "/panel/bildirim-merkezi";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).pathname.startsWith("/panel") && "focus" in c) { c.navigate(url).catch(() => undefined); return c.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
