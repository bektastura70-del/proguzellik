"use client";

import { Bell, Check, Download, ExternalLink, Share, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { pushState } from "@/lib/web-push-client";
import type { AppInfo } from "./portal-api";

/**
 * Salon uygulamasını ana ekrana ekleme: Android/Chrome'da tek dokunuşluk kurulum (beforeinstallprompt),
 * iPhone'da resimli Safari adımları, uygulama içi tarayıcılarda (Instagram, Facebook vb.) "tarayıcıda açın" uyarısı.
 * Kurulum yalnızca müşterinin dokunuşuyla başlar; uygulama zaten yüklüyse hiçbir öneri gösterilmez.
 */

type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type Platform = "installed" | "ios" | "ios-other" | "inapp" | "prompt" | "android" | "desktop";

let deferred: BeforeInstallPrompt | null = null;
let acceptedHere = false;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // Tarayıcı kendiliğinden sormaz; müşteri düğmeye basınca sorulur.
    deferred = e as BeforeInstallPrompt;
  });
  window.addEventListener("appinstalled", () => {
    acceptedHere = true;
    deferred = null;
  });
}

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|Pinterest|; wv\)/;

export function detectPlatform(): Platform {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone || acceptedHere) return "installed";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (IN_APP.test(ua)) return "inapp";
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "ios-other" : "ios";
  if (deferred) return "prompt";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** iOS sürümü anlık bildirimi destekliyor mu (16.4+)? Sürüm okunamazsa destekliyor sayılır. */
export function iosSupportsPush(): boolean {
  const m = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent);
  if (!m) return true;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 16 || (maj === 16 && min >= 4);
}

export function useInstall() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => {
    const update = () => setPlatform(detectPlatform());
    update();
    window.addEventListener("beforeinstallprompt", update);
    window.addEventListener("appinstalled", update);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("beforeinstallprompt", update);
      window.removeEventListener("appinstalled", update);
      mq.removeEventListener?.("change", update);
    };
  }, []);
  const install = useCallback(async () => {
    if (!deferred) return;
    const ev = deferred;
    await ev.prompt();
    const choice = await ev.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    deferred = null;
    if (choice.outcome === "accepted") acceptedHere = true;
    setPlatform(detectPlatform());
  }, []);
  return { platform, install };
}

const DISMISS_DAYS = 14;
const dismissKey = (slug: string) => `pg-yukle-gizle:${slug}`;
function dismissedRecently(slug: string) {
  try {
    const t = Number(localStorage.getItem(dismissKey(slug)) ?? 0);
    return Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}
function rememberDismiss(slug: string) {
  try {
    localStorage.setItem(dismissKey(slug), String(Date.now()));
  } catch {
    /* gizli pencere: yalnız bu açılışta gizlenir */
  }
}

/** iPhone için resimli adımlar (Safari). Çizimler temsilidir; iOS sürümüne göre düğme yeri biraz değişebilir. */
export function IosSteps({ pushNote = true }: { pushNote?: boolean }) {
  const pushOk = typeof navigator === "undefined" ? true : iosSupportsPush();
  return (
    <div className="mt-3 space-y-3">
      <ol className="space-y-3" aria-label="iPhone'da ana ekrana ekleme adımları">
        <Step n={1} pic={<PicShare />}>
          Safari'de <Share className="inline size-4 align-text-bottom" aria-label="Paylaş" /> <b>Paylaş</b> düğmesine dokunun. Alt çubukta görmüyorsanız önce <b>•••</b> düğmesine dokunun.
        </Step>
        <Step n={2} pic={<PicAddRow />}>
          Açılan listeyi aşağı kaydırıp <b>Ana Ekrana Ekle</b>'ye dokunun.
        </Step>
        <Step n={3} pic={<PicConfirm />}>
          <b>Web Uygulaması olarak aç</b> seçeneği görünüyorsa açık bırakın, sağ üstteki <b>Ekle</b>'ye dokunun.
        </Step>
      </ol>
      {pushNote && (
        <p className="rounded-xl bg-sand-50 p-3 text-xs text-neutral-600">
          <Bell className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
          Randevu bildirimleri iPhone'da yalnızca ana ekrandaki simgeden açılan uygulamada çalışır ve <b>iOS 16.4 veya üzeri</b> gerekir.
          {!pushOk && " Telefonunuzun iOS sürümü bildirimleri desteklemiyor; uygulamayı yine ekleyebilirsiniz."}
        </p>
      )}
    </div>
  );
}

function Step({ n, pic, children }: { n: number; pic: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <div aria-hidden className="w-20 shrink-0">{pic}</div>
      <p className="min-w-0 text-sm text-neutral-700"><span className="mr-1 font-semibold text-[var(--salon)]">{n}.</span>{children}</p>
    </li>
  );
}

/* Küçük temsilî çizimler: telefon ekranının ilgili bölümü, dokunulacak yer salon renginde. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 80 64" className="h-16 w-20" role="presentation">
      <rect x="1" y="1" width="78" height="62" rx="10" fill="#fff" stroke="#d6cfc4" strokeWidth="2" />
      {children}
    </svg>
  );
}
function PicShare() {
  return (
    <Frame>
      <rect x="8" y="10" width="64" height="26" rx="4" fill="#f4f1ec" />
      <rect x="1" y="42" width="78" height="21" rx="0" fill="#f4f1ec" />
      <circle cx="40" cy="52" r="9" fill="var(--salon)" opacity="0.15" />
      <path d="M40 46v9M36.5 49.5 40 46l3.5 3.5M35 52v5h10v-5" fill="none" stroke="var(--salon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 52h6M60 52h6" stroke="#b9b0a3" strokeWidth="2" strokeLinecap="round" />
    </Frame>
  );
}
function PicAddRow() {
  return (
    <Frame>
      <rect x="8" y="9" width="64" height="12" rx="3" fill="#f4f1ec" />
      <rect x="8" y="25" width="64" height="14" rx="3" fill="var(--salon)" opacity="0.15" />
      <rect x="12" y="28" width="8" height="8" rx="2" fill="none" stroke="var(--salon)" strokeWidth="1.6" />
      <path d="M16 30v4M14 32h4" stroke="var(--salon)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M25 32h30" stroke="var(--salon)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="8" y="43" width="64" height="12" rx="3" fill="#f4f1ec" />
    </Frame>
  );
}
function PicConfirm() {
  return (
    <Frame>
      <path d="M8 14h14" stroke="#b9b0a3" strokeWidth="2" strokeLinecap="round" />
      <rect x="52" y="8" width="20" height="12" rx="4" fill="var(--salon)" />
      <text x="62" y="17" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">Ekle</text>
      <rect x="8" y="27" width="14" height="14" rx="4" fill="var(--salon)" opacity="0.6" />
      <path d="M27 31h30M27 37h20" stroke="#b9b0a3" strokeWidth="2" strokeLinecap="round" />
      <rect x="50" y="47" width="18" height="10" rx="5" fill="#34c759" />
      <circle cx="63" cy="52" r="4" fill="#fff" />
    </Frame>
  );
}

function InAppNote() {
  return (
    <p className="mt-2 text-sm text-neutral-700">
      Bu sayfa bir uygulamanın içinde açıldı; buradan ana ekrana eklenemez. Sağ üstteki menüden (<b>⋯</b> veya <ExternalLink className="inline size-3.5 align-text-bottom" aria-hidden />)
      {" "}<b>Tarayıcıda aç</b>'a dokunun: iPhone'da <b>Safari</b>, Android'de <b>Chrome</b> ile açıp tekrar deneyin.
    </p>
  );
}

/** Platforma göre kurulum içeriği (düğme veya adımlar). Yüklü ve masaüstünde null döner. */
function InstallBody({ platform, install, compact }: { platform: Platform; install: () => void; compact?: boolean }) {
  const [showIos, setShowIos] = useState(!compact);
  switch (platform) {
    case "prompt":
      return (
        <button type="button" onClick={install} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white sm:w-auto">
          <Download className="size-4" aria-hidden /> Uygulamayı yükle
        </button>
      );
    case "ios":
      return showIos ? <IosSteps /> : (
        <button type="button" onClick={() => setShowIos(true)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white sm:w-auto">
          <Share className="size-4" aria-hidden /> Nasıl eklenir?
        </button>
      );
    case "ios-other":
      return <p className="mt-2 text-sm text-neutral-700">iPhone'da uygulamayı eklemek için bu sayfayı <b>Safari</b> ile açın, ardından Paylaş → <b>Ana Ekrana Ekle</b> adımlarını izleyin.</p>;
    case "inapp":
      return <InAppNote />;
    case "android":
      return <p className="mt-2 text-sm text-neutral-700">Chrome menüsünden (<b>⋮</b>) <b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>'ye dokunun.</p>;
    default:
      return null;
  }
}

/** Randevu al ekranının üstündeki kapatılabilir kurulum kartı. Yüklüyse, masaüstündeyse veya yakın zamanda kapatıldıysa görünmez. */
export function InstallBanner({ slug, app }: { slug: string; app: AppInfo }) {
  const { platform, install } = useInstall();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(dismissedRecently(slug)), [slug]);
  if (!app.features.installable || !platform || hidden || platform === "installed" || platform === "desktop") return null;
  return (
    <section aria-labelledby="install-banner-title" className="relative rounded-2xl border border-sand-200 bg-white p-4 pr-12 shadow-sm">
      <button type="button" aria-label="Kapat" onClick={() => { rememberDismiss(slug); setHidden(true); }} className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-neutral-400 hover:text-neutral-600">
        <X className="size-5" aria-hidden />
      </button>
      <h2 id="install-banner-title" className="flex items-center gap-2 font-semibold">
        <Smartphone className="size-5 shrink-0 text-[var(--salon)]" aria-hidden /> {app.name} uygulamasını telefonunuza ekleyin
      </h2>
      <p className="mt-1 text-sm text-neutral-600">Randevu onayını ve hatırlatmaları anında alın; salonunuza tek dokunuşla ulaşın. Mağazadan indirmeniz gerekmez.</p>
      <InstallBody platform={platform} install={install} compact />
    </section>
  );
}

/** Hesabım sekmesindeki kalıcı rehber: yüklüyse "yüklü" bilgisini gösterir. */
export function InstallGuide({ app }: { app: AppInfo }) {
  const { platform, install } = useInstall();
  if (!app.features.installable || !platform) return null;
  return (
    <section aria-labelledby="install-title" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
      <h2 id="install-title" className="flex items-center gap-2 font-semibold">
        <Smartphone className="size-5 text-[var(--salon)]" aria-hidden /> {app.shortName} uygulaması
      </h2>
      {platform === "installed" && <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" aria-hidden /> Uygulama bu cihazda yüklü.</p>}
      {platform === "desktop" && <p className="mt-2 text-sm text-neutral-600">Telefonunuzda bu sayfayı açarak uygulamayı ana ekranınıza ekleyebilirsiniz.</p>}
      {platform !== "installed" && platform !== "desktop" && (
        <>
          <p className="mt-2 text-sm text-neutral-600">Ana ekranınıza ekleyin; randevularınıza tek dokunuşla ulaşın.</p>
          <InstallBody platform={platform} install={install} />
        </>
      )}
    </section>
  );
}

/**
 * Randevu alındıktan sonraki öneri. Uygulama yüklü değilse ana ekrana eklemeyi, yüklüyse ve bildirimler kapalıysa
 * bildirimleri açmayı önerir (asıl amaç hatırlatmaların ulaşması).
 */
export function AfterBookingInstall({ slug, app, onOpenAccount }: { slug: string; app: AppInfo; onOpenAccount: () => void }) {
  const { platform, install } = useInstall();
  const [push, setPush] = useState<string | null>(null);
  useEffect(() => {
    if (platform === "installed" && app.features.push) void pushState(`/r/${slug}/`).then(setPush).catch(() => setPush(null));
  }, [platform, slug, app.features.push]);
  if (!app.features.installable || !platform || platform === "desktop") return null;
  if (platform === "installed") {
    if (push !== "off") return null;
    return (
      <div className="mt-5 rounded-xl border border-sand-200 p-4 text-left" data-testid="after-booking-push">
        <p className="flex items-center gap-2 font-semibold"><Bell className="size-5 text-[var(--salon)]" aria-hidden /> Hatırlatmaları kaçırmayın</p>
        <p className="mt-1 text-sm text-neutral-600">Randevudan önce hatırlatma almak için bildirimleri açın.</p>
        <button type="button" onClick={onOpenAccount} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white">
          <Bell className="size-4" aria-hidden /> Bildirimleri aç
        </button>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-xl border border-sand-200 p-4 text-left" data-testid="after-booking-install">
      <p className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-[var(--salon)]" aria-hidden /> Uygulamayı ekleyin, hatırlatmaları kaçırmayın</p>
      <p className="mt-1 text-sm text-neutral-600">{app.shortName} uygulamasını ana ekranınıza ekleyin; randevunuz yaklaşınca bildirim alın.</p>
      <InstallBody platform={platform} install={install} compact />
    </div>
  );
}
