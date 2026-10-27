"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CustomerPicker } from "@/components/panel/customer-picker";
import { useSession } from "@/components/panel/session";
import type { Customer, Product } from "@/components/panel/types";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { METHOD_TR, tl } from "@/lib/format";

export default function StockPage() {
  const { can } = useSession();
  const toast = useToast();
  const products = useApi<Product[]>("/products");
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Product | null>(null);
  const [selling, setSelling] = useState<Product | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);

  return (
    <>
      <PageHeader title="Stok" description="Satış ürünleri ve sarf malzemeleri" action={can("OWNER", "MANAGER") && <Button onClick={() => setCreating(true)}><Plus /> Ürün</Button>} />
      <Card>
        {products.loading ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Ürün", "Tür", "Stok", "Kritik", "Alış / Satış", ""]} empty="Henüz ürün yok">
            {products.data?.map((p) => {
              const low = Number(p.stockQty) <= Number(p.minQty);
              return (
                <tr key={p.id}>
                  <Td><div className="font-medium">{p.name}</div><div className="text-xs text-neutral-500">{p.sku}</div></Td>
                  <Td><Badge tone={p.kind === "RETAIL" ? "blue" : "neutral"}>{p.kind === "RETAIL" ? "Satış" : "Sarf"}</Badge></Td>
                  <Td className={low ? "font-semibold text-red-600" : ""}>{Number(p.stockQty)} {p.unit}</Td>
                  <Td>{Number(p.minQty)} {p.unit}</Td>
                  <Td>{p.costPrice ? tl(p.costPrice) : "—"} / {p.salePrice ? tl(p.salePrice) : "—"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {p.kind === "RETAIL" && can("OWNER", "MANAGER", "RECEPTION") && <Button size="sm" variant="ghost" onClick={() => setSelling(p)}>Sat</Button>}
                    {can("OWNER", "MANAGER") && <Button size="sm" variant="ghost" onClick={() => setMoving(p)}>Hareket</Button>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {creating && (
        <Dialog open onClose={() => setCreating(false)} title="Yeni ürün">
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const n = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
            try {
              await api("/products", { method: "POST", body: { name: f.get("name"), sku: (f.get("sku") as string) || undefined, unit: f.get("unit"), kind: f.get("kind"), minQty: n("minQty"), costPrice: n("costPrice"), salePrice: n("salePrice"), initialQty: n("initialQty") } });
              toast("Ürün eklendi"); setCreating(false); products.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Ürün adı"><Input name="name" required /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Stok kodu"><Input name="sku" /></Field>
              <Field label="Birim"><Select name="unit"><option>adet</option><option>ml</option><option>gr</option><option>kutu</option><option>paket</option></Select></Field>
              <Field label="Tür"><Select name="kind"><option value="CONSUMABLE">Sarf</option><option value="RETAIL">Satış</option></Select></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Açılış stoğu"><Input name="initialQty" type="number" min={0} step="0.001" /></Field>
              <Field label="Kritik seviye"><Input name="minQty" type="number" min={0} step="0.001" /></Field>
              <Field label="Alış fiyatı (₺)"><Input name="costPrice" type="number" min={0} step="0.01" /></Field>
              <Field label="Satış fiyatı (₺)"><Input name="salePrice" type="number" min={0} step="0.01" /></Field>
            </div>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
      {moving && (
        <Dialog open onClose={() => setMoving(null)} title={`Stok hareketi: ${moving.name}`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api(`/products/${moving.id}/movements`, { method: "POST", body: { type: f.get("type"), qty: Number(f.get("qty")), note: f.get("note") || undefined } });
              toast("Stok güncellendi"); setMoving(null); products.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <p className="text-sm text-neutral-500">Mevcut: {Number(moving.stockQty)} {moving.unit}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hareket"><Select name="type"><option value="IN">Giriş</option><option value="OUT">Çıkış</option><option value="ADJUST">Sayım düzeltmesi (±)</option></Select></Field>
              <Field label="Miktar"><Input name="qty" type="number" step="0.001" required /></Field>
            </div>
            <Field label="Not"><Input name="note" /></Field>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
      {selling && (
        <Dialog open onClose={() => { setSelling(null); setCustomer(null); }} title={`Satış: ${selling.name}`}>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api("/product-sales", { method: "POST", body: { productId: selling.id, qty: Number(f.get("qty")), method: f.get("method"), customerId: customer?.id } });
              toast("Satış kaydedildi"); setSelling(null); setCustomer(null); products.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            {!selling.salePrice && <Alert tone="amber">Bu ürünün satış fiyatı tanımlı değil.</Alert>}
            <Field label="Müşteri (isteğe bağlı)"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Adet" hint={`Birim ${selling.salePrice ? tl(selling.salePrice) : "—"}`}><Input name="qty" type="number" min={1} step={1} defaultValue={1} required /></Field>
              <Field label="Yöntem"><Select name="method" defaultValue="CARD">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Button className="w-full">Satışı kaydet</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
