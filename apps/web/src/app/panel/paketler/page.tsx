"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CustomerPicker } from "@/components/panel/customer-picker";
import { useSession } from "@/components/panel/session";
import type { Customer, Service } from "@/components/panel/types";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { METHOD_TR, tl } from "@/lib/format";

type Template = { id: string; name: string; sessionCount: number; price: string; validityDays: number | null; isActive: boolean; service: { id: string; name: string } };

export default function PackagesPage() {
  const { can } = useSession();
  const tpls = useApi<Template[]>("/package-templates");
  const [creating, setCreating] = useState(false);
  const [selling, setSelling] = useState<Template | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const toast = useToast();

  return (
    <>
      <PageHeader title="Paketler" description="Seanslı paket şablonları ve satış" action={can("OWNER", "MANAGER") && <Button onClick={() => setCreating(true)}><Plus /> Paket şablonu</Button>} />
      <Card>
        {tpls.loading ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Paket", "Hizmet", "Seans", "Fiyat", "Geçerlilik", ""]} empty="Henüz paket tanımlanmadı">
            {tpls.data?.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name} {!t.isActive && <Badge>Pasif</Badge>}</Td>
                <Td>{t.service.name}</Td>
                <Td>{t.sessionCount}</Td>
                <Td>{tl(t.price)} <span className="text-xs text-neutral-500">({tl(Number(t.price) / t.sessionCount)}/seans)</span></Td>
                <Td>{t.validityDays ? `${t.validityDays} gün` : "Süresiz"}</Td>
                <Td className="whitespace-nowrap text-right">
                  {can("OWNER", "MANAGER") && <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Düzenle</Button>}
                  {t.isActive && can("OWNER", "MANAGER", "RECEPTION") && <Button size="sm" onClick={() => setSelling(t)}>Sat</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <TemplateForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); tpls.reload(); }} />}
      {selling && <SellDialog tpl={selling} onClose={() => setSelling(null)} />}
      {editing && (
        <Dialog open onClose={() => setEditing(null)} title="Paket şablonunu düzenle">
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await api(`/package-templates/${editing.id}`, { method: "PATCH", body: { name: f.get("name"), price: Number(f.get("price")), validityDays: f.get("validityDays") ? Number(f.get("validityDays")) : null, isActive: f.get("isActive") === "on" } });
              toast("Paket şablonu güncellendi"); setEditing(null); tpls.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Paket adı"><Input name="name" required defaultValue={editing.name} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fiyat (₺)"><Input name="price" type="number" min={0} step="0.01" required defaultValue={Number(editing.price)} /></Field>
              <Field label="Geçerlilik (gün)"><Input name="validityDays" type="number" min={1} defaultValue={editing.validityDays ?? ""} placeholder="Süresiz" /></Field>
            </div>
            <p className="text-xs text-neutral-500">Seans sayısı ve hizmet, satılmış paketleri etkilememesi için değiştirilemez; gerekirse yeni şablon oluşturun.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing.isActive} className="accent-brand-600" /> Satışa açık</label>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function TemplateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const services = useApi<Service[]>("/services");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Yeni paket şablonu">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("/package-templates", { method: "POST", body: { name: f.get("name"), serviceId: f.get("serviceId"), sessionCount: Number(f.get("sessionCount")), price: Number(f.get("price")), validityDays: f.get("validityDays") ? Number(f.get("validityDays")) : undefined } });
          onSaved();
        } catch (e) { setErr((e as Error).message); }
      }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Paket adı"><Input name="name" required placeholder="6 seans lazer epilasyon" /></Field>
        <Field label="Hizmet"><Select name="serviceId" required><option value="">Seçin</option>{services.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Seans"><Input name="sessionCount" type="number" min={1} max={200} required defaultValue={6} /></Field>
          <Field label="Fiyat (₺)"><Input name="price" type="number" min={0} step="0.01" required /></Field>
          <Field label="Geçerlilik (gün)"><Input name="validityDays" type="number" min={1} placeholder="Süresiz" /></Field>
        </div>
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}

function SellDialog({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={`Paket sat: ${tpl.name}`}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (!customer) return setErr("Müşteri seçin");
        const f = new FormData(e.currentTarget);
        const paid = Number(f.get("paid") || 0);
        try {
          await api("/customer-packages", { method: "POST", body: { customerId: customer.id, templateId: tpl.id, price: Number(f.get("price")), payment: paid > 0 ? { amount: paid, method: f.get("method") } : undefined } });
          toast("Paket satıldı");
          onClose();
        } catch (e) { setErr((e as Error).message); }
      }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Müşteri"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <Field label="Satış fiyatı (₺)"><Input name="price" type="number" step="0.01" min={0} defaultValue={Number(tpl.price)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Peşin tahsilat (₺)"><Input name="paid" type="number" step="0.01" min={0} defaultValue={Number(tpl.price)} /></Field>
          <Field label="Yöntem"><Select name="method" defaultValue="CARD">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        <Button className="w-full">Satışı tamamla</Button>
      </form>
    </Dialog>
  );
}
