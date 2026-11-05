"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, CalendarClock, CreditCard, Inbox, LogOut, Mail, Menu, Package, Receipt, Settings, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { InviteBadge, NewTenantDialog, TenantDetailDialog } from "@/components/platform/tenant-admin";
import { EmailCenter } from "@/components/platform/email-admin";
import { CompanySettingsCard, FinanceOverview } from "@/components/platform/finance-admin";
import { PlansCard, SubscriptionsCard } from "@/components/platform/plan-admin";
import { UsersCard } from "@/components/platform/user-admin";
import { NotificationsButton, TrialApplicationsCard, usePendingApplications } from "@/components/platform/trial-applications";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type Stats = { tenants: { total: number; byStatus: Record<string, number> }; byPlan: Record<string, number>; signupsLast30Days: number; appointmentsLast30Days: number; mrr: string; activeSubscriptions: number; manualSubscriptions: { total: number; complimentary: number } };
const TENANT_PAGE_SIZE = 100;

type Section = "tenants" | "applications" | "plans" | "subscriptions" | "users" | "finance" | "emails" | "company" | "jobs";
const GROUPS = ["Müşteriler", "Gelir", "Sistem"] as const;
/** Yan menü bölümleri. slug: adres çubuğundaki ?sekme= değeri (İşletmeler varsayılan bölümdür). */
const SECTIONS: { key: Section; slug: string; label: string; icon: LucideIcon; group: (typeof GROUPS)[number] }[] = [
  { key: "tenants", slug: "isletmeler", label: "İşletmeler", icon: Building2, group: "Müşteriler" },
  { key: "applications", slug: "basvurular", label: "Başvurular", icon: Inbox, group: "Müşteriler" },
  { key: "users", slug: "kullanicilar", label: "Kullanıcılar", icon: Users, group: "Müşteriler" },
  { key: "plans", slug: "paketler", label: "Paketler", icon: Package, group: "Gelir" },
  { key: "subscriptions", slug: "abonelikler", label: "Abonelikler", icon: CreditCard, group: "Gelir" },
  { key: "finance", slug: "finans", label: "Finans", icon: Receipt, group: "Gelir" },
  { key: "emails", slug: "e-postalar", label: "E-postalar", icon: Mail, group: "Sistem" },
  { key: "jobs", slug: "gorevler", label: "Günlük görev", icon: CalendarClock, group: "Sistem" },
  { key: "company", slug: "sirket", label: "Şirket ayarları", icon: Settings, group: "Sistem" },
];
type TenantRow = { id: string; name: string; slug: string; status: string; planCode: string; trialEndsAt: string | null; createdAt: string; plan: { name: string; maxStaff: number }; _count: { customers: number; staff: number; memberships: number }; owner: { email: string; fullName: string } | null; openInvite: { email: string; status: string; expiresAt: string | null } | null };

export default function PlatformPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const stats = useApi<Stats>("/platform/stats");
  const [page, setPage] = useState(1);
  const tenants = useApi<TenantRow[]>(`/platform/tenants?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}), page: String(page) })}`);
  const allTenants = useApi<TenantRow[]>("/platform/tenants?all=1");
  const [detail, setDetail] = useState<string | null>(null);
  // Bölüm adresi ?sekme=<slug> ile tutulur: bildirim e-postası (?sekme=basvurular) ve sayfa yenileme aynı bölümü açar.
  const [tab, setTabState] = useState<Section>("tenants");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("sekme");
    const found = SECTIONS.find((x) => x.slug === slug);
    if (found) setTabState(found.key);
  }, []);
  const setTab = (k: Section) => {
    setTabState(k);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    if (k === "tenants") url.searchParams.delete("sekme");
    else url.searchParams.set("sekme", SECTIONS.find((x) => x.key === k)!.slug);
    window.history.replaceState(null, "", url);
  };
  const pendingApps = usePendingApplications();
  const pendingCount = pendingApps.data?.counts.PENDING ?? 0;
  // Yeni başvurular sayfa açıkken de görünsün: dakikada bir ve sekmeye dönüldüğünde yenilenir.
  const reloadPending = pendingApps.reload;
  useEffect(() => {
    const t = setInterval(reloadPending, 60_000);
    const onFocus = () => reloadPending();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [reloadPending]);
  const [creating, setCreating] = useState(false);
  const jobs = useApi<{ id: string; runKey: string; status: string; startedAt: string; finishedAt: string | null; result: Record<string, unknown> | null; error: string | null }[]>("/platform/jobs");

  if (stats.error?.status === 403) {
    return <div className="mx-auto max-w-md p-10"><Alert>Bu sayfa yalnızca platform yöneticilerine açıktır.</Alert></div>;
  }
  const current = SECTIONS.find((x) => x.key === tab)!;
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/giris"; };
  return (
    <div className="min-h-screen bg-sand-50 lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Yan menü: masaüstünde sabit, telefonda menü düğmesiyle açılır */}
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside
        id="platform-menu"
        className={`${menuOpen ? "fixed inset-y-0 left-0 z-40 flex w-64 shadow-xl" : "hidden"} flex-col border-r border-sand-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-auto lg:shadow-none`}
      >
        <div className="flex items-center gap-2 border-b border-sand-100 px-4 py-4">
          <Logo />
        </div>
        <div className="px-4 pt-3"><Badge tone="brand">SaaS yönetimi</Badge></div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div role="tablist" aria-label="Yönetim bölümleri" aria-orientation="vertical" className="space-y-4">
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{g}</div>
                {SECTIONS.filter((x) => x.group === g).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${tab === key ? "bg-brand-50 font-medium text-brand-700" : "text-neutral-700 hover:bg-sand-100"}`}
                    onClick={() => setTab(key)}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {key === "applications" && pendingCount > 0 && <span data-testid="pending-applications" className="inline-flex min-w-5 justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingCount}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="space-y-1 border-t border-sand-100 px-2 py-3 text-sm">
          <Link href="/guvenlik" className="flex items-center gap-3 rounded-lg px-3 py-2 text-neutral-700 hover:bg-sand-100"><ShieldCheck className="size-4" aria-hidden />Hesap güvenliği</Link>
          <Link href="/panel" className="flex items-center gap-3 rounded-lg px-3 py-2 text-neutral-700 hover:bg-sand-100"><Store className="size-4" aria-hidden />Salon paneli</Link>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-neutral-500 hover:bg-sand-100" onClick={logout}><LogOut className="size-4" aria-hidden />Çıkış</button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-sand-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-8">
          <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg border border-sand-200 lg:hidden" aria-label="Menüyü aç" aria-controls="platform-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <Menu className="size-5" aria-hidden />
          </button>
          <h1 className="flex-1 truncate text-lg font-semibold">{current.label}</h1>
          <NotificationsButton pending={pendingApps.data?.items ?? []} count={pendingCount} onOpenAll={() => setTab("applications")} />
        </header>
        <main className="px-4 py-6 sm:px-8 [&>*:first-child]:mt-0">
      {tab === "tenants" && (!stats.data ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="İşletme" value={stats.data.tenants.total} hint={Object.entries(stats.data.tenants.byStatus).map(([k, v]) => `${STATUS_TR[k]} ${v}`).join(" · ")} />
          <Stat label="MRR (aylık gelir)" value={tl(stats.data.mrr)} hint={`${stats.data.activeSubscriptions} ödemeli abonelik · ${stats.data.manualSubscriptions.total} manuel (${stats.data.manualSubscriptions.complimentary} ücretsiz) hariç`} />
          <Stat label="Yeni kayıt (30 gün)" value={stats.data.signupsLast30Days} />
          <Stat label="Randevu (30 gün)" value={stats.data.appointmentsLast30Days} />
          <Stat label="Paket dağılımı" value={Object.values(stats.data.byPlan).reduce((a, b) => a + b, 0)} hint={Object.entries(stats.data.byPlan).map(([k, v]) => `${k} ${v}`).join(" · ")} />
        </div>
      ))}
      {tab === "applications" && <TrialApplicationsCard onOpenTenant={setDetail} onChanged={() => { pendingApps.reload(); tenants.reload(); stats.reload(); allTenants.reload(); }} />}
      {tab === "users" && <UsersCard tenants={allTenants.data ?? []} />}
      {tab === "subscriptions" && <SubscriptionsCard onOpenTenant={setDetail} />}
      {tab === "finance" && <div className="mt-6"><FinanceOverview tenants={allTenants.data ?? []} /></div>}
      {tab === "emails" && <EmailCenter tenants={allTenants.data ?? []} />}
      {tab === "company" && <CompanySettingsCard />}
      {tab === "tenants" && (<>
      <Card className="mt-6">
        <CardHeader
          title="İşletmeler"
          action={
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Ara (ad, adres, e-posta)" aria-label="İşletme ara" className="h-9 w-52" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              <Select className="h-9 w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
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
        {(page > 1 || (tenants.data?.length ?? 0) >= TENANT_PAGE_SIZE) && (
          <div className="flex items-center justify-end gap-2 border-t border-sand-100 px-4 py-3 text-sm" aria-label="İşletme sayfaları">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Önceki</Button>
            <span className="text-neutral-500">Sayfa {page}</span>
            <Button size="sm" variant="outline" disabled={(tenants.data?.length ?? 0) < TENANT_PAGE_SIZE} onClick={() => setPage(page + 1)}>Sonraki</Button>
          </div>
        )}
      </Card>
      </>)}
      {tab === "plans" && <PlansCard />}
      {tab === "jobs" && (<>
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
        </main>
      </div>
      {creating && <NewTenantDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); tenants.reload(); stats.reload(); }} />}
      {detail && <TenantDetailDialog id={detail} onClose={() => setDetail(null)} onChanged={() => { tenants.reload(); stats.reload(); allTenants.reload(); }} />}
    </div>
  );
}
