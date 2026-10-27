"use client";

import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type Plan = { code: string; name: string; maxStaff: number; monthlyPrice: string; yearlyPrice: string; features: string[] };
type Sub = {
  status: string; trialDaysLeft: number | null; plan: Plan; usage: { activeStaff: number; maxStaff: number };
  subscription: { billingCycle: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; status: string } | null;
  payments: { id: string; amount: string; status: string; description: string; createdAt: string; provider: string }[];
};

export default function SubscriptionPage() {
  const { can, refresh } = useSession();
  const toast = useToast();
  const sub = useApi<Sub>("/subscription");
  const plans = useApi<Plan[]>("/plans");
  const [buy, setBuy] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!sub.data) return sub.error ? <Alert>{sub.error.message}</Alert> : <Spinner />;
  const s = sub.data;
  return (
    <>
      <PageHeader title="Abonelik" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Mevcut paket" />
          <CardBody className="space-y-2 text-sm">
            <div className="text-2xl font-semibold">{s.plan.name}</div>
            <Badge tone={statusTone(s.status)}>{STATUS_TR[s.status]}</Badge>
            {s.trialDaysLeft !== null && <p>Deneme süresinden <b>{s.trialDaysLeft} gün</b> kaldı.</p>}
            {s.subscription && <p>Dönem sonu: {dateTr(s.subscription.currentPeriodEnd)} {s.subscription.cancelAtPeriodEnd && "(iptal edilecek)"}</p>}
            <div className="pt-2">
              <div className="mb-1 flex justify-between"><span>Aktif personel</span><span>{s.usage.activeStaff}/{s.usage.maxStaff}</span></div>
              <div className="h-2 rounded-full bg-sand-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, (s.usage.activeStaff / s.usage.maxStaff) * 100)}%` }} /></div>
            </div>
            {s.subscription?.status === "ACTIVE" && !s.subscription.cancelAtPeriodEnd && can("OWNER") && (
              <Button variant="ghost" size="sm" className="mt-2 px-0 text-red-600" onClick={async () => {
                if (!confirm("Abonelik dönem sonunda sona erecek. Onaylıyor musunuz?")) return;
                try { await api("/subscription/cancel", { method: "POST" }); toast("Abonelik dönem sonunda sona erecek"); sub.reload(); } catch (e) { toast((e as Error).message, "red"); }
              }}>Aboneliği iptal et</Button>
            )}
          </CardBody>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {plans.data?.map((p) => (
            <Card key={p.code} className={p.code === s.plan.code ? "border-brand-400" : ""}>
              <CardBody>
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-neutral-500">{p.maxStaff} personel</div>
                <div className="mt-3 text-xl font-semibold">{tl(p.monthlyPrice)}<span className="text-sm font-normal text-neutral-500">/ay</span></div>
                <div className="text-xs text-neutral-500">veya {tl(p.yearlyPrice)}/yıl</div>
                {can("OWNER") && <Button className="mt-4 w-full" size="sm" variant={p.code === s.plan.code ? "outline" : "default"} onClick={() => setBuy(p)}>{p.code === s.plan.code && s.status === "ACTIVE" ? "Yenile" : "Seç"}</Button>}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title="Ödeme geçmişi" />
        <Table head={["Tarih", "Açıklama", "Tutar", "Durum", "Sağlayıcı"]} empty="Ödeme yok">
          {s.payments.map((p) => <tr key={p.id}><Td>{dateTr(p.createdAt)}</Td><Td>{p.description}</Td><Td>{tl(p.amount)}</Td><Td>{p.status === "PAID" ? "Ödendi" : p.status}</Td><Td>{p.provider === "mock" ? "Test" : p.provider}</Td></tr>)}
        </Table>
      </Card>
      {buy && (
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
              <Select name="cycle"><option value="MONTHLY">Aylık · {tl(buy.monthlyPrice)}</option><option value="YEARLY">Yıllık · {tl(buy.yearlyPrice)}</option></Select>
            </Field>
            <Field label="Test ödeme belirteci" hint='"tok_fail" başarısız ödemeyi dener.'><Input name="token" defaultValue="tok_test" required /></Field>
            <Button className="w-full">Test ödemesiyle etkinleştir</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
