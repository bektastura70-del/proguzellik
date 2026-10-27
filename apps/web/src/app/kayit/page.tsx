"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError("Parolalar eşleşmiyor");
    setBusy(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: f.get("businessName"),
        fullName: f.get("fullName"),
        email: f.get("email"),
        phone: f.get("phone") || undefined,
        password: f.get("password"),
        planCode: f.get("planCode"),
        kvkkAccepted: f.get("kvkk") === "on",
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "Kayıt yapılamadı");
    router.push("/panel?hosgeldin=1");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Salon adı"><Input name="businessName" required minLength={2} placeholder="Örn. Işıltı Güzellik Stüdyosu" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adınız soyadınız"><Input name="fullName" required minLength={2} autoComplete="name" /></Field>
        <Field label="Telefon"><Input name="phone" type="tel" autoComplete="tel" placeholder="05xx xxx xx xx" /></Field>
      </div>
      <Field label="E-posta"><Input name="email" type="email" required autoComplete="email" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parola" hint="En az 10 karakter, harf ve rakam"><Input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Parola (tekrar)"><Input name="password2" type="password" required autoComplete="new-password" /></Field>
      </div>
      <Field label="Paket" hint="Deneme süresince seçtiğiniz paketin özellikleri açıktır.">
        <Select name="planCode" defaultValue={params.get("paket") ?? "PROFESSIONAL"}>
          <option value="STARTER">Başlangıç (3 personel)</option>
          <option value="PROFESSIONAL">Profesyonel (8 personel)</option>
          <option value="SMART">Akıllı (20 personel + yapay zekâ)</option>
        </Select>
      </Field>
      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" name="kvkk" required className="mt-1 size-4 accent-brand-600" />
        <span>
          <Link href="/kvkk" target="_blank" className="text-brand-700 underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum, kişisel verilerimin hizmetin sunulması amacıyla işlenmesini kabul ediyorum.
        </span>
      </label>
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Hesap oluşturuluyor…" : "Ücretsiz denemeyi başlat"}</Button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/"><Logo /></Link>
        <h1 className="mt-8 font-display text-3xl font-semibold">Salonunuzu 2 dakikada açın</h1>
        <p className="mb-6 mt-1 text-sm text-neutral-500">14 gün boyunca ücretsiz. Kredi kartı gerekmez.</p>
        <Suspense>
          <RegisterForm />
        </Suspense>
        <p className="mt-6 text-center text-sm text-neutral-500">Zaten hesabınız var mı? <Link href="/giris" className="font-medium text-brand-700">Giriş yapın</Link></p>
      </div>
    </div>
  );
}
