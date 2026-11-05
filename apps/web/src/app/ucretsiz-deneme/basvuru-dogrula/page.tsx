"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button } from "@/components/ui";

/**
 * Deneme başvurusu e-posta doğrulaması: belirteç yalnızca düğmeye basınca gönderilir
 * (e-posta tarayıcılarının bağlantıyı önceden açması başvuruyu iletmez).
 */
function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/p/auth/trial-applications/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.message ?? "Doğrulama yapılamadı");
      setDone(true);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50 p-5" role="status" data-testid="application-verified">
        <h1 className="font-display text-2xl font-semibold">Başvurunuz alındı</h1>
        <p className="mt-2 text-sm text-neutral-700">E-posta adresiniz doğrulandı ve başvurunuz ekibimize iletildi. Onaylandığında hesabınızı oluşturmanız için bir davet e-postası alacaksınız.</p>
      </div>
    );
  }
  return (
    <>
      <h1 className="mt-8 font-display text-3xl font-semibold">E-postanızı doğrulayın</h1>
      {!token ? (
        <div className="mt-4"><Alert>Doğrulama bağlantısı eksik. E-postadaki bağlantıyı kullanın.</Alert></div>
      ) : (
        <>
          <p className="mt-2 text-sm text-neutral-600">Doğruladığınızda deneme başvurunuz ekibimize iletilir.</p>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <Button className="mt-6 w-full" size="lg" disabled={busy} onClick={verify}>{busy ? "Doğrulanıyor…" : "E-postamı doğrula ve başvuruyu ilet"}</Button>
        </>
      )}
      <p className="mt-6 text-center text-sm text-neutral-500">
        <Link href="/ucretsiz-deneme" className="text-brand-700">Yeniden başvur</Link> · <Link href="/" className="text-brand-700">Ana sayfa</Link>
      </p>
    </>
  );
}

export default function VerifyApplicationPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        <Suspense><Verify /></Suspense>
      </div>
    </main>
  );
}
