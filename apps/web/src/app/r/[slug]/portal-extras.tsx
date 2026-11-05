"use client";

import { Bell, BellOff, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, PushState, syncPush } from "@/lib/web-push-client";
import { InstallGuide } from "./install";
import { papi, type AppInfo } from "./portal-api";

/** Salon service worker'ı: yalnızca /r/{slug}/ kapsamında, üretim derlemesinde kaydedilir. */
export function SalonSwRegister({ slug }: { slug: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/r/${slug}/sw.js`, { scope: `/r/${slug}/`, updateViaCache: "none" }).catch(() => undefined);
    // Uygulama açılınca ana ekran simgesindeki bildirim sayısı silinir.
    (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
  }, [slug]);
  return null;
}

type Me = { email: string; notifyAppointments: boolean; notifyReminders: boolean };

/** Müşterinin bu cihazda randevu bildirimlerini açıp kapatması ve hangi bildirimleri alacağını seçmesi. */
function CustomerPush({ slug, app, me }: { slug: string; app: AppInfo; me: Me }) {
  const scope = `/r/${slug}/`;
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState({ notifyAppointments: me.notifyAppointments, notifyReminders: me.notifyReminders });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void pushState(scope).then((s) => {
      setState(s);
      if (s === "on" && app.features.push) void syncPush(scope, (sub) => papi(slug, "portal/push/subscriptions", { method: "POST", body: sub }));
    });
  }, [scope, slug, app.features.push]);
  if (!app.features.push || !app.vapidPublicKey || !state) return null;

  async function on() {
    setBusy(true);
    setErr(null);
    try {
      setState(await enablePush({ scope, script: `/r/${slug}/sw.js`, vapidKey: app.vapidPublicKey!, save: (sub) => papi(slug, "portal/push/subscriptions", { method: "POST", body: sub }) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function off() {
    setBusy(true);
    await disablePush(scope, (endpoint) => papi(slug, "portal/push/subscriptions", { method: "DELETE", body: { endpoint } }));
    setState(await pushState(scope));
    setBusy(false);
  }
  async function toggle(key: keyof typeof prefs, value: boolean) {
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      await papi(slug, "portal/me", { method: "PATCH", body: { [key]: value } });
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: !value }));
      setErr((e as Error).message);
    }
  }

  return (
    <section aria-labelledby="push-title" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
      <h2 id="push-title" className="flex items-center gap-2 font-semibold"><Bell className="size-5 text-[var(--salon)]" aria-hidden /> Randevu bildirimleri</h2>
      <p className="mt-1 text-sm text-neutral-600">Randevunuz onaylandığında, değiştiğinde veya iptal edildiğinde ve randevudan önce hatırlatma alırsınız. Kampanya veya reklam gönderilmez.</p>
      {state === "on" && (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="size-4" aria-hidden /> Bu cihazda açık</p>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={prefs.notifyAppointments} onChange={(e) => void toggle("notifyAppointments", e.target.checked)} /> Onay, değişiklik ve iptal bildirimleri</label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={prefs.notifyReminders} onChange={(e) => void toggle("notifyReminders", e.target.checked)} /> 24 saat ve 2 saat önce hatırlatma</label>
          <button type="button" disabled={busy} onClick={() => void off()} className="inline-flex min-h-11 items-center gap-2 text-sm text-neutral-600 underline"><BellOff className="size-4" aria-hidden /> Bu cihazda kapat</button>
        </div>
      )}
      {state === "off" && (
        <button type="button" disabled={busy} onClick={() => void on()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white disabled:opacity-60">
          <Bell className="size-4" aria-hidden /> {busy ? "Açılıyor…" : "Bildirimleri aç"}
        </button>
      )}
      {state === "denied" && <p className="mt-2 text-sm text-neutral-600">Bildirim izni bu tarayıcıda kapalı. Tarayıcı ayarlarından bu site için izin verebilirsiniz.</p>}
      {state === "ios-install" && <p className="mt-2 text-sm text-neutral-600">iPhone'da bildirim almak için önce uygulamayı ana ekranınıza ekleyin (aşağıdaki adımlar), sonra ana ekrandaki simgeden açıp burada bildirimleri açın. iOS 16.4 ve üzeri gerekir.</p>}
      {state === "unsupported" && <p className="mt-2 text-sm text-neutral-600">Bu tarayıcı anlık bildirimleri desteklemiyor.</p>}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}

/** Hesabım sekmesi ekleri: randevu bildirimleri ve ana ekrana ekleme rehberi. */
export function AccountExtras({ slug, app, me }: { slug: string; app: AppInfo; me: Me | null | undefined }) {
  return (
    <>
      {me && <CustomerPush slug={slug} app={app} me={me} />}
      <InstallGuide app={app} />
    </>
  );
}
