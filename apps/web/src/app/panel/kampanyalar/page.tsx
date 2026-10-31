"use client";

import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Spinner, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr } from "@/lib/format";

type Campaign = { id: string; title: string; description: string; startsAt: string | null; endsAt: string | null; isActive: boolean; sends: Record<string, number> };
type Audience = { eligible: number; withoutConsent: number; enabled: boolean; max: number };

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: FormDataEntryValue | null) => (v ? new Date(v as string).toISOString() : null);

function state(c: Campaign) {
  const now = Date.now();
  if (!c.isActive) return { label: "Pasif", tone: "neutral" as const };
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return { label: "Süresi doldu", tone: "neutral" as const };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: "Başlamadı", tone: "amber" as const };
  return { label: "Yayında", tone: "green" as const };
}

export default function CampaignsPage() {
  const { can, has } = useSession();
  const toast = useToast();
  const list = useApi<Campaign[]>("/campaigns");
  const [edit, setEdit] = useState<Campaign | "new" | null>(null);
  const [send, setSend] = useState<Campaign | null>(null);

  return (
    <>
      <PageHeader
        title="Kampanyalar"
        description="Yayındaki kampanyalar, Instagram ve WhatsApp'tan yazan müşterilere yapay zekâ asistanı tarafından anlatılır. Asistan buraya yazılmayan hiçbir indirimi söylemez."
        action={can("OWNER", "MANAGER") && <Button onClick={() => setEdit("new")}>Yeni kampanya</Button>}
      />
      <Card>
        {list.loading && !list.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Kampanya", "Tarih", "Durum", "Duyuru", ""]} empty="Henüz kampanya yok">
            {list.data?.map((c) => {
              const st = state(c);
              const total = Object.values(c.sends).reduce((x, y) => x + y, 0);
              return (
                <tr key={c.id}>
                  <Td><p className="font-medium">{c.title}</p><p className="max-w-md text-xs text-neutral-500">{c.description}</p></Td>
                  <Td className="text-xs">{c.startsAt ? dateTimeTr(c.startsAt) : "Hemen"} – {c.endsAt ? dateTimeTr(c.endsAt) : "Süresiz"}</Td>
                  <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                  <Td className="text-xs">{total ? `${total} mesaj (${c.sends.SENT ?? 0} gönderildi, ${c.sends.SKIPPED ?? 0} atlandı)` : "—"}</Td>
                  <Td className="space-x-2 text-right">
                    {can("OWNER", "MANAGER") && <Button size="sm" variant="outline" onClick={() => setEdit(c)}>Düzenle</Button>}
                    {can("OWNER") && has("WHATSAPP") && st.label === "Yayında" && <Button size="sm" variant="secondary" onClick={() => setSend(c)}>WhatsApp duyurusu</Button>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Yeni kampanya" : "Kampanyayı düzenle"}>
        {edit && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = { title: f.get("title"), description: f.get("description"), startsAt: fromLocal(f.get("startsAt")), endsAt: fromLocal(f.get("endsAt")), isActive: f.get("isActive") === "on" };
            try {
              if (edit === "new") await api("/campaigns", { method: "POST", body });
              else await api(`/campaigns/${edit.id}`, { method: "PATCH", body });
              toast("Kampanya kaydedildi"); setEdit(null); void list.reload();
            } catch (err) { toast((err as Error).message, "red"); }
          }}>
            <Field label="Başlık"><Input name="title" required minLength={3} maxLength={120} defaultValue={edit === "new" ? "" : edit.title} /></Field>
            <Field label="Müşteriye anlatılacak metin" hint="Koşulları açıkça yazın (ör. hangi hizmet, indirim oranı, son tarih). Asistan yalnızca bu metni kullanır.">
              <Textarea name="description" required minLength={10} maxLength={1000} rows={4} defaultValue={edit === "new" ? "" : edit.description} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Başlangıç (boşsa hemen)"><Input name="startsAt" type="datetime-local" defaultValue={edit === "new" ? "" : toLocal(edit.startsAt)} /></Field>
              <Field label="Bitiş (boşsa süresiz)"><Input name="endsAt" type="datetime-local" defaultValue={edit === "new" ? "" : toLocal(edit.endsAt)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={edit === "new" ? true : edit.isActive} className="accent-brand-600" /> Aktif</label>
            <Button className="w-full">Kaydet</Button>
          </form>
        )}
      </Dialog>

      <Dialog open={!!send} onClose={() => setSend(null)} title="WhatsApp kampanya duyurusu">
        {send && <Broadcast c={send} onDone={() => { setSend(null); void list.reload(); }} />}
      </Dialog>
    </>
  );
}

function Broadcast({ c, onDone }: { c: Campaign; onDone: () => void }) {
  const toast = useToast();
  const aud = useApi<Audience>(`/campaigns/${c.id}/audience`);
  const [busy, setBusy] = useState(false);
  if (!aud.data) return <Spinner />;
  const d = aud.data;
  return (
    <form className="space-y-4 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true);
      try {
        const r = await api<{ queued: number; alreadySent: number }>(`/campaigns/${c.id}/broadcast`, { method: "POST", body: { confirm: f.get("confirm") === "on", iysConfirmed: f.get("iys") === "on" } });
        toast(`${r.queued} mesaj kuyruğa alındı${r.alreadySent ? `, ${r.alreadySent} müşteriye daha önce gönderilmiş` : ""}`);
        onDone();
      } catch (err) { toast((err as Error).message, "red"); } finally { setBusy(false); }
    }}>
      {!d.enabled && <Alert tone="amber">Toplu kampanya mesajı bu sunucuda kapalı: İYS (İleti Yönetim Sistemi) entegrasyonu henüz yok.</Alert>}
      <p>Bu kampanya, Meta'da onaylı <span className="font-mono">kampanya_duyuru</span> şablonuyla yalnızca <b>ticari ileti izni olan {d.eligible} müşteriye</b> gönderilir. İzni olmayan {d.withoutConsent} müşteriye gönderilmez. Aynı müşteriye aynı kampanya bir kez gider; mesajlar Meta tarafından pazarlama ücretiyle faturalanır.</p>
      <label className="flex items-start gap-2"><input type="checkbox" name="iys" required className="mt-1 accent-brand-600" /> İşletmem İYS'ye kayıtlı; bu müşterilerin onayları İYS'de kayıtlı ve ret talepleri işleniyor.</label>
      <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required className="mt-1 accent-brand-600" /> {d.eligible} müşteriye gönderimi onaylıyorum.</label>
      <Button className="w-full" disabled={busy || !d.enabled || d.eligible === 0}>Gönder</Button>
    </form>
  );
}
