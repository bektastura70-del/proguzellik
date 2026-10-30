"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

export type PublicPlan = { code: string; name: string; maxStaff: number; features: string[] };

export function RegisterForm({ plans }: { plans: PublicPlan[] }) {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; hours: number } | null>(null);
  const wanted = params.get("paket");
  const initial = plans.find((p) => p.code === wanted)?.code ?? plans.find((p) => p.code === "PROFESSIONAL")?.code ?? plans[0]?.code;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError("Parolalar eşleşmiyor");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: f.get("businessName"),
          fullName: f.get("fullName"),
          email: f.get("email"),
          phone: f.get("phone"),
          password: f.get("password"),
          planCode: f.get("planCode"),
          kvkkAccepted: f.get("kvkk") === "on",
          termsAccepted: f.get("terms") === "on",
          marketingConsent: f.get("marketing") === "on",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "Başvuru alınamadı");
      setSent({ email: data.email, hours: data.expiresInHours ?? 24 });
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-5" role="status">
        <h2 className="font-display text-xl font-semibold">E-postanızı kontrol edin</h2>
        <p className="mt-2 text-sm text-neutral-700">
          <strong>{sent.email}</strong> adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladığınızda hesabınız açılır ve 14 günlük deneme süreniz başlar.
        </p>
        <p className="mt-2 text-sm text-neutral-600">Bağlantı {sent.hours} saat geçerlidir. E-posta gelmediyse gereksiz/spam klasörünü kontrol edin veya formu yeniden gönderin.</p>
        <Button variant="outline" className="mt-4" onClick={() => setSent(null)}>Formu yeniden doldur</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      {error && <Alert>{error}</Alert>}
      <Field label="İşletme adı"><Input name="businessName" required minLength={2} maxLength={120} placeholder="Örn. Işıltı Güzellik Stüdyosu" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yetkili adı soyadı"><Input name="fullName" required minLength={2} maxLength={120} autoComplete="name" /></Field>
        <Field label="Telefon"><Input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" /></Field>
      </div>
      <Field label="E-posta" hint="Doğrulama bağlantısı bu adrese gönderilir."><Input name="email" type="email" required autoComplete="email" maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parola" hint="En az 10 karakter, harf ve rakam"><Input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Parola (tekrar)"><Input name="password2" type="password" required autoComplete="new-password" /></Field>
      </div>
      <Field label="Paket" hint="Deneme süresince seçtiğiniz paketin özellikleri açıktır; dilediğiniz zaman değiştirebilirsiniz.">
        <Select name="planCode" defaultValue={initial}>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.maxStaff} personel)</option>)}
        </Select>
      </Field>
      <div className="space-y-3 text-sm text-neutral-600">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="kvkk" required className="mt-1 size-4 accent-brand-600" />
          <span><Link href="/kvkk" target="_blank" className="text-brand-700 underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="terms" required className="mt-1 size-4 accent-brand-600" />
          <span><Link href="/kullanim-kosullari" target="_blank" className="text-brand-700 underline">Kullanım Koşulları</Link>&apos;nı kabul ediyorum.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="marketing" className="mt-1 size-4 accent-brand-600" />
          <span>Kampanya ve yenilikler hakkında ticari elektronik ileti almak istiyorum (isteğe bağlı).</span>
        </label>
      </div>
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Gönderiliyor…" : "Ücretsiz denemeyi başlat"}</Button>
    </form>
  );
}
