"use client";

/**
 * Pro Güzellik iOS/Android uygulaması (Capacitor kabuğu) ile köprü.
 * Uygulama siteyi kendi içinde açar ve tarayıcı kimliğine "ProGuzellikApp/<sürüm>" ekler. Bu dosya:
 *  - sitenin uygulama içinde açıldığını anlar (ana ekrana ekleme ve tarayıcı bildirimi önerileri gizlenir),
 *  - telefonun kendi hatırlatma bildirimlerini (yerel bildirim) randevulara göre planlar; sunucuya veri gitmez.
 * Uygulama dışında (normal tarayıcı) hiçbir işlev çalışmaz.
 */

export const NATIVE_UA = /ProGuzellikApp\/\d/;

export function isNativeUa(ua: string | null | undefined) {
  return !!ua && NATIVE_UA.test(ua);
}

type CapBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: <T = unknown>(plugin: string, method: string, options?: unknown) => Promise<T>;
};

function cap(): CapBridge | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Capacitor?: CapBridge }).Capacitor;
  return c && typeof c.nativePromise === "function" && c.isNativePlatform?.() ? c : null;
}

export function isNativeApp() {
  if (typeof navigator === "undefined") return false;
  return isNativeUa(navigator.userAgent);
}

function nativeIndex(c: CapBridge) {
  return c.getPlatform?.() === "ios" ? "capacitor://localhost/index.html" : "https://localhost/index.html";
}

export type SalonMeta = { slug: string; name?: string | null; logoUrl?: string | null };

function metaParams(q: URLSearchParams, meta?: SalonMeta) {
  if (!meta) return;
  q.set("salon", meta.slug);
  if (meta.name) q.set("ad", meta.name.slice(0, 80));
  if (meta.logoUrl) q.set("logo", meta.logoUrl);
}

/**
 * Uygulamanın yerel giriş ekranı (salon değiştir / işletme girişi). Salon bilgisi verilirse giriş ekranındaki
 * "Salonlarım" listesinde kod yerine salonun adı ve logosu görünür (bilgi yalnızca cihazda tutulur).
 */
export function nativeHomeUrl(meta?: SalonMeta): string | null {
  const c = cap();
  if (!c) return null;
  const q = new URLSearchParams({ home: "1" });
  metaParams(q, meta);
  return `${nativeIndex(c)}?${q}`;
}

/** Salonu yerel ekran üzerinden açar: "Salonlarım"a eklenir ve uygulama bir sonraki açılışta bu salona gider. */
export function nativeOpenSalonUrl(meta: SalonMeta): string | null {
  const c = cap();
  if (!c) return null;
  const q = new URLSearchParams({ open: `/r/${meta.slug}` });
  if (meta.name) q.set("ad", meta.name.slice(0, 80));
  if (meta.logoUrl) q.set("logo", meta.logoUrl);
  return `${nativeIndex(c)}?${q}`;
}

export type ReminderPermission = "granted" | "denied" | "prompt" | "unavailable";

export async function reminderPermission(): Promise<ReminderPermission> {
  const c = cap();
  if (!c) return "unavailable";
  try {
    const r = await c.nativePromise!<{ display: string }>("LocalNotifications", "checkPermissions", {});
    return r.display === "granted" ? "granted" : r.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  const c = cap();
  if (!c) return "unavailable";
  try {
    const r = await c.nativePromise!<{ display: string }>("LocalNotifications", "requestPermissions", {});
    return r.display === "granted" ? "granted" : r.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

/** Bildirim numarası 32 bit tam sayı olmalı: randevu numarası + hatırlatma türünden kararlı bir sayı üretilir. */
export function reminderId(appointmentId: string, kind: number) {
  let h = 2166136261;
  for (const ch of `${appointmentId}:${kind}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) & 0x3fffffff || 1;
}

export type ReminderAppointment = { id: string; startsAt: string | Date; status: string; service: string };

const ACTIVE = new Set(["BOOKED", "CONFIRMED"]);
const OFFSETS = [
  { kind: 1, ms: 24 * 3_600_000, label: "Yarın" },
  { kind: 2, ms: 2 * 3_600_000, label: "2 saat sonra" },
];

/** Planlanacak hatırlatmalar (saf işlev; test edilir). Geçmiş ve iptal edilmiş randevular için hatırlatma yoktur. */
export function plannedReminders(slug: string, salonName: string, appts: ReminderAppointment[], now = Date.now()) {
  const out: { id: number; title: string; body: string; schedule: { at: string }; isExactNotification: false; extra: { pg: string; url: string } }[] = [];
  for (const a of appts) {
    if (!ACTIVE.has(a.status)) continue;
    const start = new Date(a.startsAt).getTime();
    for (const o of OFFSETS) {
      const at = start - o.ms;
      if (at <= now + 60_000) continue;
      const time = new Date(start).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
      out.push({
        id: reminderId(a.id, o.kind),
        title: salonName,
        body: `${o.label} saat ${time}: ${a.service} randevunuz var.`,
        schedule: { at: new Date(at).toISOString() },
        // Android'de tam zamanlı alarm izni istenmez (ayarlar ekranı açılmaz); hatırlatma birkaç dakika oynayabilir.
        isExactNotification: false,
        extra: { pg: slug, url: `/r/${slug}` },
      });
    }
  }
  return out.slice(0, 60);
}

/** Bu salon için telefonda planlı hatırlatmaları randevu listesine göre yeniler. İzin yoksa hiçbir şey yapmaz. */
export async function syncNativeReminders(slug: string, salonName: string, appts: ReminderAppointment[] | null) {
  const c = cap();
  if (!c) return;
  try {
    if ((await reminderPermission()) !== "granted") return;
    const pending = await c.nativePromise!<{ notifications: { id: number; extra?: { pg?: string } }[] }>("LocalNotifications", "getPending", {});
    const mine = (pending.notifications ?? []).filter((n) => n.extra?.pg === slug).map((n) => ({ id: n.id }));
    if (mine.length) await c.nativePromise!("LocalNotifications", "cancel", { notifications: mine });
    const next = appts ? plannedReminders(slug, salonName, appts) : [];
    if (next.length) await c.nativePromise!("LocalNotifications", "schedule", { notifications: next });
  } catch {
    /* hatırlatma planlanamazsa uygulama çalışmaya devam eder */
  }
}
