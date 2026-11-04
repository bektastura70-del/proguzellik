"use client";

import { Check, Download, Share, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppInfo } from "./portal-api";

/** Salon service worker'ı: yalnızca /r/{slug}/ kapsamında, üretim derlemesinde kaydedilir. */
export function SalonSwRegister({ slug }: { slug: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/r/${slug}/sw.js`, { scope: `/r/${slug}/`, updateViaCache: "none" }).catch(() => undefined);
  }, [slug]);
  return null;
}

type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Platform = "installed" | "ios" | "ios-other" | "prompt" | "android" | "desktop";

function detect(hasPrompt: boolean): Platform {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios";
  if (hasPrompt) return "prompt";
  return /Android/.test(ua) ? "android" : "desktop";
}

let deferred: BeforeInstallPrompt | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // Tarayıcı kendiliğinden sormaz; müşteri düğmeye basınca sorulur.
    deferred = e as BeforeInstallPrompt;
  });
}

/** Ana ekrana ekleme rehberi (iPhone/Android). Kurulum yalnızca müşterinin dokunuşuyla başlar. */
export function InstallGuide({ app }: { app: AppInfo }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => {
    const update = () => setPlatform(detect(!!deferred));
    update();
    window.addEventListener("beforeinstallprompt", update);
    window.addEventListener("appinstalled", update);
    return () => {
      window.removeEventListener("beforeinstallprompt", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);
  if (!app.features.installable || !platform) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    deferred = null;
    setPlatform(detect(false));
  }

  return (
    <section aria-labelledby="install-title" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
      <h2 id="install-title" className="flex items-center gap-2 font-semibold">
        <Smartphone className="size-5 text-[var(--salon)]" aria-hidden /> {app.shortName} uygulaması
      </h2>
      {platform === "installed" && (
        <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" aria-hidden /> Uygulama bu cihazda yüklü.</p>
      )}
      {platform === "prompt" && (
        <>
          <p className="mt-2 text-sm text-neutral-600">Ana ekranınıza ekleyin; randevularınıza tek dokunuşla ulaşın.</p>
          <button type="button" onClick={install} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white">
            <Download className="size-4" aria-hidden /> Ana ekrana ekle
          </button>
        </>
      )}
      {platform === "ios" && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>Safari'nin alt çubuğundaki <Share className="inline size-4 align-text-bottom" aria-label="Paylaş" /> <b>Paylaş</b> düğmesine dokunun.</li>
          <li>Listede <b>Ana Ekrana Ekle</b> seçeneğini bulun.</li>
          <li>Sağ üstte <b>Ekle</b>'ye dokunun.</li>
        </ol>
      )}
      {platform === "ios-other" && (
        <p className="mt-2 text-sm text-neutral-600">iPhone'da uygulamayı eklemek için bu sayfayı <b>Safari</b> ile açın, ardından Paylaş → Ana Ekrana Ekle adımlarını izleyin.</p>
      )}
      {platform === "android" && (
        <p className="mt-2 text-sm text-neutral-600">Tarayıcı menüsünden (⋮) <b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b> seçeneğine dokunun.</p>
      )}
      {platform === "desktop" && (
        <p className="mt-2 text-sm text-neutral-600">Telefonunuzda bu sayfayı açarak uygulamayı ana ekranınıza ekleyebilirsiniz.</p>
      )}
    </section>
  );
}

/** Hesabım sekmesi ekleri: ana ekrana ekleme rehberi (bildirim ayarları Web Push fazında eklenir). */
export function AccountExtras({ app }: { slug: string; app: AppInfo; me: { email: string; notifyAppointments: boolean; notifyReminders: boolean } | null }) {
  return <InstallGuide app={app} />;
}
