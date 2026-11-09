"use client";

import { ArrowLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SaleDialog } from "@/components/panel/sale-dialog";
import { useSession } from "@/components/panel/session";
import type { ProductSale } from "@/components/panel/types";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTimeTr, isoDay, istanbulToIso, METHOD_TR, tl } from "@/lib/format";

type Report = {
  saleCount: number; revenue: string; vat: string; netRevenue: string; cost: string; profit: string;
  products: { productId: string; name: string; unit: string; soldQty: string; returnedQty: string; revenue: string; vat: string; netRevenue: string; cost: string; profit: string; costKnown: boolean; vatKnown: boolean }[];
};

export default function ProductSalesPage() {
  const { can } = useSession();
  const manager = can("OWNER", "MANAGER");
  const [fromDay, setFromDay] = useState(addDays(isoDay(), -29));
  const [toDay, setToDay] = useState(isoDay());
  const range = `from=${encodeURIComponent(istanbulToIso(fromDay, "00:00"))}&to=${encodeURIComponent(istanbulToIso(addDays(toDay, 1), "00:00"))}`;
  const sales = useApi<ProductSale[]>(`/product-sales?${range}`);
  const report = useApi<Report>(manager ? `/product-sales/report?${range}` : null);
  const [selling, setSelling] = useState(false);
  const [returning, setReturning] = useState<ProductSale | null>(null);
  const reload = () => { sales.reload(); report.reload(); };

  return (
    <>
      <PageHeader
        title="Ürün satışları"
        description="Satış fişleri, iadeler ve ürün bazında ciro"
        action={
          <>
            <Link href="/panel/stok"><Button variant="ghost"><ArrowLeft /> Stok</Button></Link>
            <div className="inline-flex rounded-xl border border-sand-300 bg-white p-1 text-sm">
              {[["Bugün", 0], ["7 gün", 6], ["30 gün", 29]].map(([l, n]) => (
                <button key={l} onClick={() => { setFromDay(addDays(isoDay(), -Number(n))); setToDay(isoDay()); }} className="rounded-lg px-2.5 py-1 hover:bg-sand-100">{l}</button>
              ))}
            </div>
            <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} className="w-40" aria-label="Başlangıç" />
            <Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className="w-40" aria-label="Bitiş" />
            {can("OWNER", "MANAGER", "RECEPTION") && <Button onClick={() => setSelling(true)}><ShoppingBag /> Satış fişi</Button>}
          </>
        }
      />

      {manager && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Satış fişi" value={report.data ? report.data.saleCount : "—"} />
            <Stat label="Ürün cirosu (KDV dahil)" value={report.data ? tl(report.data.revenue) : "—"} hint={report.data ? `İadeler düşülmüş · KDV ${tl(report.data.vat)}` : undefined} />
            <Stat label="Maliyet" value={report.data ? tl(report.data.cost) : "—"} hint="Satış anındaki alış fiyatıyla" />
            <Stat label="Brüt kâr" value={report.data ? tl(report.data.profit) : "—"} hint="KDV hariç ciro − maliyet" />
          </div>
          <Card className="mt-6">
            <CardHeader title="Ürün bazında" description="Satış fiyatları KDV dahildir. KDV oranı girilmemiş ürünlerde KDV ayrılmaz (*). Alış fiyatı KDV hariç girilmelidir." />
            <Table head={["Ürün", "Satılan", "İade", "Ciro (KDV dahil)", "KDV", "KDV hariç", "Maliyet", "Brüt kâr"]} empty="Bu aralıkta ürün satışı yok">
              {report.data?.products.map((p) => (
                <tr key={p.productId}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{Number(p.soldQty)} {p.unit}</Td>
                  <Td>{Number(p.returnedQty) > 0 ? `${Number(p.returnedQty)} ${p.unit}` : "—"}</Td>
                  <Td>{tl(p.revenue)}</Td>
                  <Td>{tl(p.vat)}{!p.vatKnown && <span className="ml-1 text-xs text-amber-700" title="Bazı satışlarda KDV oranı tanımlı değildi">*</span>}</Td>
                  <Td>{tl(p.netRevenue)}</Td>
                  <Td>{tl(p.cost)}{!p.costKnown && <span className="ml-1 text-xs text-amber-700" title="Bazı satışlarda alış fiyatı tanımlı değildi">*</span>}</Td>
                  <Td className={Number(p.profit) < 0 ? "text-red-600" : ""}>{tl(p.profit)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Satış fişleri" />
        {sales.loading && !sales.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Tarih", "Ürünler", "Müşteri", "Personel", "Yöntem", "Tutar", ""]} empty="Bu aralıkta satış yok">
            {sales.data?.map((s) => {
              const returnable = s.items.some((i) => Number(i.returnableQty) > 0);
              return (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap">{dateTimeTr(s.occurredAt)}</Td>
                  <Td>{s.items.map((i) => <div key={i.id}>{i.product.name} × {Number(i.qty)}{Number(i.returnedQty) > 0 && <span className="ml-1 text-xs text-amber-700">({Number(i.returnedQty)} iade)</span>}</div>)}</Td>
                  <Td>{s.customer ? <Link className="hover:underline" href={`/panel/musteriler/${s.customer.id}`}>{s.customer.firstName} {s.customer.lastName}</Link> : "—"}</Td>
                  <Td>{s.staff?.displayName ?? "—"}</Td>
                  <Td>{METHOD_TR[s.method]}</Td>
                  <Td className="whitespace-nowrap">
                    {tl(s.total)}
                    {Number(s.returnedTotal) > 0 && <div className="text-xs text-amber-700">{tl(s.returnedTotal)} iade · net {tl(s.netTotal)}</div>}
                  </Td>
                  <Td className="text-right">{manager && returnable && <Button size="sm" variant="ghost" onClick={() => setReturning(s)}>İade</Button>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {selling && <SaleDialog onClose={() => setSelling(false)} onDone={() => { setSelling(false); reload(); }} />}
      {returning && <ReturnDialog sale={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); reload(); }} />}
    </>
  );
}

function ReturnDialog({ sale, onClose, onDone }: { sale: ProductSale; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const items = sale.items.filter((i) => Number(i.returnableQty) > 0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.id, true])));
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const amount = chosen.reduce((s, i) => s + Number(i.unitPrice) * (qty[i.id] ?? 0), 0);

  return (
    <Dialog open onClose={onClose} title="Ürün iadesi" wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await api(`/product-sales/${sale.id}/returns`, {
            method: "POST",
            body: { items: chosen.map((i) => ({ saleItemId: i.id, qty: qty[i.id], restock: restock[i.id] })), method: f.get("method"), reason: f.get("reason") },
          });
          toast("İade kaydedildi"); onDone();
        } catch (err) { toast((err as Error).message, "red"); } finally { setBusy(false); }
      }}>
        <Alert tone="amber">Mali kayıtlar silinemez; iade kasaya ayrı bir hareket olarak yazılır. “Stoğa geri al” işaretli ürünler stoğa geri girer.</Alert>
        <Table head={["Ürün", "Birim fiyat", "İade adedi", "Stoğa geri al"]}>
          {items.map((i) => (
            <tr key={i.id}>
              <Td>{i.product.name}<div className="text-xs text-neutral-500">Kalan: {Number(i.returnableQty)} {i.product.unit}</div></Td>
              <Td>{tl(i.unitPrice)}</Td>
              <Td><Input type="number" min={0} max={Number(i.returnableQty)} step={1} value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} className="w-24" aria-label={`${i.product.name} iade adedi`} /></Td>
              <Td><input type="checkbox" className="accent-brand-600" checked={restock[i.id] ?? true} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} aria-label={`${i.product.name} stoğa geri al`} /></Td>
            </tr>
          ))}
        </Table>
        <div className="grid grid-cols-2 gap-3">
          <Field label="İade yöntemi"><Select name="method" defaultValue={sale.method}>{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Sebep"><Input name="reason" required minLength={3} /></Field>
        </div>
        <div className="flex items-center justify-between border-t border-sand-200 pt-3">
          <span className="text-sm text-neutral-500">İade tutarı</span>
          <span className="text-lg font-semibold">{tl(amount)}</span>
        </div>
        <Button variant="danger" className="w-full" disabled={busy || chosen.length === 0}>İade et</Button>
      </form>
    </Dialog>
  );
}
