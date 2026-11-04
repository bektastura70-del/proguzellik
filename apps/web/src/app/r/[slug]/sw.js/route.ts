import { NextRequest, NextResponse } from "next/server";
import { salonApp } from "../salon-app";

/** Service worker sürümü: içerik değişince artırılır; tarayıcı yeni sürümü kurar, eski önbelleği siler. */
const SW_VERSION = "1";

/**
 * Salon uygulamasının service worker'ı. Kapsamı yalnızca /r/{slug}/ (betik o klasörden sunulur).
 * Güvenlik kuralları:
 *  - HTML sayfaları, /api yanıtları ve kişisel veri ASLA önbelleğe alınmaz.
 *  - Önbellekte yalnızca çevrimdışı ekranı ve salon simgesi bulunur.
 *  - Bildirime tıklanınca yalnızca bu salonun kapsamındaki bir adres açılır.
 */
function script(slug: string) {
  const scope = `/r/${slug}/`;
  return `/* ProGüzellik salon uygulaması (${slug}) v${SW_VERSION} */
const SCOPE = ${JSON.stringify(scope)};
const PREFIX = ${JSON.stringify(`pg-salon-${slug}-`)};
const CACHE = PREFIX + ${JSON.stringify(`v${SW_VERSION}`)};
const OFFLINE = SCOPE + "cevrimdisi";
const ICON = SCOPE + "simge/192";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, ICON])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.startsWith(SCOPE + "api/")) return; // kişisel veri: her zaman ağdan, önbelleksiz
  if (req.mode === "navigate") {
    // Sayfa her zaman ağdan gelir; yalnızca bağlantı yoksa çevrimdışı ekranı gösterilir.
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const title = typeof d.title === "string" ? d.title.slice(0, 80) : "Randevu bildirimi";
  const url = typeof d.url === "string" && d.url.startsWith(SCOPE) ? d.url : SCOPE + "uygulama";
  e.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === "string" ? d.body.slice(0, 200) : "",
    icon: ICON,
    badge: ICON,
    tag: typeof d.tag === "string" ? d.tag.slice(0, 100) : undefined,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const raw = e.notification.data && e.notification.data.url;
  const url = typeof raw === "string" && raw.startsWith(SCOPE) ? raw : SCOPE + "uygulama";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).pathname.startsWith(SCOPE) && "focus" in c) { c.navigate(url).catch(() => undefined); return c.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;
}

function retire(slug: string) {
  return `/* ProGüzellik salon uygulaması (${slug}) kapatıldı */
const PREFIX = ${JSON.stringify(`pg-salon-${slug}-`)};
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => caches.delete(k))))
    .then(() => self.registration.unregister()));
});
`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const app = await salonApp(slug);
  if (!app) return new NextResponse(null, { status: 404 });
  // Uygulama kapatıldıysa kurulu service worker kendini kaldırır ve önbelleğini siler (geri alma güvenliği).
  const body = app !== "error" && app.features.installable ? script(slug) : app === "error" ? null : retire(slug);
  if (!body) return new NextResponse(null, { status: 503 });
  return new NextResponse(body, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store" },
  });
}
