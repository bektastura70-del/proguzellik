"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

export type Plan = { code: string; name: string; maxStaff: number; monthlyPrice: string; yearlyPrice: string; features: string[]; isActive: boolean; sortOrder: number };

/** Paket özellikleri (API'deki PLAN_FEATURES ile aynı). */
export const FEATURE_TR: Record<string, string> = {
  CRM: "Müşteri yönetimi",
  APPOINTMENTS: "Randevu takvimi",
  ONLINE_BOOKING: "Online randevu",
  FINANCE: "Kasa ve finans",
  PACKAGES: "Paket ve seans takibi",
  STOCK: "Stok",
  REPORTS: "Raporlar",
  WHATSAPP: "WhatsApp bildirimleri",
  AI_ASSISTANT: "Akıllı asistan",
};

export const usePlatformPlans = () => useApi<Plan[]>("/platform/plans");

/** Paket seçenekleri: satıştaki paketler + (pasif olsa bile) mevcut seçim. */
export function PlanOptions({ plans, current }: { plans: Plan[] | null | undefined; current?: string }) {
  return (
    <>
      {(plans ?? []).filter((p) => p.isActive || p.code === current).map((p) => (
        <option key={p.code} value={p.code}>{p.name}{p.isActive ? "" : " (satışta değil)"} · {p.maxStaff} personel</option>
      ))}
    </>
  );
}

export function PlansCard() {
  const toast = useToast();
  const plans = usePlatformPlans();
  const [edit, setEdit] = useState<Plan | "new" | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader title="Paketler ve fiyatlar" description="Fiyatlar tanıtım sitesinde ve abonelikte gösterilir. Pasif paket yeni işletmelere atanamaz; mevcut işletmeler etkilenmez." action={<Button size="sm" onClick={() => setEdit("new")}>Yeni paket</Button>} />
      <Table head={["Paket", "Kod", "Personel sınırı", "Aylık", "Yıllık", "Özellikler", "Durum", ""]}>
        {plans.data?.map((p) => (
          <tr key={p.code}>
            <Td className="font-medium">{p.name}</Td>
            <Td className="text-xs text-neutral-500">{p.code}</Td>
            <Td>{p.maxStaff}</Td>
            <Td>{tl(p.monthlyPrice)}</Td>
            <Td>{tl(p.yearlyPrice)}</Td>
            <Td className="max-w-xs text-xs text-neutral-600">{p.features.map((f) => FEATURE_TR[f] ?? f).join(", ") || "—"}</Td>
            <Td>{p.isActive ? <Badge tone="green">Satışta</Badge> : <Badge>Pasif</Badge>}</Td>
            <Td><Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Düzenle</Button></Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit === "new" ? "Yeni paket" : `${edit.name} paketi`}>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body = {
                name: f.get("name"),
                maxStaff: Number(f.get("maxStaff")),
                monthlyPrice: Number(f.get("monthlyPrice")),
                yearlyPrice: Number(f.get("yearlyPrice")),
                sortOrder: Number(f.get("sortOrder")),
                features: f.getAll("features"),
                isActive: f.get("isActive") === "on",
              };
              try {
                if (edit === "new") await api("/platform/plans", { method: "POST", body: { ...body, code: f.get("code") } });
                else await api(`/platform/plans/${edit.code}`, { method: "PATCH", body });
                toast(edit === "new" ? "Paket oluşturuldu" : "Paket güncellendi");
                setEdit(null);
                plans.reload();
              } catch (err) { toast((err as Error).message, "red"); }
            }}
          >
            {edit === "new" && <Field label="Paket kodu" hint="Büyük harf, rakam ve alt çizgi; sonradan değiştirilemez (ör. KURUMSAL)"><Input name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,31}" /></Field>}
            <Field label="Paket adı"><Input name="name" required minLength={2} maxLength={60} defaultValue={edit === "new" ? "" : edit.name} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Personel sınırı"><Input name="maxStaff" type="number" min={1} max={500} required defaultValue={edit === "new" ? 5 : edit.maxStaff} /></Field>
              <Field label="Sıra"><Input name="sortOrder" type="number" min={0} max={1000} defaultValue={edit === "new" ? 100 : edit.sortOrder} /></Field>
              <Field label="Aylık (₺)"><Input name="monthlyPrice" type="number" min={0} step="0.01" required defaultValue={edit === "new" ? "" : Number(edit.monthlyPrice)} /></Field>
              <Field label="Yıllık (₺)"><Input name="yearlyPrice" type="number" min={0} step="0.01" required defaultValue={edit === "new" ? "" : Number(edit.yearlyPrice)} /></Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Özellikler</legend>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(FEATURE_TR).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" name="features" value={k} defaultChecked={edit !== "new" && edit.features.includes(k)} />{v}</label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={edit === "new" || edit.isActive} />Satışta (yeni işletmelere atanabilir)</label>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
    </Card>
  );
}

type SubRow = {
  id: string; status: string; source: "PROVIDER" | "MANUAL"; isComplimentary: boolean; billingCycle: string;
  currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean;
  plan: { code: string; name: string }; tenant: { id: string; name: string; status: string };
};
type SubList = { summary: { tenants: Record<string, number>; subscriptions: Record<string, number>; trialsEndingIn7Days: { id: string; name: string; trialEndsAt: string }[]; subscriptionsEndingIn7Days: number }; items: SubRow[] };
const SUB_STATUS_TR: Record<string, string> = { ACTIVE: "Aktif", PAST_DUE: "Ödeme bekliyor", CANCELLED: "İptal / süresi doldu" };
const day = (iso: string) => dateTr(iso, { day: "numeric", month: "short", year: "numeric" });

/** Abonelik izleme: aktif, deneme, süresi dolan ve askıdaki işletmeler. */
export function SubscriptionsCard({ onOpenTenant }: { onOpenTenant: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [expiring, setExpiring] = useState("");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(expiring ? { expiringDays: expiring } : {}), ...(q ? { q } : {}) });
  const list = useApi<SubList>(`/platform/subscriptions?${qs}`);
  const s = list.data?.summary;
  return (
    <>
      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Deneme" value={s.tenants.TRIAL ?? 0} hint={`${s.trialsEndingIn7Days.length} tanesi 7 gün içinde bitiyor`} />
          <Stat label="Aktif işletme" value={s.tenants.ACTIVE ?? 0} />
          <Stat label="Ödeme bekleyen / süresi dolan" value={s.tenants.PAST_DUE ?? 0} />
          <Stat label="Askıda" value={s.tenants.SUSPENDED ?? 0} />
          <Stat label="7 günde biten abonelik" value={s.subscriptionsEndingIn7Days} />
        </div>
      )}
      {s && s.trialsEndingIn7Days.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Denemesi yakında bitenler" />
          <Table head={["İşletme", "Deneme bitişi", ""]}>
            {s.trialsEndingIn7Days.map((t) => (
              <tr key={t.id}><Td>{t.name}</Td><Td>{day(t.trialEndsAt)}</Td><Td><Button size="sm" variant="ghost" onClick={() => onOpenTenant(t.id)}>Yönet</Button></Td></tr>
            ))}
          </Table>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader
          title="Abonelikler"
          action={
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Abonelik ara" placeholder="İşletme ara" className="h-9 w-44" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select aria-label="Abonelik durumu" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tüm durumlar</option>
                {Object.entries(SUB_STATUS_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="Abonelik kaynağı" className="h-9 w-40" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Tüm kaynaklar</option>
                <option value="PROVIDER">Ödemeli</option>
                <option value="MANUAL">Manuel</option>
              </Select>
              <Select aria-label="Bitiş" className="h-9 w-40" value={expiring} onChange={(e) => setExpiring(e.target.value)}>
                <option value="">Tüm bitişler</option>
                <option value="7">7 gün içinde</option>
                <option value="30">30 gün içinde</option>
              </Select>
            </div>
          }
        />
        {!list.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["İşletme", "Paket", "Kaynak", "Durum", "Dönem", ""]} empty="Abonelik yok">
            {list.data.items.map((x) => (
              <tr key={x.id}>
                <Td><div className="font-medium">{x.tenant.name}</div><Badge tone={statusTone(x.tenant.status)}>{STATUS_TR[x.tenant.status]}</Badge></Td>
                <Td>{x.plan.name} · {x.billingCycle === "YEARLY" ? "Yıllık" : x.billingCycle === "MONTHLY" ? "Aylık" : "Özel"}</Td>
                <Td>{x.source === "MANUAL" ? <Badge tone="amber">{x.isComplimentary ? "Manuel · ücretsiz" : "Manuel"}</Badge> : <Badge tone="blue">Ödemeli</Badge>}</Td>
                <Td><Badge tone={statusTone(x.status)}>{SUB_STATUS_TR[x.status]}</Badge>{x.cancelAtPeriodEnd && <div className="text-xs text-neutral-500">Dönem sonunda bitecek</div>}</Td>
                <Td className="text-xs">{day(x.currentPeriodStart)} – {day(x.currentPeriodEnd)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onOpenTenant(x.tenant.id)}>Yönet</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
