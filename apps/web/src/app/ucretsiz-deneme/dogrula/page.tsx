"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button } from "@/components/ui";

/**
 * E-posta doğrulama: bağlantıdaki belirteç yalnızca düğmeye basınca gönderilir
 * (e-posta tarayıcılarının bağlantıyı önceden açması hesabı açmaz).
 */
function Confirm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.message ?? "Doğrulama yapılamadı");
      router.replace("/panel?hosgeldin=1");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mt-8 font-display text-3xl font-semibold">E-postanızı doğrulayın</h1>
      {!token ? (
        <div className="mt-4"><Alert>Doğrulama bağlantısı eksik. E-postadaki bağlantıyı kullanın.</Alert></div>
      ) : (
        <>
          <p className="mt-2 text-sm text-neutral-600">Onayladığınızda işletme hesabınız açılır ve 14 günlük ücretsiz deneme süreniz bugünden itibaren başlar.</p>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <Button className="mt-6 w-full" size="lg" disabled={busy} onClick={confirm}>{busy ? "Hesap açılıyor…" : "E-postamı doğrula ve denemeyi başlat"}</Button>
        </>
      )}
      <p className="mt-6 text-center text-sm text-neutral-500">
        <Link href="/ucretsiz-deneme" className="text-brand-700">Yeniden başvur</Link> · <Link href="/giris" className="text-brand-700">Giriş yap</Link>
      </p>
    </>
  );
}

export default function ConfirmTrialPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        <Suspense><Confirm /></Suspense>
      </div>
    </main>
  );
}
