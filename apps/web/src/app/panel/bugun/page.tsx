"use client";

import { ChevronLeft, ChevronRight, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTr, isoDay, STATUS_TR, timeTr } from "@/lib/format";

type Item = {
  id: string; startsAt: string; endsAt: string; status: string; source: string; notes: string | null; customerPackageId: string | null;
  customer: { id: string; firstName: string; lastName: string; phone: string | null };
  staff: { id: string; displayName: string; color: string | null };
  service: { id: string; name: string };
  mine: boolean; canChangeStatus: boolean;
};
type Pending = { id: string; startsAt: string; createdAt: string; source: string; customer: { firstName: string; lastName: string }; staff: { displayName: string }; service: { name: string } };

/** Günlük çalışma planı (mobil öncelikli). Personel yalnız kendi randevularını görür ve yalnız onlarda işlem yapar. */
export default function TodayPage() {
  const { pwa, tenantId } = useSession();
  const toast = useToast();
  const [day, setDay] = useState(isoDay());
  const agenda = useApi<{ own: boolean; items: Item[] }>(pwa?.businessPwaEnabled ? `/pwa/agenda?date=${day}` : null, [tenantId]);
  const pending = useApi<Pending[]>(pwa?.businessPwaEnabled ? "/pwa/pending" : null, [tenantId]);
  const [busy, setBusy] = useState<string | null>(null);

  if (pwa && !pwa.businessPwaEnabled) {
    return <Empty title="İşletme mobil uygulaması bu işletmede açık değil">Takvim sayfasını kullanabilirsiniz.</Empty>;
  }

  async function setStatus(id: string, status: string) {
    if (status === "CANCELLED" && !window.confirm("Randevu iptal edilsin mi?")) return;
    setBusy(id);
    try {
      await api(`/appointments/${id}/status`, { method: "POST", body: { status }, tenant: tenantId });
      toast(STATUS_TR[status] ?? "Güncellendi");
      await Promise.all([agenda.reload(), pending.reload()]);
    } catch (e) {
      toast((e as Error).message, "red");
    } finally {
      setBusy(null);
    }
  }

  const items = agenda.data?.items ?? [];
  const active = items.filter((i) => !["CANCELLED"].includes(i.status));
  return (
    <>
      <PageHeader title={agenda.data?.own ? "Çalışma planım" : "Bugün"} description={dateTr(`${day}T12:00:00+03:00`, { weekday: "long", day: "numeric", month: "long" })} />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Önceki gün" onClick={() => setDay(addDays(day, -1))}><ChevronLeft /></Button>
        <Button variant="secondary" onClick={() => setDay(isoDay())} disabled={day === isoDay()}>Bugün</Button>
        <Button variant="secondary" size="icon" aria-label="Sonraki gün" onClick={() => setDay(addDays(day, 1))}><ChevronRight /></Button>
        <span className="ml-auto text-sm text-neutral-500">{active.length} randevu</span>
      </div>

      {!!pending.data?.length && (
        <Card className="mb-4 p-4">
          <h2 className="font-semibold">Onay bekleyen yeni randevular</h2>
          <ul className="mt-3 divide-y divide-sand-100">
            {pending.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{p.customer.firstName} {p.customer.lastName} {p.source === "ONLINE" && <Badge tone="brand">Online</Badge>}</div>
                  <div className="text-neutral-500">{dateTr(p.startsAt, { day: "numeric", month: "short", weekday: "short" })} {timeTr(p.startsAt)} · {p.service.name} · {p.staff.displayName}</div>
                </div>
                <Button size="sm" onClick={() => void setStatus(p.id, "CONFIRMED")} disabled={busy === p.id}>Onayla</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {agenda.error && <Alert>{agenda.error.message}</Alert>}
      {agenda.loading && !agenda.data ? <Spinner /> : items.length === 0 ? (
        <Empty title="Bu gün için randevu yok" />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-14 shrink-0 text-center">
                    <div className="text-lg font-semibold">{timeTr(a.startsAt)}</div>
                    <div className="text-xs text-neutral-500">{timeTr(a.endsAt)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/panel/musteriler/${a.customer.id}`} className="font-medium hover:underline">{a.customer.firstName} {a.customer.lastName}</Link>
                      <Badge tone={statusTone(a.status)}>{STATUS_TR[a.status] ?? a.status}</Badge>
                      {a.customerPackageId && <Badge tone="brand">Paket</Badge>}
                    </div>
                    <div className="text-sm text-neutral-600">{a.service.name}{!agenda.data?.own && <> · {a.staff.displayName}</>}</div>
                    {a.customer.phone && <a href={`tel:${a.customer.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700"><Phone className="size-3.5" />{a.customer.phone}</a>}
                    {a.notes && <p className="mt-1 whitespace-pre-line text-xs text-neutral-500">{a.notes}</p>}
                  </div>
                </div>
                {a.canChangeStatus && ["BOOKED", "CONFIRMED"].includes(a.status) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.status === "BOOKED" && <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void setStatus(a.id, "CONFIRMED")}>Onayla</Button>}
                    <Button size="sm" disabled={busy === a.id} onClick={() => void setStatus(a.id, "COMPLETED")}>Tamamlandı</Button>
                    <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void setStatus(a.id, "NO_SHOW")}>Gelmedi</Button>
                    <Button size="sm" variant="ghost" className="text-red-700" disabled={busy === a.id} onClick={() => void setStatus(a.id, "CANCELLED")}>İptal</Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {!agenda.data?.own && <p className="mt-6 text-center text-sm"><Link href="/panel/takvim" className="text-brand-700 underline">Haftalık ve personel takvimi</Link></p>}
    </>
  );
}
