"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/panel/session";
import type { Txn } from "@/components/panel/types";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Stat, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTimeTr, isoDay, istanbulToIso, METHOD_TR, TYPE_TR, tl } from "@/lib/format";

type Summary = { income: string; expense: string; refund: string; net: string; byMethod: Record<string, string> };
type Commission = { staffId: string; staffName: string; rate: string; appointments: number; revenue: string; serviceEarned?: string; productRate?: string; productSales?: number; productRevenue?: string; productEarned?: string; earned: string; paid: string; due: string };

export default function CashPage() {
  const { can } = useSession();
  const toast = useToast();
  const [fromDay, setFromDay] = useState(isoDay());
  const [toDay, setToDay] = useState(isoDay());
  const range = `from=${encodeURIComponent(istanbulToIso(fromDay, "00:00"))}&to=${encodeURIComponent(istanbulToIso(addDays(toDay, 1), "00:00"))}`;
  const txns = useApi<Txn[]>(`/finance/transactions?${range}`);
  const sum = useApi<Summary>(`/finance/summary?${range}`);
  const comm = useApi<Commission[]>(can("OWNER", "MANAGER") ? `/finance/commissions?${range}` : null);
  const [record, setRecord] = useState<"INCOME" | "EXPENSE" | null>(null);
  const [refund, setRefund] = useState<Txn | null>(null);
  const [payout, setPayout] = useState<Commission | null>(null);
  const reload = () => { txns.reload(); sum.reload(); comm.reload(); };

  return (
    <>
      <PageHeader
        title="Kasa"
        description="Tahsilat, gelir-gider, iade ve personel primleri"
        action={
          <>
            <div className="inline-flex rounded-xl border border-sand-300 bg-white p-1 text-sm">
              {[["Bugün", 0], ["7 gün", 6], ["30 gün", 29]].map(([l, n]) => (
                <button key={l} onClick={() => { setFromDay(addDays(isoDay(), -Number(n))); setToDay(isoDay()); }} className="rounded-lg px-2.5 py-1 hover:bg-sand-100">{l}</button>
              ))}
            </div>
            <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className="w-40" aria-label="Başlangıç" />
            <Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className="w-40" aria-label="Bitiş" />
            {can("OWNER", "MANAGER") && <Button variant="outline" onClick={() => setRecord("EXPENSE")}>Gider ekle</Button>}
            {can("OWNER", "MANAGER") && <Button onClick={() => setRecord("INCOME")}>Gelir ekle</Button>}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gelir" value={sum.data ? tl(sum.data.income) : "—"} />
        <Stat label="Gider" value={sum.data ? tl(sum.data.expense) : "—"} />
        <Stat label="İade" value={sum.data ? tl(sum.data.refund) : "—"} />
        <Stat label="Net" value={sum.data ? tl(sum.data.net) : "—"} hint={sum.data ? Object.entries(sum.data.byMethod).map(([k, v]) => `${METHOD_TR[k]}: ${tl(v)}`).join(" · ") : undefined} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Hareketler" action={txns.data && txns.data.length > 0 ? <Button size="sm" variant="outline" onClick={() => exportCsv(txns.data!, fromDay, toDay)}>CSV indir</Button> : undefined} />
        <Table head={["Tarih", "Tür", "Kategori", "Müşteri/Personel", "Yöntem", "Tutar", ""]} empty="Bu aralıkta hareket yok">
          {txns.data?.map((t) => (
            <tr key={t.id}>
              <Td className="whitespace-nowrap">{dateTimeTr(t.occurredAt)}</Td>
              <Td><Badge tone={t.type === "INCOME" ? "green" : t.type === "REFUND" ? "amber" : "red"}>{TYPE_TR[t.type]}</Badge></Td>
              <Td>{t.category}<div className="text-xs text-neutral-500">{t.description}</div></Td>
              <Td>{t.customer ? `${t.customer.firstName} ${t.customer.lastName}` : t.staff?.displayName ?? "—"}</Td>
              <Td>{METHOD_TR[t.method]}</Td>
              <Td className={`whitespace-nowrap font-medium ${t.type === "INCOME" ? "" : "text-red-600"}`}>{t.type === "INCOME" ? "" : "−"}{tl(t.amount)}</Td>
              <Td className="whitespace-nowrap text-right">
                {t.type === "INCOME" && Number(t.refundedAmount ?? 0) > 0 && <span className="mr-2 text-xs text-amber-700">{tl(t.refundedAmount!)} iade</span>}
                {t.type === "INCOME" && can("OWNER", "MANAGER") && Number(t.refundable ?? t.amount) > 0 && (t.productSale
                  ? <Link href="/panel/stok/satislar"><Button size="sm" variant="ghost" title="Ürün iadesi stokla birlikte Ürün satışları ekranından yapılır">İade</Button></Link>
                  : <Button size="sm" variant="ghost" onClick={() => setRefund(t)}>İade</Button>)}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {comm.data && (
        <Card className="mt-6">
          <CardHeader title="Personel primleri" description="Hizmet primi tamamlanan randevulardan (paket seansı = paket fiyatı / seans sayısı), ürün primi personelin ürün satışlarından (iadeler düşülerek) hesaplanır." />
          <Table head={["Personel", "Hizmet %", "Randevu", "Hizmet cirosu", "Ürün %", "Ürün cirosu", "Hak edilen", "Ödenen", "Kalan", ""]} empty="Personel yok">
            {comm.data.map((c) => (
              <tr key={c.staffId}>
                <Td className="font-medium">{c.staffName}</Td><Td>%{Number(c.rate)}</Td><Td>{c.appointments}</Td><Td>{tl(c.revenue)}</Td>
                <Td>%{Number(c.productRate ?? 0)}</Td><Td>{tl(c.productRevenue ?? 0)}</Td>
                <Td>{tl(c.earned)}</Td><Td>{tl(c.paid)}</Td><Td className="font-medium">{tl(c.due)}</Td>
                <Td className="text-right">{Number(c.due) > 0 && <Button size="sm" variant="outline" onClick={() => setPayout(c)}>Öde</Button>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {record && (
        <Dialog open onClose={() => setRecord(null)} title={record === "INCOME" ? "Gelir ekle" : "Gider ekle"}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api("/finance/transactions", { method: "POST", body: { type: record, category: f.get("category"), amount: Number(f.get("amount")), method: f.get("method"), description: f.get("description") || undefined } });
              toast("Kaydedildi"); setRecord(null); reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Kategori"><Input name="category" required placeholder={record === "EXPENSE" ? "Kira, malzeme, fatura…" : "Diğer gelir"} list="cats" /></Field>
            <datalist id="cats"><option value="KIRA" /><option value="MALZEME" /><option value="FATURA" /><option value="MAAS" /><option value="REKLAM" /></datalist>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tutar (₺)"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
              <Field label="Yöntem"><Select name="method">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Field label="Açıklama"><Input name="description" /></Field>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
      {refund && (
        <Dialog open onClose={() => setRefund(null)} title="İade">
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api(`/finance/transactions/${refund.id}/refund`, { method: "POST", body: { amount: Number(f.get("amount")), reason: f.get("reason") } });
              toast("İade kaydedildi"); setRefund(null); reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Alert tone="amber">Mali kayıtlar silinemez; iade ayrı bir hareket olarak kaydedilir.</Alert>
            <Field label="İade tutarı (₺)" hint={`Orijinal: ${tl(refund.amount)} · İade edilebilir: ${tl(refund.refundable ?? refund.amount)}`}><Input name="amount" type="number" step="0.01" min="0.01" max={Number(refund.refundable ?? refund.amount)} required defaultValue={Number(refund.refundable ?? refund.amount)} /></Field>
            <Field label="Sebep"><Input name="reason" required minLength={3} /></Field>
            <Button variant="danger" className="w-full">İade et</Button>
          </form>
        </Dialog>
      )}
      {payout && (
        <Dialog open onClose={() => setPayout(null)} title={`Prim ödemesi: ${payout.staffName}`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api("/finance/transactions", { method: "POST", body: { type: "EXPENSE", category: "PRIM", amount: Number(f.get("amount")), method: f.get("method"), staffId: payout.staffId, description: "Personel prim ödemesi" } });
              toast("Prim ödemesi kaydedildi"); setPayout(null); reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tutar (₺)"><Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={Number(payout.due)} /></Field>
              <Field label="Yöntem"><Select name="method" defaultValue="TRANSFER">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Button className="w-full">Ödemeyi kaydet</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function exportCsv(rows: Txn[], from: string, to: string) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Tarih", "Tür", "Kategori", "Müşteri", "Personel", "Yöntem", "Tutar", "Açıklama"].map(esc).join(";"),
    ...rows.map((t) =>
      [dateTimeTr(t.occurredAt), TYPE_TR[t.type], t.category, t.customer ? `${t.customer.firstName} ${t.customer.lastName}` : "", t.staff?.displayName ?? "", METHOD_TR[t.method], (t.type === "INCOME" ? "" : "-") + Number(t.amount).toFixed(2).replace(".", ","), t.description ?? ""].map(esc).join(";"),
    ),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kasa-${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
