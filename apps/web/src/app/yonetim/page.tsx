"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type Stats = { tenants: { total: number; byStatus: Record<string, number> }; byPlan: Record<string, number>; signupsLast30Days: number; appointmentsLast30Days: number; mrr: string; activeSubscriptions: number };
type TenantRow = { id: string; name: string; slug: string; status: string; planCode: string; trialEndsAt: string | null; createdAt: string; plan: { name: string; maxStaff: number }; _count: { customers: number; staff: number; memberships: number }; owner: { email: string; fullName: string } | null };
type Plan = { code: string; name: string; maxStaff: number; monthlyPrice: string; yearlyPrice: string; isActive: boolean };

export default function PlatformPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const stats = useApi<Stats>("/platform/stats");
  const tenants = useApi<TenantRow[]>(`/platform/tenants?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`);
  const plans = useApi<Plan[]>("/platform/plans");
  const [edit, setEdit] = useState<TenantRow | null>(null);
  const [planEdit, setPlanEdit] = useState<Plan | null>(null);

  if (stats.error?.status === 403) {
    return <div className="mx-auto max-w-md p-10"><Alert>Bu sayfa yalnızca platform yöneticilerine açıktır.</Alert></div>;
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3"><Logo /><Badge tone="brand">SaaS yönetimi</Badge></div>
        <div className="flex gap-2">
          <Link href="/panel" className="text-sm text-brand-700">Salon paneli</Link>
          <button className="text-sm text-neutral-500" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/giris"; }}>Çıkış</button>
        </div>
      </header>
      {!stats.data ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="İşletme" value={stats.data.tenants.total} hint={Object.entries(stats.data.tenants.byStatus).map(([k, v]) => `${STATUS_TR[k]} ${v}`).join(" · ")} />
          <Stat label="MRR (aylık gelir)" value={tl(stats.data.mrr)} hint={`${stats.data.activeSubscriptions} aktif abonelik`} />
          <Stat label="Yeni kayıt (30 gün)" value={stats.data.signupsLast30Days} />
          <Stat label="Randevu (30 gün)" value={stats.data.appointmentsLast30Days} />
          <Stat label="Paket dağılımı" value={Object.values(stats.data.byPlan).reduce((a, b) => a + b, 0)} hint={Object.entries(stats.data.byPlan).map(([k, v]) => `${k} ${v}`).join(" · ")} />
        </div>
      )}
      <Card className="mt-6">
        <CardHeader
          title="İşletmeler"
          action={
            <div className="flex gap-2">
              <Input placeholder="Ara" className="h-9 w-44" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tüm durumlar</option>
                {["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{STATUS_TR[s]}</option>)}
              </Select>
            </div>
          }
        />
        <Table head={["İşletme", "Sahip", "Paket", "Durum", "Personel", "Müşteri", "Kayıt", ""]} empty="İşletme yok">
          {tenants.data?.map((t) => (
            <tr key={t.id}>
              <Td><div className="font-medium">{t.name}</div><div className="text-xs text-neutral-500">/{t.slug}</div></Td>
              <Td className="text-xs">{t.owner?.fullName}<div className="text-neutral-500">{t.owner?.email}</div></Td>
              <Td>{t.plan.name}</Td>
              <Td><Badge tone={statusTone(t.status)}>{STATUS_TR[t.status]}</Badge>{t.status === "TRIAL" && t.trialEndsAt && <div className="text-xs text-neutral-500">{dateTr(t.trialEndsAt, { day: "numeric", month: "short" })}</div>}</Td>
              <Td>{t._count.staff}/{t.plan.maxStaff}</Td>
              <Td>{t._count.customers}</Td>
              <Td>{dateTr(t.createdAt, { day: "numeric", month: "short", year: "numeric" })}</Td>
              <Td><Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Yönet</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Paketler ve fiyatlar" />
        <Table head={["Paket", "Personel sınırı", "Aylık", "Yıllık", ""]}>
          {plans.data?.map((p) => (
            <tr key={p.code}><Td className="font-medium">{p.name}</Td><Td>{p.maxStaff}</Td><Td>{tl(p.monthlyPrice)}</Td><Td>{tl(p.yearlyPrice)}</Td><Td><Button size="sm" variant="ghost" onClick={() => setPlanEdit(p)}>Düzenle</Button></Td></tr>
          ))}
        </Table>
      </Card>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.name}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api(`/platform/tenants/${edit.id}`, { method: "PATCH", body: { status: f.get("status"), planCode: f.get("planCode"), ...(f.get("trialEndsAt") ? { trialEndsAt: new Date(`${f.get("trialEndsAt")}T23:59:00+03:00`).toISOString() } : {}) } });
              toast("İşletme güncellendi"); setEdit(null); tenants.reload(); stats.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Durum"><Select name="status" defaultValue={edit.status}>{["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{STATUS_TR[s]}</option>)}</Select></Field>
            <Field label="Paket"><Select name="planCode" defaultValue={edit.planCode}><option value="STARTER">Başlangıç</option><option value="PROFESSIONAL">Profesyonel</option><option value="SMART">Akıllı</option></Select></Field>
            <Field label="Deneme bitişi (uzat)"><Input name="trialEndsAt" type="date" /></Field>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
      {planEdit && (
        <Dialog open onClose={() => setPlanEdit(null)} title={`${planEdit.name} paketi`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api(`/platform/plans/${planEdit.code}`, { method: "PATCH", body: { maxStaff: Number(f.get("maxStaff")), monthlyPrice: Number(f.get("monthlyPrice")), yearlyPrice: Number(f.get("yearlyPrice")) } });
              toast("Paket güncellendi"); setPlanEdit(null); plans.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Personel sınırı"><Input name="maxStaff" type="number" min={1} defaultValue={planEdit.maxStaff} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aylık (₺)"><Input name="monthlyPrice" type="number" step="0.01" defaultValue={Number(planEdit.monthlyPrice)} /></Field>
              <Field label="Yıllık (₺)"><Input name="yearlyPrice" type="number" step="0.01" defaultValue={Number(planEdit.yearlyPrice)} /></Field>
            </div>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
