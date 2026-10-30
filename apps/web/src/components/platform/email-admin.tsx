"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Select, Spinner, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR } from "@/lib/format";

const EMAIL_STATUS_TR: Record<string, [string, "green" | "amber" | "red" | "neutral" | "blue"]> = {
  SENT: ["Gönderildi", "green"], FAILED: ["Başarısız", "red"], NOT_CONFIGURED: ["Gönderilmedi (SMTP yok)", "amber"], QUEUED: ["Kuyrukta", "blue"],
};
type EmailRow = { id: string; to: string; template: string; subject: string; status: string; error: string | null; attempts: number; createdAt: string; sentAt: string | null; retryable: boolean };
type History = { total: number; delivery: { configured: boolean }; byStatus: Record<string, number>; items: EmailRow[] };
type Tpl = { name: string; label: string; vars: string[]; secret: boolean; editable: boolean; customized: boolean; subject: string | null; body: string | null; defaultSubject: string; defaultBody: string; updatedAt: string | null };
const when = (iso: string) => dateTr(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function EmailCenter({ tenants }: { tenants: { id: string; name: string }[] }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [template, setTemplate] = useState("");
  const [to, setTo] = useState("");
  const q = new URLSearchParams({ ...(status ? { status } : {}), ...(template ? { template } : {}), ...(to ? { to } : {}), take: "100" });
  const h = useApi<History>(`/platform/emails?${q}`);
  const tpls = useApi<Tpl[]>("/platform/email-templates");
  const [edit, setEdit] = useState<Tpl | null>(null);
  const [notice, setNotice] = useState(false);
  const label = (n: string) => tpls.data?.find((t) => t.name === n)?.label ?? n;

  const retry = async (id: string) => {
    try { await api(`/platform/emails/${id}/retry`, { method: "POST" }); toast("E-posta gönderildi"); } catch (e) { toast((e as Error).message, "red"); }
    void h.reload();
  };

  return (
    <div className="mt-6 space-y-6">
      {h.data && !h.data.delivery.configured && (
        <Alert tone="amber">E-posta (SMTP) yapılandırılmadı. Hiçbir e-posta gönderilmiyor; kayıtlar “Gönderilmedi (SMTP yok)” olarak tutuluyor. SMTP ortam değişkenleri tanımlanınca bu kayıtlar tekrar denenebilir.</Alert>
      )}
      <Card>
        <CardHeader
          title="Gönderim geçmişi"
          description={h.data ? Object.entries(h.data.byStatus).map(([k, v]) => `${EMAIL_STATUS_TR[k]?.[0] ?? k}: ${v}`).join(" · ") || "Henüz e-posta yok" : undefined}
          action={
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Alıcı ara" placeholder="Alıcı ara" className="h-9 w-44" value={to} onChange={(e) => setTo(e.target.value)} />
              <Select aria-label="Durum" className="h-9 w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tüm durumlar</option>
                {Object.entries(EMAIL_STATUS_TR).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="Şablon" className="h-9 w-48" value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Tüm şablonlar</option>
                {tpls.data?.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
              </Select>
              <Button size="sm" className="h-9" onClick={() => setNotice(true)}>Bilgilendirme gönder</Button>
            </div>
          }
        />
        {!h.data ? <CardBody><Spinner /></CardBody> : (
          <Table head={["Tarih", "Alıcı", "E-posta", "Durum", "Deneme", ""]} empty="Kayıt yok">
            {h.data.items.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-xs">{when(e.createdAt)}</Td>
                <Td className="text-xs">{e.to}</Td>
                <Td><div>{e.subject}</div><div className="text-xs text-neutral-500">{label(e.template)}</div></Td>
                <Td><Badge tone={EMAIL_STATUS_TR[e.status]?.[1] ?? "neutral"}>{EMAIL_STATUS_TR[e.status]?.[0] ?? e.status}</Badge>{e.error && e.status !== "SENT" && <div className="max-w-xs truncate text-xs text-neutral-500" title={e.error}>{e.error}</div>}</Td>
                <Td>{e.attempts}</Td>
                <Td className="text-right">
                  {e.status !== "SENT" && (e.retryable
                    ? <Button size="sm" variant="ghost" onClick={() => retry(e.id)}>Tekrar dene</Button>
                    : <span className="text-xs text-neutral-400" title="Tek kullanımlık bağlantı içerir; ilgili işlemden yeniden gönderin">İşlemden yeniden gönderin</span>)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="E-posta şablonları" description="Güvenlik e-postaları (parola sıfırlama, doğrulama, davet, 2FA) değiştirilemez. Diğerlerinde {değişken} yer tutucuları kullanılabilir." />
        {!tpls.data ? <CardBody><Spinner /></CardBody> : (
          <Table head={["Şablon", "Konu", "Durum", ""]}>
            {tpls.data.map((t) => (
              <tr key={t.name}>
                <Td className="font-medium">{t.label}</Td>
                <Td className="text-xs">{t.subject ?? t.defaultSubject}</Td>
                <Td>{!t.editable ? <Badge>Sabit</Badge> : t.customized ? <Badge tone="brand">Özelleştirildi</Badge> : <Badge tone="neutral">Varsayılan</Badge>}</Td>
                <Td className="text-right">{t.editable && <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Düzenle</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {edit && <TemplateDialog tpl={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void tpls.reload(); }} />}
      {notice && <NoticeDialog tenants={tenants} onClose={() => setNotice(false)} onSent={() => { setNotice(false); void h.reload(); }} />}
    </div>
  );
}

function TemplateDialog({ tpl, onClose, onSaved }: { tpl: Tpl; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(tpl.subject ?? tpl.defaultSubject);
  const [body, setBody] = useState(tpl.body ?? tpl.defaultBody);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } };
  return (
    <Dialog open onClose={onClose} title={`Şablon: ${tpl.label}`} wide>
      <div className="space-y-3">
        <p className="text-sm text-neutral-600">Kullanılabilir değişkenler: {tpl.vars.map((v) => <code key={v} className="mr-1 rounded bg-sand-100 px-1">{`{${v}}`}</code>)}. Bağlantı düğmesi otomatik eklenir.</p>
        {err && <Alert>{err}</Alert>}
        <Field label="Konu"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
        <Field label="Metin" hint="Paragrafları boş satırla ayırın. HTML kullanılamaz."><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        {preview && <div className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm"><div className="font-medium">{preview.subject}</div><pre className="mt-2 whitespace-pre-wrap font-sans text-neutral-700">{preview.text}</pre><div className="mt-2 text-xs text-neutral-500">Önizleme örnek verilerle hazırlanır.</div></div>}
        <div className="flex flex-wrap justify-end gap-2">
          {tpl.customized && <Button variant="ghost" className="text-red-600" onClick={() => run(async () => { await api(`/platform/email-templates/${tpl.name}`, { method: "DELETE" }); toast("Varsayılan metne dönüldü"); onSaved(); })}>Varsayılana dön</Button>}
          <Button variant="outline" onClick={() => run(async () => setPreview(await api(`/platform/email-templates/${tpl.name}/preview`, { method: "POST", body: { subject, body } })))}>Önizle</Button>
          <Button onClick={() => run(async () => { await api(`/platform/email-templates/${tpl.name}`, { method: "PUT", body: { subject, body } }); toast("Şablon kaydedildi"); onSaved(); })}>Kaydet</Button>
        </div>
      </div>
    </Dialog>
  );
}

function NoticeDialog({ tenants, onClose, onSent }: { tenants: { id: string; name: string }[]; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"tenant" | "status" | "all">("tenant");
  const [tenantId, setTenantId] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ recipients: number; sent: number; failed: number; skipped: number }>("/platform/emails/notice", {
        method: "POST",
        body: { subject, body, serviceNoticeConfirmed: ok, requestId, ...(mode === "tenant" ? { tenantIds: tenantId ? [tenantId] : [] } : mode === "status" ? { statuses } : {}) },
      });
      toast(`${r.sent} gönderildi${r.failed ? `, ${r.failed} başarısız` : ""}${r.skipped ? `, ${r.skipped} daha önce gönderilmişti` : ""}`, r.failed ? "red" : undefined);
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="İşletmelere bilgilendirme e-postası" wide>
      <div className="space-y-3">
        <Alert tone="amber">Yalnızca hizmetle ilgili bilgilendirme (bakım, değişiklik, hesap bildirimi) içindir. Kampanya/reklam gibi ticari iletiler İYS onayı gerektirir ve buradan gönderilmemelidir.</Alert>
        {err && <Alert>{err}</Alert>}
        <Field label="Alıcılar">
          <Select aria-label="Alıcılar" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="tenant">Tek işletme</option>
            <option value="status">Duruma göre işletmeler</option>
            <option value="all">Tüm işletmeler</option>
          </Select>
        </Field>
        {mode === "tenant" && (
          <Field label="İşletme">
            <Select aria-label="İşletme" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">Seçin</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        {mode === "status" && (
          <div className="flex flex-wrap gap-3 text-sm">
            {["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => (
              <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={statuses.includes(s)} onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s))} />{STATUS_TR[s]}</label>
            ))}
          </div>
        )}
        <Field label="Konu"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} /></Field>
        <Field label="Mesaj" hint="Her işletmenin aktif sahibine gider. Paragrafları boş satırla ayırın."><Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} />Bu ileti ticari ileti değildir; yalnızca hizmet bilgilendirmesidir.</label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button disabled={busy || !ok} onClick={send}>{busy ? "Gönderiliyor…" : "Gönder"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
