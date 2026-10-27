"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, Input, PageHeader, Spinner, Stat, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/api";
import { addDays, dateTr, isoDay, istanbulToIso, tl } from "@/lib/format";

type Dash = {
  appointments: { total: number; completionRate: number; noShowRate: number; byStatus: Record<string, number> };
  finance: { income: string; expense: string; refund: string; net: string; serviceValue: string };
  customers: { new: number; total: number };
  topServices: { id: string; name: string; count: number; revenue: string }[];
  staffPerformance: { id: string; name: string; count: number; revenue: string }[];
  stock: { stockValue: string };
};
type Daily = { day: string; income: string; outflow: string; net: string };

export default function ReportsPage() {
  const [fromDay, setFromDay] = useState(addDays(isoDay(), -29));
  const [toDay, setToDay] = useState(isoDay());
  const range = `from=${encodeURIComponent(istanbulToIso(fromDay, "00:00"))}&to=${encodeURIComponent(istanbulToIso(addDays(toDay, 1), "00:00"))}`;
  const dash = useApi<Dash>(`/reports/dashboard?${range}`);
  const daily = useApi<Daily[]>(`/reports/daily-revenue?${range}`);
  const max = Math.max(1, ...(daily.data ?? []).map((d) => Number(d.income)));

  return (
    <>
      <PageHeader title="Raporlar" action={<><Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className="w-40" aria-label="Başlangıç" /><Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className="w-40" aria-label="Bitiş" /></>} />
      {!dash.data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Net kasa" value={tl(dash.data.finance.net)} hint={`Gelir ${tl(dash.data.finance.income)}`} />
            <Stat label="Hizmet değeri" value={tl(dash.data.finance.serviceValue)} hint="Tamamlanan randevular" />
            <Stat label="Randevu" value={dash.data.appointments.total} hint={`Tamamlanma %${dash.data.appointments.completionRate} · Gelmeme %${dash.data.appointments.noShowRate}`} />
            <Stat label="Yeni müşteri" value={dash.data.customers.new} hint={`Toplam ${dash.data.customers.total}`} />
          </div>
          <Card className="mt-6">
            <CardHeader title="Günlük gelir" description="Gelir (koyu) ve gider+iade (açık)" />
            <CardBody>
              {daily.data?.length ? (
                <div className="flex h-56 items-end gap-1 overflow-x-auto" role="img" aria-label="Günlük gelir grafiği">
                  {daily.data.map((d) => (
                    <div key={d.day} className="group flex min-w-6 flex-1 flex-col items-center justify-end gap-0.5" title={`${d.day}: gelir ${tl(d.income)}, çıkış ${tl(d.outflow)}`}>
                      <div className="w-full rounded-t bg-brand-500" style={{ height: `${(Number(d.income) / max) * 180}px` }} />
                      <div className="w-full rounded-b bg-brand-200" style={{ height: `${(Number(d.outflow) / max) * 180}px` }} />
                      <span className="mt-1 text-[10px] text-neutral-500">{dateTr(`${d.day}T12:00:00+03:00`, { day: "numeric", month: "numeric" })}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-neutral-500">Bu aralıkta kasa hareketi yok.</p>}
            </CardBody>
          </Card>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Hizmetler" />
              <Table head={["Hizmet", "Adet", "Ciro"]} empty="Veri yok">
                {dash.data.topServices.map((s) => <tr key={s.id}><Td>{s.name}</Td><Td>{s.count}</Td><Td>{tl(s.revenue)}</Td></tr>)}
              </Table>
            </Card>
            <Card>
              <CardHeader title="Personel performansı" />
              <Table head={["Personel", "Randevu", "Ciro"]} empty="Veri yok">
                {dash.data.staffPerformance.map((s) => <tr key={s.id}><Td>{s.name}</Td><Td>{s.count}</Td><Td>{tl(s.revenue)}</Td></tr>)}
              </Table>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
