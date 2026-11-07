"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type Plan = { code: string; name: string; description: string | null; maxStaff: number; maxCustomers: number | null; maxMonthlyAppointments: number | null; monthlyPrice: string | null; yearlyPrice: string | null; vatRate: string | null; features: string[] };
type Sub = {
  status: string; trialDaysLeft: number | null; plan: Plan; usage: { activeStaff: number; maxStaff: number };
  graceEndsAt: string | null; limitExceeded: boolean; savedMethod: { label: string | null } | null;
  subscription: { billingCycle: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; status: string; source: "PROVIDER" | "MANUAL"; isComplimentary: boolean; priceAmount: string | null; vatRate: string | null } | null;
  payments: { id: string; amount: string; status: string; description: string; createdAt: string; provider: string }[];
  onlinePayment: boolean;
  checkoutKind?: "iyzico" | "token";
  contact: { email: string; phone: string | null };
};

function SubscriptionInner() {
  const { can, refresh } = useSession();
  const toast = useToast();
  const sub = useApi<Sub>("/subscription");
  const plans = useApi<Plan[]>("/plans");
  const [buy, setBuy] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useSearchParams();
  const result = q.get("odeme");

  if (!sub.data) return sub.error ? <Alert>{sub.error.message}</Alert> : <Spinner />;
  const s = sub.data;
  return (
    <>
      <PageHeader title="Abonelik" />
      {result === "basarili" && <div className="mb-4"><Alert tone="green">{q.get("m") || "Ödeme alındı, aboneliğiniz başladı."}</Alert></div>}
      {result === "basarisiz" && <div className="mb-4"><Alert>{q.get("m") || "Ödeme tamamlanamadı."} Kartınızdan çekim yapıldıysa bizimle iletişime geçin.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Mevcut paket" />
          <CardBody className="space-y-2 text-sm">
            <div className="text-2xl font-semibold">{s.plan.name}</div>
            <Badge tone={statusTone(s.status)}>{STATUS_TR[s.status]}</Badge>
            {s.trialDaysLeft !== null && <p>Deneme süresinden <b>{s.trialDaysLeft} gün</b> kaldı.</p>}
            {s.subscription && s.subscription.source === "MANUAL" && (
              <p className="flex flex-wrap items-center gap-2"><Badge tone="blue">Yönetici tarafından tanımlandı</Badge>{s.subscription.isComplimentary && <Badge tone="green">Ücretsiz</Badge>}</p>
            )}
            {s.subscription?.priceAmount && (
              <p>Abonelik fiyatınız: <b>{tl(s.subscription.priceAmount)}</b> / {s.subscription.billingCycle === "YEARLY" ? "yıl" : "ay"} + %{Number(s.subscription.vatRate).toLocaleString("tr-TR")} KDV <span className="text-xs text-neutral-500">(paket fiyatı değişse de dönem boyunca sabittir)</span></p>
            )}
            {s.subscription && <p>Dönem sonu: {dateTr(s.subscription.currentPeriodEnd)} {s.subscription.cancelAtPeriodEnd ? "(iptal edilecek)" : s.subscription.source === "MANUAL" ? "(otomatik yenilenmez)" : "(otomatik yenilenir)"}</p>}
            {s.savedMethod && <p className="text-xs text-neutral-500">Kayıtlı ödeme yöntemi: {s.savedMethod.label}</p>}
            {s.status === "PAST_DUE" && s.graceEndsAt && <Alert tone="amber">Ödeme bekleniyor. {dateTr(s.graceEndsAt)} tarihine kadar ödeme yapılmazsa abonelik sona erer; bu sürede panel salt okunur.</Alert>}
            {s.limitExceeded && <Alert tone="amber">Aktif personel sayınız paket sınırını aşıyor. Yeni personel eklenemez; paketi yükseltin veya personel pasife alın.</Alert>}
            <div className="pt-2">
              <div className="mb-1 flex justify-between"><span>Aktif personel</span><span>{s.usage.activeStaff}/{s.usage.maxStaff}</span></div>
              <div className="h-2 rounded-full bg-sand-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, (s.usage.activeStaff / s.usage.maxStaff) * 100)}%` }} /></div>
            </div>
            {s.subscription?.status === "ACTIVE" && s.subscription.source === "PROVIDER" && !s.subscription.cancelAtPeriodEnd && can("OWNER") && (
              <Button variant="ghost" size="sm" className="mt-2 px-0 text-red-600" onClick={async () => {
                if (!confirm("Abonelik dönem sonunda sona erecek. Onaylıyor musunuz?")) return;
                try { await api("/subscription/cancel", { method: "POST" }); toast("Abonelik dönem sonunda sona erecek"); sub.reload(); } catch (e) { toast((e as Error).message, "red"); }
              }}>Aboneliği iptal et</Button>
            )}
          </CardBody>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {!s.onlinePayment && (
            <div className="sm:col-span-3"><Alert tone="amber">Online ödeme henüz aktif değil. Paket satın almak, değiştirmek veya yenilemek için <a className="font-medium underline" href={`mailto:${s.contact.email}?subject=${encodeURIComponent("Abonelik talebi")}`}>{s.contact.email}</a>{s.contact.phone ? ` ya da ${s.contact.phone}` : ""} üzerinden bize ulaşın; paketiniz onaylandığında hesabınıza tanımlanır. Verileriniz silinmez.</Alert></div>
          )}
          {plans.data?.map((p) => (
            <Card key={p.code} className={p.code === s.plan.code ? "border-brand-400" : ""}>
              <CardBody>
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-neutral-500">{p.maxStaff} personel</div>
                {p.monthlyPrice != null ? (
                  <>
                    <div className="mt-3 text-xl font-semibold">{tl(p.monthlyPrice)}<span className="text-sm font-normal text-neutral-500">/ay + KDV</span></div>
                    {Number(p.yearlyPrice) > 0 && <div className="text-xs text-neutral-500">veya {tl(p.yearlyPrice!)}/yıl + KDV</div>}
                    <div className="text-xs text-neutral-500">KDV oranı %{Number(p.vatRate).toLocaleString("tr-TR")}</div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-neutral-500">Fiyat yakında açıklanacak</div>
                )}
                {can("OWNER") && s.onlinePayment && p.monthlyPrice != null && <Button className="mt-4 w-full" size="sm" variant={p.code === s.plan.code ? "outline" : "default"} onClick={() => setBuy(p)}>{p.code === s.plan.code && s.status === "ACTIVE" ? "Yenile" : "Seç"}</Button>}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title="Ödeme geçmişi" />
        <Table head={["Tarih", "Açıklama", "Tutar", "Durum", "Sağlayıcı"]} empty="Ödeme yok">
          {s.payments.map((p) => <tr key={p.id}><Td>{dateTr(p.createdAt)}</Td><Td>{p.description}</Td><Td>{tl(p.amount)}</Td><Td>{p.status === "PAID" ? "Ödendi" : p.status}</Td><Td>{p.provider === "mock" ? "Test" : p.provider === "iyzico" ? "iyzico" : p.provider}</Td></tr>)}
        </Table>
      </Card>
      {buy && s.onlinePayment && s.checkoutKind === "iyzico" && (
        <Dialog open onClose={() => setBuy(null)} title={`${buy.name} paketi`}>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            // Tam sayfa geçişi: ödeme sayfası iyzico formu için kendi güvenlik başlıklarıyla yüklenir.
            window.location.assign(`/panel/abonelik/odeme?paket=${encodeURIComponent(buy.code)}&donem=${f.get("cycle") === "YEARLY" ? "YEARLY" : "MONTHLY"}`);
          }}>
            <Field label="Ödeme dönemi">
              <Select name="cycle"><option value="MONTHLY">Aylık · {tl(buy.monthlyPrice!)} + KDV</option>{Number(buy.yearlyPrice) > 0 && <option value="YEARLY">Yıllık · {tl(buy.yearlyPrice!)} + KDV</option>}</Select>
            </Field>
            <p className="text-xs text-neutral-500">Kart bilgileri bir sonraki adımda iyzico&apos;nun güvenli formunda girilir.</p>
            <Button className="w-full">Ödemeye geç</Button>
          </form>
        </Dialog>
      )}
      {buy && s.onlinePayment && s.checkoutKind !== "iyzico" && (
        <Dialog open onClose={() => setBuy(null)} title={`${buy.name} paketi`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setErr(null);
            try {
              await api("/subscription/checkout", { method: "POST", body: { planCode: buy.code, billingCycle: f.get("cycle"), paymentToken: f.get("token") } });
              toast("Abonelik etkinleştirildi");
              setBuy(null); sub.reload(); refresh();
            } catch (e) { setErr((e as Error).message); }
          }}>
            <Alert tone="amber"><b>Test modu:</b> gerçek ödeme alınmaz. Gerçek sağlayıcı (iyzico, PayTR vb.) entegre edildiğinde kart bilgisi yalnızca sağlayıcının güvenli formunda girilir.</Alert>
            {err && <Alert>{err}</Alert>}
            <Field label="Ödeme dönemi">
              <Select name="cycle"><option value="MONTHLY">Aylık · {tl(buy.monthlyPrice!)} + KDV</option>{Number(buy.yearlyPrice) > 0 && <option value="YEARLY">Yıllık · {tl(buy.yearlyPrice!)} + KDV</option>}</Select>
            </Field>
            <Field label="Test ödeme belirteci" hint='"tok_fail" başarısız ödemeyi dener.'><Input name="token" defaultValue="tok_test" required /></Field>
            <Button className="w-full">Test ödemesiyle etkinleştir</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SubscriptionInner />
    </Suspense>
  );
}
