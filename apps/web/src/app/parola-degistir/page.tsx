"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErr(null);
    if (f.get("newPassword") !== f.get("newPassword2")) return setErr("Yeni parolalar eşleşmiyor");
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
      router.push("/panel?parola=degisti");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo />
        <h1 className="mt-8 font-display text-3xl font-semibold">Parolanızı belirleyin</h1>
        <p className="mb-6 mt-1 text-sm text-neutral-500">Güvenliğiniz için geçici parolayı kendi parolanızla değiştirin.</p>
        <form onSubmit={submit} className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <Field label="Mevcut (geçici) parola"><Input name="currentPassword" type="password" required autoComplete="current-password" /></Field>
          <Field label="Yeni parola" hint="En az 10 karakter, harf ve rakam içermeli"><Input name="newPassword" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <Field label="Yeni parola (tekrar)"><Input name="newPassword2" type="password" required autoComplete="new-password" /></Field>
          <Button className="w-full" size="lg" disabled={busy}>{busy ? "Kaydediliyor…" : "Parolayı kaydet"}</Button>
        </form>
        <p className="mt-6 text-center text-sm"><Link href="/panel" className="text-brand-700">Panele dön</Link></p>
      </div>
    </div>
  );
}
