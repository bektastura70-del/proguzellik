"use client";

import Link from "next/link";
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, statusTone } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTimeTr, STATUS_TR } from "@/lib/format";

type N = { id: string; recipient: string; template: string; status: string; scheduledFor: string; sentAt: string | null; error: string | null };
const TEMPLATE_TR: Record<string, string> = { randevu_onay: "Randevu onayı", randevu_hatirlatma: "Hatırlatma (24 saat önce)", randevu_iptal: "İptal bildirimi", paket_hatirlatma: "Paket bitiş hatırlatması", tekrar_randevu: "Tekrar randevu zamanı", kampanya_duyuru: "Kampanya (ticari ileti)" };

export default function NotificationsPage() {
  const list = useApi<N[]>("/notifications");
  return (
    <>
      <PageHeader title="WhatsApp bildirimleri" description="Randevu onayı, hatırlatma ve iptal mesajları otomatik planlanır." />
      <div className="mb-4"><Alert tone="brand">Mesajlar, <Link href="/panel/kanallar" className="underline">WhatsApp &amp; Instagram</Link> sayfasından bağlayıp doğruladığınız kendi WhatsApp numaranızdan gönderilir. Bağlantı yoksa veya test modundaysa mesajlar <b>gönderilmez</b>, yalnızca kaydedilir.</Alert></div>
      <Card>
        {list.loading ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Planlanan", "Alıcı", "Şablon", "Durum", "Gönderim"]} empty="Henüz bildirim yok">
            {list.data?.map((n) => (
              <tr key={n.id}>
                <Td>{dateTimeTr(n.scheduledFor)}</Td><Td>{n.recipient}</Td><Td>{TEMPLATE_TR[n.template] ?? n.template}</Td>
                <Td><Badge tone={statusTone(n.status)}>{STATUS_TR[n.status] ?? n.status}</Badge>{n.error && <div className="text-xs text-red-600">{n.error}</div>}</Td>
                <Td>{n.sentAt ? dateTimeTr(n.sentAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
