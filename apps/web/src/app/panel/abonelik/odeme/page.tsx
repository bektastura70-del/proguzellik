"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/components/panel/session";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { tl } from "@/lib/format";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";

type Plan = { code: string; name: string; maxStaff: number; monthlyPrice: string | null; yearlyPrice: string | null; vatRate: string | null };
type Sub = { onlinePayment: boolean; checkoutKind?: "iyzico" | "token" };
type Started = { checkoutFormContent: string; amount: string; netAmount: string; vatRate: string };

/** iyzico'nun döndürdüğü form içeriğini (betikler) sayfaya yükler; kart bilgisi iyzico'nun formunda girilir. */
function mountIyzicoForm(html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
    s.text = old.text;
    document.body.appendChild(s);
  });
}

function PaymentInner() {
  const q = useSearchParams();
  const { can } = useSession();
  const code = q.get("paket") ?? "";
  const cycle = q.get("donem") === "YEARLY" ? "YEARLY" : "MONTHLY";
  const sub = useApi<Sub>("/subscription");
  const plans = useApi<Plan[]>("/plans");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (started && !mounted.current) {
      mounted.current = true;
      mountIyzicoForm(started.checkoutFormContent);
    }
  }, [started]);

  if (!sub.data || !plans.data) return sub.error ? <Alert>{sub.error.message}</Alert> : <Spinner />;
  const plan = plans.data.find((p) => p.code === code);
  if (!plan) return <Alert>Paket bulunamadı. <a className="underline" href="/panel/abonelik">Abonelik sayfasına dönün</a>.</Alert>;
  if (!sub.data.onlinePayment || sub.data.checkoutKind !== "iyzico") return <Alert tone="amber">Online ödeme şu an kapalı. <a className="underline" href="/panel/abonelik">Abonelik sayfasına dönün</a>.</Alert>;
  if (!can("OWNER")) return <Alert>Ödemeyi yalnız işletme sahibi yapabilir.</Alert>;
  const net = cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
  if (net == null || !(Number(net) > 0)) return <Alert>Bu paket için bu ödeme dönemi yok.</Alert>;
  const vat = Number(plan.vatRate ?? 0);
  const gross = (Number(net) * (1 + vat / 100)).toFixed(2);
  const per = cycle === "YEARLY" ? "yıl" : "ay";

  return (
    <>
      <PageHeader title="Ödeme" description={`${plan.name} paketi · ${cycle === "YEARLY" ? "Yıllık" : "Aylık"} ödeme`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Özet" />
          <CardBody className="space-y-2 text-sm">
            <p>{plan.name} paketi, en fazla {plan.maxStaff} aktif personel</p>
            <p>Tutar: <b>{tl(net)}</b> + %{vat.toLocaleString("tr-TR")} KDV = <b>{tl(gross)}</b> / {per}</p>
            <p>İlk ödeme bugün alınır ve ücretli dönem bugün başlar (deneme süreniz kalmışsa bugün sona erer).</p>
            <p>Abonelik her {per} aynı karttan otomatik yenilenir. İstediğiniz zaman Abonelik sayfasından iptal edebilirsiniz; erişiminiz dönem sonuna kadar sürer.</p>
            <p className="text-xs text-neutral-500">
              Kart bilgileriniz yalnız iyzico&apos;nun güvenli ödeme formunda girilir; ProGüzellik kart bilgisi görmez ve saklamaz. Ayrıntılar:{" "}
              <a className="underline" href="/mesafeli-satis-sozlesmesi" target="_blank">Mesafeli Satış Sözleşmesi</a>,{" "}
              <a className="underline" href="/teslimat-ve-iade-sartlari" target="_blank">Teslimat ve İade Şartları</a>.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={started ? "Kart bilgileri" : "Fatura bilgileri"} description={started ? "Ödeme iyzico güvencesiyle alınır." : "Bu bilgiler faturanız ve iyzico ödeme kaydı için iyzico'ya iletilir."} />
          <CardBody>
            {!started ? (
              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setErr(null);
                  if (!f.get("onay")) return setErr("Devam etmek için sözleşmeyi onaylayın");
                  setBusy(true);
                  try {
                    const r = await api<Started>("/subscription/iyzico/checkout", {
                      method: "POST",
                      body: {
                        planCode: plan.code,
                        billingCycle: cycle,
                        billing: { fullName: f.get("fullName"), identityNumber: f.get("identityNumber"), gsmNumber: f.get("gsmNumber"), city: f.get("city"), address: f.get("address") },
                        acceptedTerms: true,
                        termsVersion: `${IYZICO_DOCS_DATES.version} (${IYZICO_DOCS_DATES.updated})`,
                      },
                    });
                    setStarted(r);
                  } catch (e2) {
                    setErr((e2 as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {err && <Alert>{err}</Alert>}
                <Field label="Ad soyad (fatura adına)"><Input name="fullName" required minLength={3} maxLength={100} autoComplete="name" /></Field>
                <Field label="T.C. kimlik no veya vergi no" hint="Şahıs için 11 haneli T.C. kimlik no, şirket için 10 haneli vergi no."><Input name="identityNumber" required inputMode="numeric" pattern="\d{10,11}" maxLength={11} /></Field>
                <Field label="Cep telefonu"><Input name="gsmNumber" required inputMode="tel" placeholder="05xx xxx xx xx" autoComplete="tel" /></Field>
                <Field label="Şehir"><Input name="city" required minLength={2} maxLength={50} autoComplete="address-level1" /></Field>
                <Field label="Fatura adresi"><Input name="address" required minLength={5} maxLength={300} autoComplete="street-address" /></Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="onay" className="mt-1" />
                  <span>
                    <a className="underline" href="/mesafeli-satis-sozlesmesi" target="_blank">Mesafeli Satış Sözleşmesi</a>&apos;ni ve{" "}
                    <a className="underline" href="/teslimat-ve-iade-sartlari" target="_blank">Teslimat ve İade Şartları</a>&apos;nı okudum, onaylıyorum.
                  </span>
                </label>
                <Button className="w-full" disabled={busy}>{busy ? "Hazırlanıyor…" : `Kart ile öde (${tl(gross)})`}</Button>
              </form>
            ) : (
              <div id="iyzipay-checkout-form" className="responsive" />
            )}
          </CardBody>
        </Card>
      </div>
      <p className="mt-4 text-sm"><a className="underline" href="/panel/abonelik">Vazgeç ve abonelik sayfasına dön</a></p>
    </>
  );
}

export default function IyzicoPaymentPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PaymentInner />
    </Suspense>
  );
}
