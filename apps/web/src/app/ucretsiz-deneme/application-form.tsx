"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { PublicPlan } from "./register-form";

/**
 * Kayıt kapalıyken deneme başvurusu: hesap hemen açılmaz. E-posta doğrulanınca başvuru ekibe iletilir,
 * onaylanınca hesabı oluşturmak için davet e-postası gider. Parola istenmez.
 */
export function ApplicationForm({ plans }: { plans: PublicPlan[] }) {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; hours: number } | null>(null);
  const wanted = params.get("paket");
  const initial = plans.find((p) => p.code === wanted)?.code ?? "";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const staff = String(f.get("staffCount") ?? "").trim();
    setBusy(true);
    try {
      const res = await fetch("/api/p/auth/trial-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: f.get("businessName"),
          fullName: f.get("fullName"),
          email: f.get("email"),
          phone: f.get("phone"),
          city: (f.get("city") as string) || undefined,
          staffCount: staff ? Number(staff) : undefined,
          planCode: (f.get("planCode") as string) || undefined,
          note: (f.get("note") as string) || undefined,
          kvkkAccepted: f.get("kvkk") === "on",
          termsAccepted: f.get("terms") === "on",
          marketingConsent: f.get("marketing") === "on",
          website: (f.get("website") as string) || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "Başvuru alınamadı");
      setSent({ email: data.email, hours: data.expiresInHours ?? 48 });
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-5" role="status" data-testid="application-sent">
        <h2 className="font-display text-xl font-semibold">E-postanızı kontrol edin</h2>
        <p className="mt-2 text-sm text-neutral-700">
          <strong>{sent.email}</strong> adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladığınızda başvurunuz ekibimize iletilir.
        </p>
        <p className="mt-2 text-sm text-neutral-600">Başvurunuz onaylandığında hesabınızı oluşturmanız için ayrı bir davet e-postası alırsınız; 14 günlük deneme süreniz hesabınız açıldığında başlar.</p>
        <p className="mt-2 text-sm text-neutral-600">Bağlantı {sent.hours} saat geçerlidir. E-posta gelmediyse gereksiz/spam klasörünü kontrol edin.</p>
        <Button variant="outline" className="mt-4" onClick={() => setSent(null)}>Formu yeniden doldur</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="application-form">
      {error && <Alert>{error}</Alert>}
      <Field label="Salon adı"><Input name="businessName" required minLength={2} maxLength={120} placeholder="Örn. Işıltı Güzellik Stüdyosu" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yetkili adı soyadı"><Input name="fullName" required minLength={2} maxLength={120} autoComplete="name" /></Field>
        <Field label="Telefon"><Input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" /></Field>
      </div>
      <Field label="E-posta" hint="Doğrulama bağlantısı ve onay sonrası davet bu adrese gönderilir."><Input name="email" type="email" required autoComplete="email" maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Şehir (isteğe bağlı)"><Input name="city" maxLength={60} autoComplete="address-level1" /></Field>
        <Field label="Personel sayısı (isteğe bağlı)"><Input name="staffCount" type="number" min={1} max={500} inputMode="numeric" /></Field>
      </div>
      {plans.length > 0 && (
        <Field label="İlgilendiğiniz paket (isteğe bağlı)">
          <Select name="planCode" defaultValue={initial}>
            <option value="">Henüz karar vermedim</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.maxStaff} personel)</option>)}
          </Select>
        </Field>
      )}
      <Field label="Notunuz (isteğe bağlı)"><Textarea name="note" maxLength={1000} rows={3} placeholder="Size ne zaman ulaşalım, özel bir ihtiyacınız var mı?" /></Field>
      {/* Bal küpü: ekranda ve ekran okuyucuda görünmez; botlar doldurursa başvuru yok sayılır. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Web sitesi<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
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
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Gönderiliyor…" : "Deneme başvurusu gönder"}</Button>
    </form>
  );
}
