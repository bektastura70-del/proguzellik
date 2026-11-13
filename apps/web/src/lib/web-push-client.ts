"use client";

/**
 * Tarayıcı tarafı Web Push yardımcıları. İzin YALNIZCA kullanıcının bir düğmeye dokunmasıyla istenir
 * (sayfa açılışında otomatik izin istenmez). iPhone/iPad'de yalnızca ana ekrana eklenmiş uygulamada çalışır (iOS 16.4+).
 */
export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(scope: string, script: string) {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration(scope);
  if (existing && new URL(existing.scope).pathname === new URL(scope, location.origin).pathname) return existing;
  // Service worker yalnızca üretim derlemesinde kayıtlıdır; yoksa burada kaydedilir.
  return navigator.serviceWorker.register(script, { scope, updateViaCache: "none" }).catch(() => null);
}

export async function pushState(scope: string): Promise<PushState> {
  // Mağaza uygulamasının içinde tarayıcı bildirimi kullanılmaz (uygulama kendi hatırlatmalarını gösterir).
  if (typeof navigator !== "undefined" && /ProGuzellikApp\/\d/.test(navigator.userAgent)) return "unsupported";
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  }
  if (isIos() && !isStandalone()) return "ios-install";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration(scope);
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Kullanıcı dokunuşuyla çağrılır: izin ister, cihazı abone eder ve sunucuya kaydeder. */
export async function enablePush(opts: { scope: string; script: string; vapidKey: string; save: (sub: PushSubscriptionJSON) => Promise<unknown> }): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration(opts.scope, opts.script);
  if (!reg) return "unsupported";
  await navigator.serviceWorker.ready;
  const active = reg.active ?? (await new Promise<ServiceWorker | null>((res) => {
    const sw = reg.installing ?? reg.waiting;
    if (!sw) return res(null);
    sw.addEventListener("statechange", () => sw.state === "activated" && res(sw));
  }));
  if (!active) return "unsupported";
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(opts.vapidKey) });
    } catch {
      // Gizli pencere, tarayıcı ayarı veya push servisine ulaşılamaması
      throw new Error("Bu tarayıcı bildirim aboneliği oluşturamadı. Gizli pencere kullanıyorsanız normal pencerede deneyin.");
    }
  }
  try {
    await opts.save(sub.toJSON());
  } catch (e) {
    await sub.unsubscribe().catch(() => undefined);
    throw e;
  }
  return "on";
}

/** Bu cihazda bildirimi kapatır (çıkışta da çağrılır: paylaşılan cihazda sonraki kişiye bildirim gitmez). */
export async function disablePush(scope: string, remove: (endpoint: string) => Promise<unknown>) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(scope);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await remove(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/**
 * Tarayıcıda abonelik var ama sunucu kaydı silinmiş olabilir (geçersiz sayıldı, kayıt sırasında bağlantı koptu).
 * Sayfa açılışında sessizce yeniden kaydedilir; yeni izin istenmez.
 */
export async function syncPush(scope: string, save: (sub: PushSubscriptionJSON) => Promise<unknown>) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration(scope);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub.toJSON()).catch(() => undefined);
}
