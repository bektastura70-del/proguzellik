"use client";

import { AlertTriangle, CalendarDays, CalendarPlus, Coins, Copy, PackagePlus, UserPlus, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/panel/session";
import type { Appointment, Onboarding } from "@/components/panel/types";
import { Badge, Button, Card, CardBody, CardHeader, Empty, PageHeader, Spinner, Stat, statusTone, useToast } from "@/components/ui";
import { buttonVariants } from "@/components/ui";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { addDays, dateTr, isoDay, istanbulToIso, STATUS_TR, timeTr, tl } from "@/lib/format";

type Dashboard = {
  appointments: { total: number; completionRate: number; noShowRate: number };
  finance: { income: string; net: string; serviceValue: string };
  customers: { new: number; total: number };
  topServices: { id: string; name: string; count: number; revenue: string }[];
  staffPerformance: { id: string; name: string; count: number; revenue: string }[];
  stock: { lowStock: { id: string; name: string; stockQty: string; unit: string }[] };
};

export default function Overview() {
  const { me, current, can, has } = useSession();
  const today = isoDay();
  const from = istanbulToIso(today, "00:00");
  const to = istanbulToIso(addDays(today, 1), "00:00");
  const appts = useApi<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const monthFrom = istanbulToIso(addDays(today, -29), "00:00");
  const dash = useApi<Dashboard>(can("OWNER", "MANAGER") && has("REPORTS") ? `/reports/dashboard?from=${encodeURIComponent(monthFrom)}&to=${encodeURIComponent(to)}` : null);

  const toast = useToast();
  const router = useRouter();
  const onb = useApi<Onboarding>(can("OWNER", "MANAGER") ? "/onboarding" : null);
  // Hiç kurulum yapılmamış salonda sahibi oturum başına bir kez sihirbaza yönlendirilir.
  useEffect(() => {
    if (!onb.data || !can("OWNER") || onb.data.dismissed || onb.data.done > 0) return;
    try {
      if (sessionStorage.getItem("pg_onb_redirected")) return;
      sessionStorage.setItem("pg_onb_redirected", "1");
    } catch { /* depolama kapalı: yine de yönlendir */ }
    router.replace("/panel/baslangic");
  }, [onb.data, can, router]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const active = appts.data?.filter((a) => !["CANCELLED"].includes(a.status)) ?? [];
  return (
    <>
      <PageHeader
        title={`Merhaba ${me?.fullName.split(" ")[0] ?? ""}`}
        description={dateTr(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        action={<Link href="/panel/takvim" className={buttonVariants()}>Randevu ekle</Link>}
      />
      {onb.data && !onb.data.complete && !onb.data.dismissed && (
        <Card className="mb-6 border-brand-200 bg-brand-50/40" data-testid="kurulum-karti">
          <CardBody className="flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <p className="font-medium">Salon kurulumu: {onb.data.done} / {onb.data.total} adım tamam</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand-200"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(onb.data.done / onb.data.total) * 100}%` }} /></div>
              <p className="mt-1 text-xs text-neutral-500">Online randevu için hizmet, personel ve çalışma saatlerini tamamlayın.</p>
            </div>
            <Link href="/panel/baslangic" className={buttonVariants()}>Kuruluma devam et</Link>
            {can("OWNER") && (
              <Button variant="outline" onClick={async () => {
                try { await api("/onboarding", { method: "PATCH", body: { dismissed: true } }); void onb.reload(); } catch (e) { toast((e as Error).message, "red"); }
              }}>Gizle</Button>
            )}
          </CardBody>
        </Card>
      )}
      {can("OWNER", "MANAGER", "RECEPTION") && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: "/panel/takvim", label: "Randevu oluştur", icon: CalendarPlus },
            { href: "/panel/musteriler", label: "Müşteri ekle", icon: UserPlus },
            { href: "/panel/paketler", label: "Paket sat", icon: PackagePlus },
            { href: "/panel/kasa", label: "Kasayı aç", icon: Wallet },
          ].map((q) => (
            <Link key={q.href} href={q.href} className="group flex items-center gap-3 rounded-2xl border border-sand-200 bg-gradient-to-br from-white to-brand-50/60 px-4 py-3 text-sm font-medium transition hover:border-brand-300 hover:shadow-sm">
              <span className="grid size-9 place-items-center rounded-xl bg-brand-100 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white"><q.icon className="size-[18px]" /></span>
              {q.label}
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bugünkü randevular" value={appts.data ? active.length : "—"} icon={<CalendarDays className="size-5" />} />
        <Stat label="30 gün net kasa" value={dash.data ? tl(dash.data.finance.net) : "—"} icon={<Coins className="size-5" />} />
        <Stat label="Toplam müşteri" value={dash.data?.customers.total ?? "—"} hint={dash.data ? `${dash.data.customers.new} yeni (30 gün)` : undefined} icon={<Users className="size-5" />} />
        <Stat label="Gelmeme oranı" value={dash.data ? `%${dash.data.appointments.noShowRate}` : "—"} hint={dash.data ? `Tamamlanma %${dash.data.appointments.completionRate}` : undefined} icon={<AlertTriangle className="size-5" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bugünün programı" action={<Link className="text-sm text-brand-700" href="/panel/takvim">Takvime git →</Link>} />
          <CardBody className="p-0">
            {appts.loading ? <div className="p-6"><Spinner /></div> : active.length === 0 ? (
              <div className="p-5"><Empty title="Bugün randevu yok">Takvimden yeni randevu ekleyebilirsiniz.</Empty></div>
            ) : (
              <ul className="divide-y divide-sand-100">
                {active.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-14 text-sm font-semibold">{timeTr(a.startsAt)}</div>
                    <div className="h-9 w-1 rounded-full" style={{ background: a.staff.color ?? "#c97399" }} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/panel/musteriler/${a.customer.id}`} className="font-medium hover:underline">{a.customer.firstName} {a.customer.lastName}</Link>
                      <div className="truncate text-sm text-neutral-500">{a.service.name} · {a.staff.displayName}</div>
                    </div>
                    <Badge tone={statusTone(a.status)}>{STATUS_TR[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          {dash.data && (
            <Card>
              <CardHeader title="En çok tercih edilenler" description="Son 30 gün" />
              <CardBody className="space-y-3">
                {dash.data.topServices.length === 0 && <p className="text-sm text-neutral-500">Henüz tamamlanan randevu yok.</p>}
                {dash.data.topServices.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.name}</span>
                    <span className="text-neutral-500">{s.count} · {tl(s.revenue)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          {dash.data && dash.data.stock.lowStock.length > 0 && (
            <Card>
              <CardHeader title="Kritik stok" />
              <CardBody className="space-y-2 text-sm">
                {dash.data.stock.lowStock.map((p) => (
                  <div key={p.id} className="flex justify-between"><span>{p.name}</span><span className="text-red-600">{Number(p.stockQty)} {p.unit}</span></div>
                ))}
              </CardBody>
            </Card>
          )}
          {current && can("OWNER", "MANAGER") && (
            <Card>
              <CardHeader title="Online randevu bağlantınız" />
              <CardBody>
                <code className="block break-all rounded-lg bg-sand-100 px-3 py-2 text-xs">{origin}/r/{current.tenant.slug}</code>
                <Button size="sm" variant="outline" className="mt-3" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${origin}/r/${current.tenant.slug}`);
                    toast("Bağlantı kopyalandı");
                  } catch {
                    toast("Kopyalanamadı; bağlantıyı elle seçin", "red");
                  }
                }}><Copy /> Kopyala</Button>
                <p className="mt-2 text-xs text-neutral-500">Instagram profilinize ve WhatsApp durumunuza ekleyin.</p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
