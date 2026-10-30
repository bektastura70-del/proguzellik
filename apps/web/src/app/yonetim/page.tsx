"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { InviteBadge, NewTenantDialog, TenantDetailDialog } from "@/components/platform/tenant-admin";
import { CompanySettingsCard, FinanceOverview } from "@/components/platform/finance-admin";
import { PlansCard, SubscriptionsCard } from "@/components/platform/plan-admin";
import { UsersCard } from "@/components/platform/user-admin";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type Stats = { tenants: { total: number; byStatus: Record<string, number> }; byPlan: Record<string, number>; signupsLast30Days: number; appointmentsLast30Days: number; mrr: string; activeSubscriptions: number; manualSubscriptions: { total: number; complimentary: number } };
type TenantRow = { id: string; name: string; slug: string; status: string; planCode: string; trialEndsAt: string | null; createdAt: string; plan: { name: string; maxStaff: number }; _count: { customers: number; staff: number; memberships: number }; owner: { email: string; fullName: string } | null; openInvite: { email: string; status: string; expiresAt: string | null } | null };

export default function PlatformPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const stats = useApi<Stats>("/platform/stats");
  const tenants = useApi<TenantRow[]>(`/platform/tenants?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`);
  const allTenants = useApi<TenantRow[]>("/platform/tenants");
  const [detail, setDetail] = useState<string | null>(null);
  const [tab, setTab] = useState<"tenants" | "subscriptions" | "users" | "finance" | "company">("tenants");
  const [creating, setCreating] = useState(false);
  const jobs = useApi<{ id: string; runKey: string; status: string; startedAt: string; finishedAt: string | null; result: Record<string, unknown> | null; error: string | null }[]>("/platform/jobs");

  if (stats.error?.status === 403) {
    return <div className="mx-auto max-w-md p-10"><Alert>Bu sayfa yalnızca platform yöneticilerine açıktır.</Alert></div>;
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3"><Logo /><Badge tone="brand">SaaS yönetimi</Badge></div>
        <div className="flex gap-2">
          <Link href="/guvenlik" className="text-sm text-brand-700">Hesap güvenliği</Link>
          <Link href="/panel" className="text-sm text-brand-700">Salon paneli</Link>
          <button className="text-sm text-neutral-500" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/giris"; }}>Çıkış</button>
        </div>
      </header>
      {!stats.data ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="İşletme" value={stats.data.tenants.total} hint={Object.entries(stats.data.tenants.byStatus).map(([k, v]) => `${STATUS_TR[k]} ${v}`).join(" · ")} />
          <Stat label="MRR (aylık gelir)" value={tl(stats.data.mrr)} hint={`${stats.data.activeSubscriptions} ödemeli abonelik · ${stats.data.manualSubscriptions.total} manuel (${stats.data.manualSubscriptions.complimentary} ücretsiz) hariç`} />
          <Stat label="Yeni kayıt (30 gün)" value={stats.data.signupsLast30Days} />
          <Stat label="Randevu (30 gün)" value={stats.data.appointmentsLast30Days} />
          <Stat label="Paket dağılımı" value={Object.values(stats.data.byPlan).reduce((a, b) => a + b, 0)} hint={Object.entries(stats.data.byPlan).map(([k, v]) => `${k} ${v}`).join(" · ")} />
        </div>
      )}
      <div role="tablist" aria-label="Yönetim bölümleri" className="mt-6 inline-flex flex-wrap rounded-xl border border-sand-200 bg-white p-1 text-sm">
        {([["tenants", "İşletmeler ve paketler"], ["subscriptions", "Abonelikler"], ["users", "Kullanıcılar"], ["finance", "Finans"], ["company", "Şirket ayarları"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`rounded-lg px-4 py-1.5 ${tab === k ? "bg-brand-600 text-white" : "text-neutral-600 hover:bg-sand-100"}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "users" && <UsersCard tenants={allTenants.data ?? []} />}
      {tab === "subscriptions" && <SubscriptionsCard onOpenTenant={setDetail} />}
      {tab === "finance" && <div className="mt-6"><FinanceOverview tenants={allTenants.data ?? []} /></div>}
      {tab === "company" && <CompanySettingsCard />}
      {tab === "tenants" && (<>
      <Card className="mt-6">
        <CardHeader
          title="İşletmeler"
          action={
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Ara (ad, adres, e-posta)" aria-label="İşletme ara" className="h-9 w-52" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tüm durumlar</option>
                {["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{STATUS_TR[s]}</option>)}
              </Select>
              <Button size="sm" className="h-9" onClick={() => setCreating(true)}>Yeni işletme</Button>
            </div>
          }
        />
        <Table head={["İşletme", "Sahip", "Paket", "Durum", "Personel", "Müşteri", "Kayıt", ""]} empty="İşletme yok">
          {tenants.data?.map((t) => (
            <tr key={t.id}>
              <Td><div className="font-medium">{t.name}</div><div className="text-xs text-neutral-500">/{t.slug}</div></Td>
              <Td className="text-xs">{t.owner ? <>{t.owner.fullName}<div className="text-neutral-500">{t.owner.email}</div></> : t.openInvite ? <><div className="text-neutral-500">{t.openInvite.email}</div><InviteBadge status={t.openInvite.status} /></> : <span className="text-neutral-400">—</span>}</Td>
              <Td>{t.plan.name}</Td>
              <Td><Badge tone={statusTone(t.status)}>{STATUS_TR[t.status]}</Badge>{t.status === "TRIAL" && t.trialEndsAt && <div className="text-xs text-neutral-500">{dateTr(t.trialEndsAt, { day: "numeric", month: "short" })}</div>}</Td>
              <Td>{t._count.staff}/{t.plan.maxStaff}</Td>
              <Td>{t._count.customers}</Td>
              <Td>{dateTr(t.createdAt, { day: "numeric", month: "short", year: "numeric" })}</Td>
              <Td><Button size="sm" variant="ghost" onClick={() => setDetail(t.id)}>Yönet</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
      <PlansCard />
      <Card className="mt-6">
        <CardHeader
          title="Günlük abonelik görevi"
          description="Her gün 03:00'te deneme bitişi, yenileme, ödeme gecikmesi ve paket sınırlarını kontrol eder. Aynı gün ikinci kez çalışmaz."
          action={<Button size="sm" variant="outline" onClick={async () => {
            try {
              const r = await api<{ skipped: boolean; reason?: string }>("/platform/lifecycle/run", { method: "POST" });
              toast(r.skipped ? `Atlandı: ${r.reason}` : "Görev çalıştırıldı");
              jobs.reload(); tenants.reload(); stats.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>Şimdi çalıştır</Button>}
        />
        <Table head={["Gün", "Durum", "Başlangıç", "Sonuç"]} empty="Henüz çalışmadı">
          {jobs.data?.map((j) => (
            <tr key={j.id}>
              <Td>{j.runKey}</Td>
              <Td><Badge tone={j.status === "SUCCESS" ? "green" : j.status === "RUNNING" ? "blue" : "amber"}>{j.status}</Badge></Td>
              <Td>{dateTr(j.startedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
              <Td className="max-w-md truncate text-xs text-neutral-500">{j.error ?? (j.result ? Object.entries(j.result).filter(([k, v]) => k !== "errors" && v).map(([k, v]) => `${k}: ${v}`).join(", ") || "Değişiklik yok" : "—")}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      </>)}
      {creating && <NewTenantDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); tenants.reload(); stats.reload(); }} />}
      {detail && <TenantDetailDialog id={detail} onClose={() => setDetail(null)} onChanged={() => { tenants.reload(); stats.reload(); allTenants.reload(); }} />}
    </div>
  );
}
