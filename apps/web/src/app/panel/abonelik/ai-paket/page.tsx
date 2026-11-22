"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AiQuotaCard } from "@/components/panel/ai-quota-card";
import { useSession } from "@/components/panel/session";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, tl } from "@/lib/format";
import { mountIyzicoForm } from "@/lib/iyzico-form";

type Quote = { amount: number; netAmount: string; vat: string; vatRate: string; grossAmount: string; monthsEquivalent: number | null; percentNow: number; percentAfter: number };
type History = { id: string; createdAt: string; grossAmount: string; status: string; sandbox: boolean; refundedAmount: string };
type Options =
  | { available: false; reason: string; history: History[] }
  | { available: true; presets: Quote[]; min: number; max: number; step: number; termsVersion: string; history: History[] };
type Started = { checkoutFormContent: string; amount: string };

/** Birimsiz etki metni: "aylık kullanım hakkınızın yaklaşık 1 katı". */
function effectText(m: number | null) {
  if (m == null) return "";
  const part: Record<number, string> = { 0.25: "çeyreği", 0.5: "yarısı", 0.75: "dörtte üçü" };
  if (part[m]) return `aylık kullanım hakkınızın yaklaşık ${part[m]} kadar ek kullanım sağlar`;
  return `aylık kullanım hakkınızın yaklaşık ${m.toLocaleString("tr-TR")} katı kadar ek kullanım sağlar`;
}

const STATUS = { COMPLETED: "Yüklendi", REFUNDED: "İade edildi", PENDING: "Doğrulanıyor", FAILED: "Başarısız" } as Record<string, string>;

function TopupInner() {
  const { can } = useSession();
  const q = useSearchParams();
  const result = q.get("odeme");
  const o = useApi<Options>("/ai-quota/topup");
  const [amount, setAmount] = useState(1000);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Started | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!o.data?.available) return;
    const preset = o.data.presets.find((p) => p.amount === amount);
    if (preset) return setQuote(preset);
    const valid = Number.isInteger(amount) && amount >= o.data.min && amount <= o.data.max && amount % o.data.step === 0;
    if (!valid) return setQuote(null);
    let live = true;
    api<Quote>(`/ai-quota/topup/quote?amount=${amount}`).then((r) => live && setQuote(r)).catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [amount, o.data]);

  useEffect(() => {
    if (started && !mounted.current) {
      mounted.current = true;
      mountIyzicoForm(started.checkoutFormContent);
    }
  }, [started]);

  if (!o.data) return o.error ? <Alert>{o.error.message}</Alert> : <Spinner />;
  const d = o.data;
  return (
    <>
      <PageHeader title="Yapay zekâ ek paketi" description="Aylık kullanım hakkınız bittiğinde yapay zekâ yanıtlarına devam etmek için." />
      {result === "basarili" && <div className="mb-4"><Alert tone="green">Ödeme alındı, ek paketiniz yüklendi.</Alert></div>}
      {result === "bekliyor" && <div className="mb-4"><Alert tone="amber">Ödemeniz doğrulanıyor. Birkaç dakika sonra bu sayfayı yenileyin.</Alert></div>}
      {result === "basarisiz" && <div className="mb-4"><Alert>Ödeme tamamlanamadı; ek paket yüklenmedi. Kartınızdan çekim yapıldıysa iade edilir.</Alert></div>}
      <div className="mb-6"><AiQuotaCard compact buyLink={false} /></div>
      {!d.available ? (
        <Alert tone="amber">{d.reason}</Alert>
      ) : !can("OWNER") ? (
        <Alert tone="amber">Ek paketi yalnız işletme sahibi satın alabilir.</Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Paket seçin" description="Tutarlar KDV hariçtir." />
            <CardBody className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {d.presets.map((p) => (
                  <Button key={p.amount} type="button" size="sm" variant={amount === p.amount ? "default" : "outline"} disabled={!!started} onClick={() => setAmount(p.amount)}>{tl(String(p.amount))}</Button>
                ))}
              </div>
              <Field label="Başka bir tutar (TL, KDV hariç)" hint={`${d.min} ile ${d.max.toLocaleString("tr-TR")} TL arası, ${d.step} TL'nin katı`}>
                <Input type="number" min={d.min} max={d.max} step={d.step} value={amount} disabled={!!started} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>
              {quote ? (
                <div className="space-y-3 rounded-xl border border-sand-200 p-4">
                  <p>Bu paket, {effectText(quote.monthsEquivalent)}.</p>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-neutral-500"><span>Şu an yaklaşık %{quote.percentNow}</span><span>Paketten sonra yaklaşık %{quote.percentAfter}</span></div>
                    <div className="relative h-3 rounded-full bg-sand-100" aria-label="Paketten sonra kullanım hakkınız (yaklaşık)">
                      <div className="absolute h-3 rounded-full bg-brand-200" style={{ width: `${quote.percentAfter}%` }} />
                      <div className="absolute h-3 rounded-full bg-brand-500" style={{ width: `${quote.percentNow}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500">Ek paket hakkı aylık hakkınız bittikten sonra kullanılır ve son alımdan itibaren 12 ay geçerlidir. Gerçek kullanım konuşmaların uzunluğuna göre değişir.</p>
                  <dl className="grid grid-cols-2 gap-1">
                    <dt>Tutar (KDV hariç)</dt><dd className="text-right">{tl(quote.netAmount)}</dd>
                    <dt>KDV (%{Number(quote.vatRate).toLocaleString("tr-TR")})</dt><dd className="text-right">{tl(quote.vat)}</dd>
                    <dt className="font-semibold">Ödenecek toplam</dt><dd className="text-right font-semibold">{tl(quote.grossAmount)}</dd>
                  </dl>
                </div>
              ) : (
                <Alert tone="amber">Geçerli bir tutar seçin.</Alert>
              )}
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
                    if (!quote) return;
                    const f = new FormData(e.currentTarget);
                    setErr(null);
                    if (!f.get("onay")) return setErr("Devam etmek için satış koşullarını onaylayın");
                    if (!f.get("aninda_ifa")) return setErr("Devam etmek için hizmetin hemen başlamasına onay verin");
                    setBusy(true);
                    try {
                      const r = await api<Started>("/ai-quota/topup/checkout", {
                        method: "POST",
                        body: {
                          amount,
                          billing: { fullName: f.get("fullName"), identityNumber: f.get("identityNumber"), gsmNumber: f.get("gsmNumber"), city: f.get("city"), address: f.get("address") },
                          acceptedTerms: true,
                          acceptedInstantPerformance: true,
                          termsVersion: d.termsVersion,
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
                  {/* TASLAK: ek paket satış metinleri hukuki onaydan sonra bağlanacak; satış canlıda AI_TOPUP_ENABLED ile kapalıdır. */}
                  <div className="space-y-2 text-sm">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="onay" className="mt-1" />
                      <span>Ek paket ön bilgilendirmesini ve satış koşullarını okudum, onaylıyorum. Tek seferlik ödemedir, otomatik yenilenmez.</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="aninda_ifa" className="mt-1" />
                      <span>Ek paketin ödeme onaylanınca hemen hesabıma yüklenmesini istiyorum.</span>
                    </label>
                    <p className="text-xs text-neutral-500">Kişisel verilerinizin işlenmesi: <a className="underline" href="/kvkk" target="_blank">KVKK Aydınlatma Metni</a>.</p>
                  </div>
                  <Button className="w-full" disabled={busy || !quote}>{busy ? "Hazırlanıyor…" : quote ? `Kart ile öde (${tl(quote.grossAmount)})` : "Kart ile öde"}</Button>
                </form>
              ) : (
                <div id="iyzipay-checkout-form" className="responsive" />
              )}
            </CardBody>
          </Card>
        </div>
      )}
      {d.history.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Ek paket alımlarınız" />
          <Table head={["Tarih", "Tutar (KDV dahil)", "Durum"]} empty="Alım yok">
            {d.history.map((h) => (
              <tr key={h.id}><Td>{dateTr(h.createdAt)}</Td><Td>{tl(h.grossAmount)}{Number(h.refundedAmount) > 0 && <div className="text-xs text-neutral-500">İade: {tl(h.refundedAmount)}</div>}</Td><Td>{STATUS[h.status] ?? h.status}{h.sandbox ? " (test, ücret alınmadı)" : ""}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
      <p className="mt-4 text-sm"><a className="underline" href="/panel/abonelik">Abonelik sayfasına dön</a></p>
    </>
  );
}

export default function AiTopupPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TopupInner />
    </Suspense>
  );
}
