"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Field, Input } from "@/components/ui";

type LoginUser = { mustChangePassword?: boolean; isPlatformAdmin?: boolean; memberships?: unknown[] };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("sure") ? "Oturumunuzun süresi doldu, lütfen tekrar giriş yapın." : params.get("mfa") ? "Bu işlem için iki adımlı doğrulama ile yeniden giriş yapın." : null;
  const [error, setError] = useState<string | null>(initial);
  const [info] = useState<string | null>(params.get("sifirlandi") ? "Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz." : null);
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);

  function go(user: LoginUser) {
    if (user?.mustChangePassword) return router.push("/parola-degistir");
    const back = params.get("donus");
    const dest = back?.startsWith("/") && !back.startsWith("//") ? back : user?.memberships?.length ? "/panel" : user?.isPlatformAdmin ? "/yonetim" : "/panel";
    router.push(dest);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.message ?? "Giriş yapılamadı");
    if (data.mfaRequired) return setMfaToken(data.mfaToken);
    go(data.user);
  }

  async function submitMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const v = (new FormData(e.currentTarget).get("code") as string).trim();
    const res = await fetch("/api/auth/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useRecovery ? { mfaToken, recoveryCode: v } : { mfaToken, code: v.replace(/\s/g, "") }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (res.status === 401 && /süresi doldu|yeniden giriş/.test(data.message ?? "")) setMfaToken(null);
      return setError(data.message ?? "Doğrulama başarısız");
    }
    go(data.user);
  }

  if (mfaToken) {
    return (
      <form onSubmit={submitMfa} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-neutral-600">{useRecovery ? "Kurtarma kodlarınızdan birini girin. Her kod yalnızca bir kez kullanılabilir." : "Kimlik doğrulama uygulamanızdaki 6 haneli kodu girin."}</p>
        <Field label={useRecovery ? "Kurtarma kodu" : "Doğrulama kodu"}>
          <Input name="code" required autoFocus autoComplete="one-time-code" inputMode={useRecovery ? "text" : "numeric"} placeholder={useRecovery ? "xxxx-xxxx-xx" : "123456"} maxLength={useRecovery ? 20 : 7} />
        </Field>
        <Button className="w-full" size="lg" disabled={busy}>{busy ? "Doğrulanıyor…" : "Doğrula ve giriş yap"}</Button>
        <button type="button" className="w-full text-center text-sm text-brand-700" onClick={() => { setUseRecovery(!useRecovery); setError(null); }}>
          {useRecovery ? "Uygulama koduyla doğrula" : "Telefonum yanımda değil — kurtarma kodu kullan"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {info && <Alert tone="green">{info}</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label="E-posta">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Parola">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="-mt-2 text-right text-sm">
        <Link href="/sifremi-unuttum" className="text-brand-700">Parolamı unuttum</Link>
      </div>
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Giriş yapılıyor…" : "Giriş yap"}</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/"><Logo /></Link>
        <h1 className="mt-8 font-display text-3xl font-semibold">Tekrar hoş geldiniz</h1>
        <p className="mb-6 mt-1 text-sm text-neutral-500">Salon panelinize giriş yapın.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-sm text-neutral-500">
          Hesabınız yok mu? <Link href="/kayit" className="font-medium text-brand-700">14 gün ücretsiz deneyin</Link>
        </p>
      </div>
    </div>
  );
}
