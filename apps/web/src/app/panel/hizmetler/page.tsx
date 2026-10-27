"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { Product, Service } from "@/components/panel/types";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { tl } from "@/lib/format";

type Category = { id: string; name: string };

export default function ServicesPage() {
  const { has } = useSession();
  const services = useApi<Service[]>("/services?includeInactive=true");
  const cats = useApi<Category[]>("/service-categories");
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  const [consumables, setConsumables] = useState<Service | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Hizmetler"
        description="Süre, fiyat ve online randevu ayarları"
        action={
          <>
            <Button variant="outline" onClick={() => setCatOpen(true)}>Kategoriler</Button>
            <Button onClick={() => setEdit("new")}><Plus /> Hizmet</Button>
          </>
        }
      />
      <Card>
        {services.loading ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Hizmet", "Kategori", "Süre", "Fiyat", "Durum", ""]} empty="Henüz hizmet yok">
            {services.data?.map((s) => (
              <tr key={s.id}>
                <Td><div className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: s.color ?? "#c97399" }} /><span className="font-medium">{s.name}</span></div></Td>
                <Td className="text-neutral-600">{s.category?.name ?? "—"}</Td>
                <Td>{s.durationMin} dk</Td>
                <Td>{tl(s.price)}</Td>
                <Td className="space-x-1">
                  <Badge tone={s.isActive ? "green" : "neutral"}>{s.isActive ? "Aktif" : "Pasif"}</Badge>
                  {s.onlineBookable && s.isActive && <Badge tone="blue">Online</Badge>}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {has("STOCK") && <Button size="sm" variant="ghost" onClick={() => setConsumables(s)}>Sarf</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Düzenle</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {edit && <ServiceForm initial={edit === "new" ? undefined : edit} cats={cats.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); services.reload(); }} />}
      {consumables && <ConsumablesDialog service={consumables} onClose={() => setConsumables(null)} />}
      {catOpen && <CategoriesDialog cats={cats.data ?? []} onClose={() => setCatOpen(false)} onChange={() => { cats.reload(); services.reload(); }} />}
    </>
  );
}

function ServiceForm({ initial, cats, onClose, onSaved }: { initial?: Service; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"), description: (f.get("description") as string) || undefined, categoryId: (f.get("categoryId") as string) || null,
      durationMin: Number(f.get("durationMin")), price: Number(f.get("price")), color: f.get("color"),
      isActive: f.get("isActive") === "on", onlineBookable: f.get("onlineBookable") === "on",
    };
    try {
      await api(initial ? `/services/${initial.id}` : "/services", { method: initial ? "PATCH" : "POST", body });
      toast("Hizmet kaydedildi");
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Dialog open onClose={onClose} title={initial ? "Hizmeti düzenle" : "Yeni hizmet"}>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Hizmet adı"><Input name="name" required defaultValue={initial?.name} /></Field>
        <Field label="Kategori">
          <Select name="categoryId" defaultValue={initial?.category?.id ?? ""}>
            <option value="">Kategorisiz</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Süre (dk)"><Input name="durationMin" type="number" min={5} max={720} step={5} required defaultValue={initial?.durationMin ?? 60} /></Field>
          <Field label="Fiyat (₺)"><Input name="price" type="number" min={0} step="0.01" required defaultValue={initial ? Number(initial.price) : ""} /></Field>
          <Field label="Renk"><Input name="color" type="color" defaultValue={initial?.color ?? "#b0507b"} className="p-1" /></Field>
        </div>
        <Field label="Açıklama (online sayfada görünür)"><Textarea name="description" defaultValue={initial?.description ?? ""} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="accent-brand-600" /> Aktif</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="onlineBookable" defaultChecked={initial?.onlineBookable ?? true} className="accent-brand-600" /> Online randevuya açık</label>
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}

function ConsumablesDialog({ service, onClose }: { service: Service; onClose: () => void }) {
  const toast = useToast();
  const products = useApi<Product[]>("/products?kind=CONSUMABLE");
  const current = useApi<{ productId: string; qty: string }[]>(`/services/${service.id}/consumables`);
  const [rows, setRows] = useState<{ productId: string; qty: string }[] | null>(null);
  const items = rows ?? current.data?.map((c) => ({ productId: c.productId, qty: String(Number(c.qty)) })) ?? [];
  return (
    <Dialog open onClose={onClose} title={`${service.name} · sarf malzemeleri`}>
      <p className="mb-4 text-sm text-neutral-500">Randevu tamamlandığında bu miktarlar stoktan otomatik düşer.</p>
      <div className="space-y-2">
        {items.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Select value={r.productId} onChange={(e) => setRows(items.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
              <option value="">Ürün seçin</option>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </Select>
            <Input className="w-28" type="number" min="0.001" step="0.001" value={r.qty} onChange={(e) => setRows(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" onClick={() => setRows(items.filter((_, j) => j !== i))} aria-label="Kaldır">×</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setRows([...items, { productId: "", qty: "1" }])}>+ Malzeme</Button>
      </div>
      <Button className="mt-5 w-full" onClick={async () => {
        try {
          await api(`/services/${service.id}/consumables`, { method: "PUT", body: { items: items.filter((x) => x.productId).map((x) => ({ productId: x.productId, qty: Number(x.qty) })) } });
          toast("Sarf malzemeleri kaydedildi");
          onClose();
        } catch (e) { toast((e as Error).message, "red"); }
      }}>Kaydet</Button>
    </Dialog>
  );
}

function CategoriesDialog({ cats, onClose, onChange }: { cats: Category[]; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      onChange();
    } catch (e) {
      toast((e as Error).message, "red");
    }
  };
  return (
    <Dialog open onClose={onClose} title="Hizmet kategorileri">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => api("/service-categories", { method: "POST", body: { name: name.trim() } }), "Kategori eklendi").then(() => setName("")); }}>
        <Input aria-label="Yeni kategori adı" placeholder="Yeni kategori" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button>Ekle</Button>
      </form>
      <ul className="divide-y divide-sand-100">
        {cats.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <Input aria-label={`${c.name} adı`} defaultValue={c.name} className="h-9" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run(() => api(`/service-categories/${c.id}`, { method: "PATCH", body: { name: v } }), "Kategori güncellendi"); }} />
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run(() => api(`/service-categories/${c.id}`, { method: "DELETE" }), "Kategori silindi")}>Sil</Button>
          </li>
        ))}
        {cats.length === 0 && <li className="py-4 text-sm text-neutral-500">Henüz kategori yok.</li>}
      </ul>
    </Dialog>
  );
}
