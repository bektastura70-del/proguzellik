"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { tl } from "@/lib/format";
import type { SitePlan } from "@/lib/site";

const gross = (net: string, vat: string) => (Number(net) * (1 + Number(vat) / 100)).toFixed(2);

/** Siteden satın alma formu. Parola burada belirlenir; hesap yalnız ödeme alınınca açılır. */
export function PurchaseForm({ plans }: { plans: SitePlan[] }) {
  const params = useSearchParams();
  const wanted = params.get("paket")?.toUpperCase();
  const [planCode, setPlanCode] = useState(plans.find((p) => p.code === wanted)?.code ?? plans.find((p) => p.code === "PROFESSIONAL")?.code ?? plans[0].code);
  const plan = plans.find((p) => p.code === planCode)!;
  const hasYearly = Number(plan.yearlyPrice ?? 0) > 0;
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">(params.get("donem") === "YEARLY" ? "YEARLY" : "MONTHLY");
  const effCycle = cycle === "YEARLY" && hasYearly ? "YEARLY" : "MONTHLY";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; hours: number } | null>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const net = effCycle === "YEARLY" ? plan.yearlyPrice! : plan.monthlyPrice!;
  const per = effCycle === "YEARLY" ? "yıl" : "ay";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError("Parolalar eşleşmiyor");
    setBusy(true);
    try {
      const res = await fetch("/api/p/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: f.get("businessName"),
          fullName: f.get("fullName"),
          email: f.get("email"),
          phone: f.get("phone"),
          password: f.get("password"),
          planCode,
          billingCycle: effCycle,
          kvkkAccepted: f.get("kvkk") === "on",
          termsAccepted: f.get("terms") === "on",
          marketingConsent: f.get("marketing") === "on",
          hp: f.get("website") || undefined,
          elapsedMs: openedAt.current ? Date.now() - openedAt.current : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "İstek alınamadı");
      setSent({ email: data.email, hours: data.expiresInHours ?? 24 });
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-5" role="status" data-testid="purchase-sent">
        <h2 className="font-display text-xl font-semibold">E-postanızı kontrol edin</h2>
        <p className="mt-2 text-sm text-neutral-700">
          <strong>{sent.email}</strong> adresine bir bağlantı gönderdik. Bağlantıyı açtığınızda fatura bilgilerinizi girip kartla ödeme yapabilirsiniz.
        </p>
        <p className="mt-2 text-sm text-neutral-600">Bağlantı {sent.hours} saat geçerlidir. E-posta gelmediyse gereksiz/spam klasörünü kontrol edin.</p>
        <Button variant="outline" className="mt-4" onClick={() => setSent(null)}>Formu yeniden doldur</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paket">
          <Select name="planCode" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.maxStaff} personel)</option>)}
          </Select>
        </Field>
        <Field label="Ödeme dönemi">
          <Select name="billingCycle" value={effCycle} onChange={(e) => setCycle(e.target.value as "MONTHLY" | "YEARLY")}>
            <option value="MONTHLY">Aylık</option>
            {hasYearly && <option value="YEARLY">Yıllık</option>}
          </Select>
        </Field>
      </div>
      <p className="rounded-lg bg-sand-50 p-3 text-sm" data-testid="purchase-price">
        <b>{tl(net)}</b> + %{Number(plan.vatRate).toLocaleString("tr-TR")} KDV = <b>{tl(gross(net, plan.vatRate!))}</b> / {per}. Abonelik her {per} otomatik yenilenir, istediğiniz zaman iptal edebilirsiniz.
      </p>
      <Field label="İşletme adı"><Input name="businessName" required minLength={2} maxLength={120} placeholder="Örn. Işıltı Güzellik Stüdyosu" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yetkili adı soyadı"><Input name="fullName" required minLength={2} maxLength={120} autoComplete="name" /></Field>
        <Field label="Telefon"><Input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" /></Field>
      </div>
      <Field label="E-posta" hint="Doğrulama bağlantısı bu adrese gönderilir; giriş için de bu adresi kullanırsınız."><Input name="email" type="email" required autoComplete="email" maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parola" hint="En az 10 karakter, harf ve rakam"><Input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Parola (tekrar)"><Input name="password2" type="password" required autoComplete="new-password" /></Field>
      </div>
      {/* Bal küpü: ekran okuyucu ve kullanıcıdan gizli; botlar doldurur */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Web sitesi<input name="website" tabIndex={-1} autoComplete="off" /></label>
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
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Gönderiliyor…" : "Devam et"}</Button>
      <p className="text-xs text-neutral-500">Sonraki adımda fatura bilgilerinizi girer, Mesafeli Satış Sözleşmesi&apos;ni onaylar ve iyzico güvencesiyle kartla ödersiniz.</p>
    </form>
  );
}
