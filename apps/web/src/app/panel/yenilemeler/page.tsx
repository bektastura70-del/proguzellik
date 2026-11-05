"use client";

import { CalendarPlus, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Card, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button-variants";
import { useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";

type Row = {
  customer: { id: string; name: string; phone: string | null; email: string | null };
  service: { id: string; name: string; rebookAfterDays: number };
  lastDoneAt: string;
  dueDay: string;
  remindDay: string | null;
  daysLeft: number;
  upcoming: { id: string; startsAt: string } | null;
  reminder: string;
};
type Res = { enabled: boolean; today: string; items: Row[] };

/** Hatırlatma durumu: rozet rengi ve açıklama */
const REMINDER: Record<string, [string, "green" | "blue" | "amber" | "neutral" | "red" | "brand"]> = {
  SENT: ["Hatırlatma gönderildi", "green"],
  SCHEDULED: ["Bugün gönderilecek", "blue"],
  WAITING: ["Hatırlatma günü bekleniyor", "neutral"],
  PENDING: ["Gönderilecek", "brand"],
  BOOKED: ["Randevusu var", "green"],
  OVERDUE: ["Süre doldu, arayın", "amber"],
  NO_CONSENT: ["İleti izni yok, arayın", "amber"],
  OPTED_OUT: ["Hatırlatma istemiyor", "neutral"],
  NOT_CONFIGURED: ["Hizmette hatırlatma günü yok", "neutral"],
  SKIPPED: ["Gönderilmedi", "neutral"],
  ANONYMIZED: ["Anonim", "neutral"],
};
const day = (d: string) => dateTr(`${d}T12:00:00Z`, { day: "numeric", month: "long" });

export default function RenewalsPage() {
  const [days, setDays] = useState("30");
  const list = useApi<Res>(`/renewals?days=${days}`, [days]);

  if (list.error?.status === 404) return <><PageHeader title="Yaklaşan yenilemeler" /><Alert tone="amber">Bu özellik henüz kullanıma açılmadı.</Alert></>;

  return (
    <>
      <PageHeader
        title="Yaklaşan yenilemeler"
        description="Tekrar süresi tanımlı hizmetlerde yenileme zamanı yaklaşan (ve son 30 günde geçen) müşteriler."
        action={
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Dönem" className="w-52">
            <option value="7">Önümüzdeki 7 gün</option>
            <option value="14">Önümüzdeki 14 gün</option>
            <option value="30">Önümüzdeki 30 gün</option>
            <option value="60">Önümüzdeki 60 gün</option>
          </Select>
        }
      />
      {list.data && !list.data.enabled && (
        <div className="mb-4"><Alert tone="brand">Otomatik hatırlatma kapalı; liste yine de görünür. Açmak için <Link href="/panel/ayarlar" className="underline">Ayarlar</Link> sayfasını kullanın.</Alert></div>
      )}
      <Card>
        {list.loading && !list.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Müşteri", "Hizmet", "Son işlem", "Yenileme", "Hatırlatma", ""]} empty="Bu dönemde yenilemesi yaklaşan müşteri yok. Hizmetler sayfasında tekrar süresi tanımlayın.">
            {list.data?.items.map((r) => {
              const [label, tone] = REMINDER[r.reminder] ?? [r.reminder, "neutral"];
              const book = new URLSearchParams({ yeni: "1", musteri: r.customer.id, hizmet: r.service.id });
              return (
                <tr key={`${r.customer.id}-${r.service.id}`}>
                  <Td>
                    <Link href={`/panel/musteriler/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link>
                    {r.customer.phone && <div className="text-xs text-neutral-500">{r.customer.phone}</div>}
                  </Td>
                  <Td>{r.service.name}<div className="text-xs text-neutral-500">her {r.service.rebookAfterDays} gün</div></Td>
                  <Td>{dateTr(r.lastDoneAt, { day: "numeric", month: "long" })}</Td>
                  <Td>
                    {day(r.dueDay)}
                    <div className={r.daysLeft < 0 ? "text-xs text-amber-700" : "text-xs text-neutral-500"}>
                      {r.daysLeft > 0 ? `${r.daysLeft} gün kaldı` : r.daysLeft === 0 ? "bugün" : `${-r.daysLeft} gün geçti`}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={tone}>{label}</Badge>
                    {r.upcoming && <div className="text-xs text-neutral-500">{dateTr(r.upcoming.startsAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
                    {!r.upcoming && r.remindDay && r.reminder === "WAITING" && <div className="text-xs text-neutral-500">{day(r.remindDay)}</div>}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {r.customer.phone && (
                        <a href={`tel:${r.customer.phone}`} className={buttonVariants({ variant: "secondary", size: "sm" })} aria-label={`${r.customer.name} ara`}><Phone className="size-4" /> Ara</a>
                      )}
                      {!r.upcoming && (
                        <Link href={`/panel/takvim?${book}`} className={buttonVariants({ size: "sm" })}><CalendarPlus className="size-4" /> Randevu</Link>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
