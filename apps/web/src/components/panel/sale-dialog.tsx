"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { CustomerPicker } from "@/components/panel/customer-picker";
import type { Customer, LowStockItem, Product, Staff } from "@/components/panel/types";
import { Alert, Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { METHOD_TR, tl } from "@/lib/format";

export type SaleLine = { productId: string; qty: number; unitPrice: string };

export const saleLine = (p: Product): SaleLine => ({ productId: p.id, qty: 1, unitPrice: p.salePrice ? String(Number(p.salePrice)) : "" });

/** Satırların KDV dahil toplamı ve içindeki KDV (oranı tanımlı ürünler için). */
export function saleTotals(lines: SaleLine[], products: Product[]) {
  let total = 0;
  let vat = 0;
  for (const l of lines) {
    const gross = (Number(l.unitPrice) || 0) * l.qty;
    total += gross;
    const rate = Number(products.find((p) => p.id === l.productId)?.vatRate ?? 0);
    if (rate > 0) vat += (gross * rate) / (100 + rate);
  }
  return { total, vat };
}

export const linesInvalid = (lines: SaleLine[]) => lines.some((l) => !l.qty || l.qty <= 0 || l.unitPrice === "" || Number(l.unitPrice) < 0);

export const lineBody = (lines: SaleLine[]) => lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: Number(l.unitPrice) }));

/** Satış sonrası kritik seviyeye düşen ürünler için uyarı metni. */
export const lowStockText = (low: LowStockItem[] | undefined) =>
  low && low.length ? `Kritik stok: ${low.map((p) => `${p.name} (${Number(p.stockQty)} ${p.unit})`).join(", ")}` : null;

/** Ürün satırları düzenleyicisi (satış fişi ve randevu tahsilatı ortak). */
export function ProductLines({ retail, lines, setLines }: { retail: Product[]; lines: SaleLine[]; setLines: (f: (ls: SaleLine[]) => SaleLine[]) => void }) {
  const byId = (id: string) => retail.find((p) => p.id === id);
  const set = (i: number, patch: Partial<SaleLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const p = byId(l.productId);
        return (
          <div key={i} className="grid grid-cols-12 items-end gap-2 border-b border-sand-100 pb-2 sm:border-0 sm:pb-0">
            <Field label="Ürün" className="col-span-12 sm:col-span-5">
              <Select value={l.productId} onChange={(e) => { const np = byId(e.target.value); if (np) set(i, saleLine(np)); }}>
                {retail.map((x) => <option key={x.id} value={x.id}>{x.name} ({Number(x.stockQty)} {x.unit})</option>)}
              </Select>
            </Field>
            <Field label="Adet" className="col-span-4 sm:col-span-2">
              <Input type="number" min={1} step={1} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} required />
            </Field>
            <Field label="Birim fiyat (₺)" hint={p?.vatRate != null ? `KDV %${Number(p.vatRate)} dahil` : undefined} className="col-span-5 sm:col-span-3">
              <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} required placeholder={p?.salePrice ? undefined : "Fiyat girin"} />
            </Field>
            <div className="col-span-3 flex items-center justify-end gap-1 pb-2 text-sm sm:col-span-2">
              <span className="whitespace-nowrap">{tl((Number(l.unitPrice) || 0) * l.qty)}</span>
              <button type="button" aria-label="Satırı sil" className="rounded p-1 text-neutral-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        );
      })}
      {retail.length > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, saleLine(retail.find((p) => !ls.some((l) => l.productId === p.id)) ?? retail[0])])}>+ Ürün ekle</Button>
      )}
    </div>
  );
}

/** Çok ürünlü satış fişi: ürünler, adet, (indirimli) birim fiyat, satan personel, müşteri, ödeme yöntemi. */
export function SaleDialog({ initial, onClose, onDone }: { initial?: Product | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const staff = useApi<Staff[]>("/staff");
  const products = useApi<Product[]>("/products?kind=RETAIL");
  const retail = products.data ?? [];
  const [lines, setLines] = useState<SaleLine[]>(initial ? [saleLine(initial)] : []);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [staffId, setStaffId] = useState("");
  const [method, setMethod] = useState("CARD");
  const [busy, setBusy] = useState(false);
  const { total, vat } = saleTotals(lines, retail);
  const invalid = lines.length === 0 || linesInvalid(lines);

  return (
    <Dialog open onClose={onClose} title="Satış fişi" wide>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) return;
        setBusy(true);
        try {
          const r = await api<{ lowStock?: LowStockItem[] }>("/product-sales", {
            method: "POST",
            body: { items: lineBody(lines), method, customerId: customer?.id, staffId: staffId || undefined },
          });
          toast("Satış kaydedildi");
          const warn = lowStockText(r.lowStock);
          if (warn) toast(warn, "amber");
          onDone();
        } catch (err) { toast((err as Error).message, "red"); } finally { setBusy(false); }
      }}>
        {products.data && retail.length === 0 && <Alert tone="amber">Satışa açık ürün yok. Ürün eklerken türü “Satış” seçin.</Alert>}
        <ProductLines retail={retail} lines={lines} setLines={setLines} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Müşteri (isteğe bağlı)"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
          <Field label="Satan personel (prim için)">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">—</option>
              {staff.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Ödeme yöntemi"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        <div className="border-t border-sand-200 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Toplam (KDV dahil)</span>
            <span className="text-lg font-semibold">{tl(total)}</span>
          </div>
          {vat > 0 && <div className="text-right text-xs text-neutral-500">İçindeki KDV: {tl(vat)}</div>}
        </div>
        <Button className="w-full" disabled={busy || invalid}>Satışı kaydet</Button>
      </form>
    </Dialog>
  );
}
