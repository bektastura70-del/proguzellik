"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";
import { mountIyzicoForm } from "@/lib/iyzico-form";
import { tl } from "@/lib/format";
import { CONSENT_FIELDS, consentError, PreInfoSummary, PurchaseConsents } from "@/components/purchase-consents";

type Summary = {
  businessName: string; fullName: string; email: string; phone: string;
  plan: { code: string; name: string; maxStaff: number }; billingCycle: "MONTHLY" | "YEARLY";
  netAmount: string; vatRate: string; grossAmount: string; paymentPending: boolean; available: boolean;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/p/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "İşlem yapılamadı");
  return data as T;
}

/**
 * E-postadaki bağlantı: belirteç adres çubuğundan kaldırılır ve yalnız bellekte tutulur (sayfa yenilenirse e-postadaki bağlantı yeniden açılır). Özet gösterilir,
 * fatura bilgileri + sözleşme onayıyla iyzico ödeme formu açılır. Hesap ödeme alınınca açılır.
 */
function Payment() {
  const q = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // Belirteç yalnız bellekte tutulur (tarayıcı depolaması kullanılmaz); adres çubuğundan ve geçmişten kaldırılır.
    const t = q.get("token");
    if (!t) {
      setErr("Bağlantı eksik. E-postanızdaki bağlantıyı yeniden açın.");
      return;
    }
    window.history.replaceState(null, "", "/satin-al/odeme");
    setToken(t);
    post<Summary>("purchase/verify", { token: t }).then(setSum, (e: Error) => setErr(e.message));
    // Yalnız ilk açılışta çalışır; adres değişince belirteç zaten bellektedir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form && !mounted.current) {
      mounted.current = true;
      mountIyzicoForm(form);
    }
  }, [form]);

  if (err && !sum) return <div className="mt-6"><Alert>{err}</Alert><p className="mt-4 text-sm"><Link href="/fiyatlar" className="text-brand-700 underline">Fiyatlar sayfasına dön</Link></p></div>;
  if (!sum) return <div className="mt-8"><Spinner /></div>;
  const per = sum.billingCycle === "YEARLY" ? "yıl" : "ay";

  return (
    <>
      <h1 className="mt-8 font-display text-3xl font-semibold">Ödeme</h1>
      <div className="mt-4 space-y-1 rounded-xl border border-sand-200 bg-white p-4 text-sm" data-testid="purchase-summary">
        <p><b>{sum.businessName}</b> · {sum.fullName} · {sum.email}</p>
        <p>{sum.plan.name} paketi, en fazla {sum.plan.maxStaff} aktif personel · {sum.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"} ödeme</p>
        <p>Tutar: <b>{tl(sum.netAmount)}</b> + %{Number(sum.vatRate).toLocaleString("tr-TR")} KDV = <b>{tl(sum.grossAmount)}</b> / {per}</p>
        <p className="text-neutral-600">İlk ödeme bugün alınır ve hesabınız ödeme alındığı anda açılır. Abonelik her {per} aynı karttan otomatik yenilenir; panelinizdeki Abonelik sayfasından istediğiniz zaman iptal edebilirsiniz, erişiminiz dönem sonuna kadar sürer.</p>
      </div>
      {sum.paymentPending ? (
        <div className="mt-4"><Alert tone="amber">Ödemeniz doğrulanıyor. Hesabınız açıldığında e-posta alacaksınız; birkaç dakika sonra giriş yapmayı deneyin.</Alert></div>
      ) : !sum.available ? (
        <div className="mt-4"><Alert tone="amber">Online satın alma şu an kullanılamıyor. Lütfen daha sonra tekrar deneyin.</Alert></div>
      ) : form ? (
        <div className="mt-6"><div id="iyzipay-checkout-form" className="responsive" /></div>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setErr(null);
            const ce = consentError(f);
            if (ce) return setErr(ce);
            setBusy(true);
            try {
              const r = await post<{ checkoutFormContent: string }>("purchase/checkout", {
                token,
                billing: { fullName: f.get("fullName"), identityNumber: f.get("identityNumber"), gsmNumber: f.get("gsmNumber"), city: f.get("city"), address: f.get("address") },
                ...CONSENT_FIELDS,
                termsVersion: `${IYZICO_DOCS_DATES.version} (${IYZICO_DOCS_DATES.updated})`,
              });
              setForm(r.checkoutFormContent);
            } catch (e2) {
              setErr((e2 as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="text-lg font-semibold">Fatura bilgileri</h2>
          <p className="text-xs text-neutral-500">Bu bilgiler faturanız ve ödeme kaydı için iyzico&apos;ya iletilir.</p>
          {err && <Alert>{err}</Alert>}
          <Field label="Ad soyad (fatura adına)"><Input name="fullName" required minLength={3} maxLength={100} autoComplete="name" defaultValue={sum.fullName} /></Field>
          <Field label="T.C. kimlik no veya vergi no" hint="Şahıs için 11 haneli T.C. kimlik no, şirket için 10 haneli vergi no."><Input name="identityNumber" required inputMode="numeric" pattern="\d{10,11}" maxLength={11} /></Field>
          <Field label="Cep telefonu"><Input name="gsmNumber" required inputMode="tel" autoComplete="tel" defaultValue={sum.phone.replace(/^\+90/, "0")} /></Field>
          <Field label="Şehir"><Input name="city" required minLength={2} maxLength={50} autoComplete="address-level1" /></Field>
          <Field label="Fatura adresi"><Input name="address" required minLength={5} maxLength={300} autoComplete="street-address" /></Field>
          <PreInfoSummary planName={sum.plan.name} maxStaff={sum.plan.maxStaff} cycle={sum.billingCycle} net={sum.netAmount} vatRate={sum.vatRate} gross={sum.grossAmount} />
          <PurchaseConsents cycle={sum.billingCycle} gross={sum.grossAmount} />
          <Button className="w-full" size="lg" disabled={busy}>{busy ? "Hazırlanıyor…" : `Kart ile öde (${tl(sum.grossAmount)})`}</Button>
          <p className="text-xs text-neutral-500">Kart bilgileriniz yalnız iyzico&apos;nun güvenli ödeme formunda girilir; ProGüzellik kart bilgisi görmez ve saklamaz.</p>
        </form>
      )}
    </>
  );
}

export default function PurchasePaymentPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        <Suspense fallback={<Spinner />}><Payment /></Suspense>
      </div>
    </main>
  );
}
