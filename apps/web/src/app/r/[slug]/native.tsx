"use client";

import { BellRing, Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
export { NativeHomeLink } from "@/components/native-home-link";
import { isNativeApp, reminderPermission, ReminderPermission, requestReminderPermission, syncNativeReminders } from "@/lib/native-app";
import { MyAppointment, papi, PortalError } from "./portal-api";

/**
 * Pro Güzellik mağaza uygulamasına özel parçalar (iOS/Android). Normal tarayıcıda hiçbiri görünmez,
 * hesap silme hariç: hesap silme her yerde kullanılabilir.
 */

/** Telefonun kendi randevu hatırlatmaları (yerel bildirim). Sunucuya hiçbir şey gönderilmez. */
export function NativeReminders({ compact }: { compact?: boolean }) {
  const [perm, setPerm] = useState<ReminderPermission | null>(null);
  useEffect(() => {
    if (isNativeApp()) void reminderPermission().then(setPerm);
  }, []);
  if (!perm || perm === "unavailable") return null;
  if (compact && perm === "granted") return null;
  return (
    <section aria-labelledby="native-rem-title" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
      <h2 id="native-rem-title" className="flex items-center gap-2 font-semibold"><BellRing className="size-5 text-[var(--salon)]" aria-hidden /> Randevu hatırlatmaları</h2>
      <p className="mt-1 text-sm text-neutral-600">Telefonunuz randevunuzdan 1 gün ve 2 saat önce hatırlatma gösterir. Hatırlatmalar telefonunuzda planlanır; internet olmasa da zamanında görünür.</p>
      {perm === "granted" && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="size-4" aria-hidden /> Açık. Telefon ayarlarından istediğiniz zaman kapatabilirsiniz.</p>}
      {perm === "prompt" && (
        <button type="button" onClick={async () => setPerm(await requestReminderPermission())} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--salon)] px-4 font-semibold text-white">
          <BellRing className="size-4" aria-hidden /> Hatırlatmaları aç
        </button>
      )}
      {perm === "denied" && <p className="mt-2 text-sm text-neutral-600">Bildirim izni kapalı. Telefonunuzun Ayarlar &gt; Pro Güzellik &gt; Bildirimler bölümünden açabilirsiniz.</p>}
    </section>
  );
}

/** Giriş yapmış müşterinin yaklaşan randevularına göre telefondaki hatırlatmaları günceller (uygulama her açıldığında). */
export function NativeReminderSync({ slug, name, loggedIn }: { slug: string; name: string; loggedIn: boolean | undefined }) {
  useEffect(() => {
    if (!isNativeApp() || loggedIn === undefined) return;
    if (!loggedIn) {
      void syncNativeReminders(slug, name, null);
      return;
    }
    papi<{ upcoming: MyAppointment[] }>(slug, "portal/appointments")
      .then((d) => syncNativeReminders(slug, name, d.upcoming))
      .catch(() => undefined);
  }, [slug, name, loggedIn]);
  return null;
}

/**
 * Hesabı kalıcı silme (App Store ve Google Play şartı). E-postaya gönderilen yeni kodla onaylanır.
 * İşletmenin kendi müşteri kaydı ve randevu geçmişi işletmede kalır; bu ekranda açıkça söylenir.
 */
export function DeleteAccount({ slug, email, salonName, onDeleted }: { slug: string; email: string; salonName: string; onDeleted: () => void }) {
  const [step, setStep] = useState<"idle" | "confirm" | "code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setErr(null);
    try {
      await papi(slug, "portal/otp", { method: "POST", body: { email } });
      setStep("code");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await papi(slug, "portal/me/delete", { method: "POST", body: { code } });
      await syncNativeReminders(slug, salonName, null);
      onDeleted();
    } catch (x) {
      setErr(x instanceof PortalError && x.status === 401 ? "Kod hatalı veya süresi dolmuş. Yeni kod isteyebilirsiniz." : (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="delete-title" className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm" data-testid="delete-account">
      <h2 id="delete-title" className="flex items-center gap-2 font-semibold"><Trash2 className="size-5 text-red-700" aria-hidden /> Hesabımı sil</h2>
      {step === "idle" && (
        <>
          <p className="mt-1 text-sm text-neutral-600">Bu salondaki uygulama hesabınızı kalıcı olarak silebilirsiniz.</p>
          <button type="button" onClick={() => setStep("confirm")} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700">
            Hesabımı silmek istiyorum
          </button>
        </>
      )}
      {step !== "idle" && (
        <div className="mt-2 space-y-2 text-sm text-neutral-700">
          <p><b>Silinecekler:</b> {email} ile giriş hesabınız, bu cihazdaki ve diğer cihazlardaki oturumlarınız, bildirim kayıtlarınız ve uygulama tercihleriniz. Bu işlem geri alınamaz.</p>
          <p><b>Salonda kalanlar:</b> {salonName} salonunun sizin için tuttuğu müşteri kaydı ve geçmiş randevular salonun kendi kayıtlarıdır; uygulama hesabınızla birlikte silinmez. Bunların silinmesini salondan isteyebilirsiniz.</p>
          <p>Yaklaşan randevularınız iptal edilmez. İptal etmek istiyorsanız önce Randevularım bölümünden iptal edin.</p>
        </div>
      )}
      {step === "confirm" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void sendCode()} className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Gönderiliyor…" : "Onay kodu gönder"}
          </button>
          <button type="button" onClick={() => setStep("idle")} className="inline-flex min-h-11 items-center rounded-xl border border-sand-200 px-4 text-sm">Vazgeç</button>
        </div>
      )}
      {step === "code" && (
        <form onSubmit={confirm} className="mt-3 space-y-2">
          <label htmlFor="delete-code" className="block text-sm font-medium">{email} adresine gönderilen 6 haneli kod</label>
          <input id="delete-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="block min-h-11 w-40 rounded-xl border border-sand-200 px-3 text-base tracking-widest" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Siliniyor…" : "Hesabımı kalıcı olarak sil"}
            </button>
            <button type="button" disabled={busy} onClick={() => void sendCode()} className="inline-flex min-h-11 items-center rounded-xl border border-sand-200 px-4 text-sm">Yeni kod gönder</button>
            <button type="button" onClick={() => { setStep("idle"); setCode(""); }} className="inline-flex min-h-11 items-center rounded-xl border border-sand-200 px-4 text-sm">Vazgeç</button>
          </div>
        </form>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}
