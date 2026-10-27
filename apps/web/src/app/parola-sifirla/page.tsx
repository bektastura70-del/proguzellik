"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [err, setErr] = useState<string | null>(token ? null : "Bağlantı eksik veya hatalı.");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setErr(null);
        if (f.get("p1") !== f.get("p2")) return setErr("Parolalar eşleşmiyor");
        setBusy(true);
        try {
          await api("/auth/reset-password", { method: "POST", body: { token, newPassword: f.get("p1") } });
          router.push("/giris?sifirlandi=1");
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Alert>{err} {err.includes("geçersiz") && <Link href="/sifremi-unuttum" className="underline">Yeni bağlantı isteyin</Link>}</Alert>}
      <Field label="Yeni parola" hint="En az 10 karakter, harf ve rakam içermeli"><Input name="p1" type="password" required minLength={10} autoComplete="new-password" /></Field>
      <Field label="Yeni parola (tekrar)"><Input name="p2" type="password" required autoComplete="new-password" /></Field>
      <Button className="w-full" size="lg" disabled={busy || !token}>{busy ? "Kaydediliyor…" : "Parolayı güncelle"}</Button>
      <p className="text-xs text-neutral-500">Güvenliğiniz için tüm cihazlardaki oturumlarınız kapatılacaktır.</p>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthCard title="Yeni parola belirleyin">
      <Suspense><ResetForm /></Suspense>
    </AuthCard>
  );
}
