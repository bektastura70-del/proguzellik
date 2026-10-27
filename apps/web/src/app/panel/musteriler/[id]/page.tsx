"use client";

import { Download, Pencil, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { CustomerForm } from "@/components/panel/customer-form";
import { useSession } from "@/components/panel/session";
import type { Customer } from "@/components/panel/types";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td, Textarea, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr, dateTr, METHOD_TR, STATUS_TR, TYPE_TR, tl } from "@/lib/format";

type History = {
  customer: Customer;
  notes: { id: string; body: string; createdAt: string }[];
  appointments: { id: string; startsAt: string; status: string; price: string; customerPackageId: string | null; service: { name: string }; staff: { displayName: string } }[];
  packages: { id: string; name: string; totalSessions: number; usedSessions: number; status: string; price: string; expiresAt: string | null }[];
  transactions: { id: string; type: string; amount: string; method: string; occurredAt: string; category: string }[];
  balance: { charges: string; payments: string; balance: string };
};

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const h = useApi<History>(`/customers/${id}/history`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [anon, setAnon] = useState(false);
  const [note, setNote] = useState("");

  if (h.error) return <Alert>{h.error.message}</Alert>;
  if (!h.data) return <Spinner />;
  const { customer: c } = h.data;

  async function cancelPackage(pkgId: string) {
    if (!confirm("Paket iptal edilsin mi? Kullanılan seanslar korunur.")) return;
    try {
      await api(`/customer-packages/${pkgId}/cancel`, { method: "POST" });
      toast("Paket iptal edildi");
      h.reload();
    } catch (e) {
      toast((e as Error).message, "red");
    }
  }

  async function exportData() {
    let data: unknown;
    try {
      data = await api(`/customers/${id}/kvkk-export`);
    } catch (e) {
      return toast((e as Error).message, "red");
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kvkk-${c.firstName}-${c.lastName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <PageHeader
        title={`${c.firstName} ${c.lastName}`}
        description={[c.phone, c.email].filter(Boolean).join(" · ") || undefined}
        action={
          <>
            {can("OWNER", "MANAGER", "RECEPTION") && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Düzenle</Button>}
            {can("OWNER", "MANAGER", "RECEPTION") && <Button onClick={() => setPaying(true)}>Tahsilat al</Button>}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
        <Badge tone={c.kvkkConsentAt ? "green" : "amber"}>{c.kvkkConsentAt ? `KVKK onayı ${dateTr(c.kvkkConsentAt, { day: "numeric", month: "short", year: "numeric" })}` : "KVKK onayı yok"}</Badge>
        {c.marketingConsent && <Badge tone="blue">Kampanya izni</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Toplam hizmet/paket" value={tl(h.data.balance.charges)} />
        <Stat label="Ödenen" value={tl(h.data.balance.payments)} />
        <Stat label="Bakiye" value={<span className={Number(h.data.balance.balance) > 0 ? "text-red-600" : ""}>{tl(h.data.balance.balance)}</span>} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Randevu geçmişi" />
            <Table head={["Tarih", "Hizmet", "Personel", "Durum", "Ücret"]} empty="Randevu yok">
              {h.data.appointments.map((a) => (
                <tr key={a.id}>
                  <Td>{dateTimeTr(a.startsAt)}</Td><Td>{a.service.name}</Td><Td>{a.staff.displayName}</Td>
                  <Td><Badge tone={statusTone(a.status)}>{STATUS_TR[a.status]}</Badge></Td>
                  <Td>{a.customerPackageId ? "Paket" : tl(a.price)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <CardHeader title="Paketler" />
            <Table head={["Paket", "Seans", "Durum", "Tutar", "Son kullanım", ""]} empty="Paket yok">
              {h.data.packages.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 rounded-full bg-sand-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(p.usedSessions / p.totalSessions) * 100}%` }} /></div>
                      {p.usedSessions}/{p.totalSessions}
                    </div>
                  </Td>
                  <Td><Badge tone={statusTone(p.status)}>{STATUS_TR[p.status] ?? p.status}</Badge></Td>
                  <Td>{tl(p.price)}</Td>
                  <Td>{p.expiresAt ? dateTr(p.expiresAt, { day: "numeric", month: "short", year: "numeric" }) : "—"}</Td>
                  <Td className="text-right">{p.status === "ACTIVE" && can("OWNER", "MANAGER") && <Button size="sm" variant="ghost" onClick={() => cancelPackage(p.id)}>İptal</Button>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <CardHeader title="Ödemeler" />
            <Table head={["Tarih", "Tür", "Kategori", "Yöntem", "Tutar"]} empty="Ödeme yok">
              {h.data.transactions.map((t) => (
                <tr key={t.id}>
                  <Td>{dateTimeTr(t.occurredAt)}</Td><Td>{TYPE_TR[t.type]}</Td><Td>{t.category}</Td><Td>{METHOD_TR[t.method]}</Td>
                  <Td className={t.type === "REFUND" ? "text-red-600" : ""}>{t.type === "REFUND" ? "−" : ""}{tl(t.amount)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Notlar" />
            <CardBody className="space-y-3">
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  try {
                    await api(`/customers/${id}/notes`, { method: "POST", body: { body: note } });
                    setNote("");
                    toast("Not eklendi");
                    h.reload();
                  } catch (err) {
                    toast((err as Error).message, "red");
                  }
                }}
              >
                <Textarea placeholder="Alerji, tercih, cilt tipi…" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" variant="outline">Not ekle</Button>
              </form>
              {h.data.notes.map((n) => (
                <div key={n.id} className="rounded-xl bg-sand-50 p-3 text-sm">
                  <p>{n.body}</p>
                  <p className="mt-1 text-xs text-neutral-500">{dateTimeTr(n.createdAt)}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          {can("OWNER", "MANAGER") && (
            <Card>
              <CardHeader title="KVKK işlemleri" description="Kişisel veri talepleri (m.11)" />
              <CardBody className="space-y-2">
                <Button variant="outline" className="w-full" onClick={exportData}><Download /> Verileri dışa aktar (JSON)</Button>
                <Button variant="danger" className="w-full" onClick={() => setAnon(true)}><ShieldX /> Anonimleştir</Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {editing && <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); h.reload(); }} />}
      {paying && (
        <Dialog open onClose={() => setPaying(false)} title="Tahsilat al">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api("/finance/payments", { method: "POST", body: { customerId: id, amount: Number(f.get("amount")), method: f.get("method"), description: f.get("description") || undefined } });
                toast("Tahsilat kaydedildi");
                setPaying(false);
                h.reload();
              } catch (err) {
                toast((err as Error).message, "red");
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tutar (₺)"><Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={Math.max(0, Number(h.data.balance.balance)) || ""} /></Field>
              <Field label="Yöntem"><Select name="method">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Field label="Açıklama"><Input name="description" /></Field>
            <Button className="w-full">Kaydet</Button>
          </form>
        </Dialog>
      )}
      {anon && (
        <Dialog open onClose={() => setAnon(false)} title="Müşteriyi anonimleştir">
          <p className="text-sm text-neutral-600">Ad, telefon, e-posta, notlar ve etiketler <b>kalıcı olarak silinir</b>. Bekleyen randevuları iptal edilir. Mali kayıtlar yasal zorunluluk nedeniyle anonim olarak saklanır. Bu işlem geri alınamaz.</p>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={async () => {
              try {
                await api(`/customers/${id}/anonymize`, { method: "POST" });
                toast("Müşteri anonimleştirildi");
                router.push("/panel/musteriler");
              } catch (err) {
                toast((err as Error).message, "red");
              }
            }}>Anonimleştir</Button>
            <Button variant="outline" onClick={() => setAnon(false)}>Vazgeç</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
