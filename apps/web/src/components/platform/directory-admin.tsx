"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";

type Row = {
  tenant: { id: string; name: string; slug: string; status: string };
  enabled: boolean; provinceName: string | null; districtName: string | null; showAddress: boolean; showPhone: boolean;
  blocked: boolean; blockedReason: string | null; updatedAt: string;
};

/** SaaS sahibi: uygulamadaki salon rehberi. İşletmeler kendileri açar; kötüye kullanımda buradan çıkarılır (işletme yeniden açamaz). */
export function DirectoryCard() {
  const toast = useToast();
  const q = useApi<{ listings: Row[] }>("/platform/directory");
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act() {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      q.setData(await api<{ listings: Row[] }>(`/platform/directory/${target.tenant.id}/${target.blocked ? "unblock" : "block"}`, { method: "POST", body: { reason } }));
      toast(target.blocked ? "Salon rehbere geri alındı" : "Salon rehberden çıkarıldı");
      setTarget(null);
      setReason("");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader title="Salon rehberi" description="Mobil uygulamada şehir/ilçe ile listelenmeyi açan salonlar. Askıdaki, aboneliği biten ya da online randevusu kapalı salonlar listede olsa da rehberde görünmez." />
      {q.loading && !q.data ? <div className="p-6"><Spinner /></div> : q.error ? <div className="p-4"><Alert>{q.error.message}</Alert></div> : (
        <Table head={["Salon", "Konum", "Görünen", "Durum", "Güncelleme", ""]} empty="Rehberde listelenen salon yok">
          {q.data!.listings.map((r) => (
            <tr key={r.tenant.id}>
              <Td><div className="font-medium">{r.tenant.name}</div><div className="text-xs text-neutral-500">/r/{r.tenant.slug}</div></Td>
              <Td>{r.provinceName ?? "-"} / {r.districtName ?? "-"}</Td>
              <Td className="text-xs">Ad, logo{r.showAddress ? ", adres" : ""}{r.showPhone ? ", telefon" : ""}</Td>
              <Td>{r.blocked ? <Badge tone="red" title={r.blockedReason ?? undefined}>Çıkarıldı</Badge> : r.enabled ? <Badge tone="green">Açık</Badge> : <Badge>Kapalı</Badge>}</Td>
              <Td className="text-xs">{dateTr(r.updatedAt)}</Td>
              <Td><Button size="sm" variant={r.blocked ? "secondary" : "ghost"} onClick={() => { setTarget(r); setReason(""); setErr(null); }}>{r.blocked ? "Geri al" : "Rehberden çıkar"}</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={!!target} onClose={() => setTarget(null)} title={target?.blocked ? "Rehbere geri al" : "Rehberden çıkar"}>
        <div className="space-y-3 text-sm">
          <p>{target?.blocked ? "Salon, kendi ayarı açıksa yeniden rehberde görünür." : "Salon rehberde görünmez ve işletme listelemeyi kendisi yeniden açamaz. Neden işletmeye panelde gösterilir."}</p>
          {err && <Alert>{err}</Alert>}
          <Field label="Neden"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>Vazgeç</Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={act}>{busy ? "İşleniyor…" : "Onayla"}</Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
