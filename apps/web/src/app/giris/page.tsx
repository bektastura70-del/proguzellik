"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Field, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("sure") ? "Oturumunuzun süresi doldu, lütfen tekrar giriş yapın." : null);
  const [busy, setBusy] = useState(false);

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
    const back = params.get("donus");
    const dest = back?.startsWith("/") && !back.startsWith("//") ? back : data.user?.memberships?.length ? "/panel" : data.user?.isPlatformAdmin ? "/yonetim" : "/panel";
    router.push(dest);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="E-posta">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Parola">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
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
