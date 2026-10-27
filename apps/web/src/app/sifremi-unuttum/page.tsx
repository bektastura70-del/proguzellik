"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

export default function ForgotPage() {
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title="Parolanızı mı unuttunuz?" subtitle="E-posta adresinizi girin; size bir sıfırlama bağlantısı gönderelim.">
      {done ? (
        <Alert tone="green">{done}</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const r = await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: { email: new FormData(e.currentTarget).get("email") } });
              setDone(`${r.message} Bağlantı 30 dakika geçerlidir.`);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {err && <Alert>{err}</Alert>}
          <Field label="E-posta"><Input name="email" type="email" required autoComplete="email" /></Field>
          <Button className="w-full" size="lg" disabled={busy}>{busy ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link href="/giris" className="text-brand-700">Girişe dön</Link></p>
    </AuthCard>
  );
}
