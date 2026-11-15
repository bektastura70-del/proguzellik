"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";
import { PlanOptions, usePlatformPlans } from "./plan-admin";

export type TrialApplication = {
  id: string;
  status: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED";
  businessName: string;
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  staffCount: number | null;
  planCode: string | null;
  note: string | null;
  marketingConsent: boolean;
  verifiedAt: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  tenantId: string | null;
  createdAt: string;
  tenant: { id: string; name: string; slug: string; status: string } | null;
  warnings: string[];
};
type ListResponse = { items: TrialApplication[]; counts: Partial<Record<TrialApplication["status"], number>>; page: number; pageSize: number };

const STATUS: Record<TrialApplication["status"], { label: string; tone: "amber" | "green" | "neutral" | "red" }> = {
  UNVERIFIED: { label: "E-posta doğrulanmadı", tone: "neutral" },
  PENDING: { label: "Onay bekliyor", tone: "amber" },
  APPROVED: { label: "Onaylandı", tone: "green" },
  REJECTED: { label: "Reddedildi", tone: "red" },
};
const when = (iso: string) => dateTr(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** +905321234567 → 0532 123 45 67 */
const phoneTr = (p: string) => (/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p)?.slice(1) ?? []).join(" ").replace(/^/, "0") || p;

/** Bekleyen başvuru sayısı (sekme rozeti için). */
export const usePendingApplications = () => useApi<ListResponse>("/platform/trial-applications?status=PENDING");

/** Üst çubuktaki bildirim düğmesi: onay bekleyen başvuru sayısı ve son başvurular; "Tümünü gör" Başvurular sekmesini açar. */
export function NotificationsButton({ pending, count, onOpenAll }: { pending: TrialApplication[]; count: number; onOpenAll: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={count ? `Bildirimler: ${count} onay bekleyen başvuru` : "Bildirimler"}
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-sand-200 bg-white text-neutral-700 hover:bg-sand-100"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 && <span data-testid="notifications-count" className="absolute -right-1 -top-1 inline-flex min-w-5 justify-center rounded-full bg-amber-500 px-1 text-xs font-semibold text-white">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Bildirimler" className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-sand-200 bg-white p-2 shadow-lg">
          <div className="px-2 py-1.5 text-sm font-semibold">Bildirimler</div>
          {count === 0 ? (
            <p className="px-2 pb-2 text-sm text-neutral-500">Onay bekleyen başvuru yok.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {pending.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <button type="button" className="w-full rounded-lg px-2 py-2 text-left hover:bg-sand-100" onClick={() => { setOpen(false); onOpenAll(); }}>
                    <div className="text-sm font-medium">Yeni deneme başvurusu: {a.businessName}</div>
                    <div className="text-xs text-neutral-500">{a.fullName} · {when(a.verifiedAt ?? a.createdAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="mt-1 w-full rounded-lg px-2 py-2 text-sm font-medium text-brand-700 hover:bg-sand-100" onClick={() => { setOpen(false); onOpenAll(); }}>Tüm başvuruları gör</button>
        </div>
      )}
    </div>
  );
}

/** Siteden gelen deneme başvuruları: bilgiler doldurulmuş olarak onay bekler; Onayla işletmeyi açar ve sahibine davet gönderir. */
export function TrialApplicationsCard({ onOpenTenant, onChanged }: { onOpenTenant: (id: string) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<TrialApplication["status"] | "">("PENDING");
  const [page, setPage] = useState(1);
  const list = useApi<ListResponse>(`/platform/trial-applications?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page) })}`);
  const [open, setOpen] = useState<TrialApplication | null>(null);
  const counts = list.data?.counts ?? {};
  return (
    <Card className="mt-6">
      <CardHeader
        title="Deneme başvuruları"
        description="Kayıt kapalıyken sitedeki formdan gelen ve e-postasını doğrulamış başvurular. Onayladığınızda işletme deneme sürecinde açılır ve sahibine hesabını oluşturması için davet e-postası gider."
        action={
          <Select className="h-9 w-48" aria-label="Başvuru durumu" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
            <option value="PENDING">Onay bekleyen ({counts.PENDING ?? 0})</option>
            <option value="APPROVED">Onaylanan ({counts.APPROVED ?? 0})</option>
            <option value="REJECTED">Reddedilen ({counts.REJECTED ?? 0})</option>
            <option value="">Tümü (doğrulanmış)</option>
          </Select>
        }
      />
      {!list.data ? <div className="p-6"><Spinner /></div> : (
        <Table head={["Salon", "Yetkili", "İletişim", "Paket / personel", "Başvuru", "Durum", ""]} empty={status === "PENDING" ? "Onay bekleyen başvuru yok" : "Başvuru yok"}>
          {list.data.items.map((a) => (
            <tr key={a.id} data-testid="application-row">
              <Td><div className="font-medium">{a.businessName}</div>{a.city && <div className="text-xs text-neutral-500">{a.city}</div>}</Td>
              <Td>{a.fullName}</Td>
              <Td className="text-xs"><div>{a.email}</div><div className="text-neutral-500">{phoneTr(a.phone)}</div></Td>
              <Td className="text-xs">{a.planCode ?? "—"}{a.staffCount ? ` · ${a.staffCount} personel` : ""}</Td>
              <Td className="text-xs">{when(a.verifiedAt ?? a.createdAt)}</Td>
              <Td>
                <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                {a.warnings.length > 0 && <div className="mt-1 text-xs text-amber-700">⚠ {a.warnings.length} uyarı</div>}
              </Td>
              <Td>
                {a.status === "APPROVED" && a.tenant ? (
                  <Button size="sm" variant="ghost" onClick={() => onOpenTenant(a.tenant!.id)}>İşletmeyi aç</Button>
                ) : (
                  <Button size="sm" variant={a.status === "PENDING" ? "default" : "ghost"} onClick={() => setOpen(a)}>{a.status === "PENDING" ? "İncele" : "Ayrıntı"}</Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {(page > 1 || (list.data?.items.length ?? 0) >= (list.data?.pageSize ?? Infinity)) && (
        <div className="flex items-center justify-end gap-2 border-t border-sand-100 px-4 py-3 text-sm">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Önceki</Button>
          <span className="text-neutral-500">Sayfa {page}</span>
          <Button size="sm" variant="outline" disabled={(list.data?.items.length ?? 0) < (list.data?.pageSize ?? 0)} onClick={() => setPage(page + 1)}>Sonraki</Button>
        </div>
      )}
      {open && (
        <ApplicationDialog
          app={open}
          onClose={() => setOpen(null)}
          onDone={(tenantId) => { setOpen(null); list.reload(); onChanged(); if (tenantId) onOpenTenant(tenantId); }}
        />
      )}
    </Card>
  );
}

function ApplicationDialog({ app, onClose, onDone }: { app: TrialApplication; onClose: () => void; onDone: (tenantId?: string) => void }) {
  const toast = useToast();
  const plans = usePlatformPlans();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [ack, setAck] = useState(false);
  const pending = app.status === "PENDING";

  async function approve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ tenant: { id: string; name: string }; invite: { delivered: boolean; reason?: string } }>(`/platform/trial-applications/${app.id}/approve`, {
        method: "POST",
        body: {
          name: f.get("name"),
          ownerName: f.get("ownerName"),
          ownerEmail: f.get("ownerEmail"),
          phone: (f.get("phone") as string) || undefined,
          planCode: f.get("planCode"),
          trialDays: Number(f.get("trialDays")),
          ignoreWarnings: app.warnings.length > 0 ? ack : undefined,
        },
      });
      if (r.invite.delivered) toast(`${r.tenant.name} açıldı; sahibine davet e-postası gönderildi.`);
      else toast(`${r.tenant.name} açıldı, ancak davet gönderilmedi: ${r.invite.reason ?? "e-posta iletilemedi"}`, "red");
      onDone(r.tenant.id);
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setAck(false);
    } finally {
      setBusy(false);
    }
  }

  async function reject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErr(null);
    setBusy(true);
    try {
      await api(`/platform/trial-applications/${app.id}/reject`, { method: "POST", body: { reason: f.get("reason") } });
      toast("Başvuru reddedildi");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={pending ? "Deneme başvurusunu onayla" : "Deneme başvurusu"}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-sand-50 p-3 text-sm">
          <dt className="text-neutral-500">Başvuru</dt><dd>{when(app.createdAt)}{app.verifiedAt ? ` · doğrulandı ${when(app.verifiedAt)}` : ""}</dd>
          {app.city && <><dt className="text-neutral-500">Şehir</dt><dd>{app.city}</dd></>}
          {app.staffCount && <><dt className="text-neutral-500">Personel</dt><dd>{app.staffCount}</dd></>}
          <dt className="text-neutral-500">Ticari ileti</dt><dd>{app.marketingConsent ? "İzin verdi" : "İzin vermedi"}</dd>
          {app.note && <><dt className="text-neutral-500">Not</dt><dd className="whitespace-pre-wrap">{app.note}</dd></>}
          {app.status === "REJECTED" && <><dt className="text-neutral-500">Ret gerekçesi</dt><dd>{app.rejectReason}</dd></>}
        </dl>
        {pending && app.warnings.length > 0 && (
          <Alert tone="amber">
            <ul className="list-disc space-y-1 pl-4">{app.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-brand-600" />
              Kontrol ettim, yine de onayla
            </label>
          </Alert>
        )}
        {pending && !rejecting && (
          <form className="space-y-4" onSubmit={approve}>
            <p className="text-sm text-neutral-600">Bilgiler başvurudan dolduruldu; gerekirse düzeltin.</p>
            <Field label="İşletme adı"><Input name="name" required minLength={2} maxLength={120} defaultValue={app.businessName} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sahip adı soyadı"><Input name="ownerName" required minLength={2} maxLength={120} defaultValue={app.fullName} /></Field>
              <Field label="Telefon"><Input name="phone" type="tel" maxLength={30} defaultValue={phoneTr(app.phone)} /></Field>
            </div>
            <Field label="Sahip e-postası" hint="Hesabını oluşturması için bu adrese tek kullanımlık davet bağlantısı gider.">
              <Input name="ownerEmail" type="email" required maxLength={200} defaultValue={app.email} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paket">
                <Select name="planCode" defaultValue={app.planCode ?? "PROFESSIONAL"} key={plans.data ? "loaded" : "loading"}>
                  <PlanOptions plans={plans.data} current={app.planCode ?? undefined} />
                </Select>
              </Field>
              <Field label="Deneme süresi (gün)"><Input name="trialDays" type="number" min={1} max={60} defaultValue={7} required /></Field>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" disabled={busy || (app.warnings.length > 0 && !ack)}>{busy ? "Açılıyor…" : "Onayla ve davet gönder"}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setErr(null); setRejecting(true); }}>Reddet</Button>
            </div>
          </form>
        )}
        {pending && rejecting && (
          <form className="space-y-4" onSubmit={reject}>
            <Field label="Ret gerekçesi" hint="Yalnızca kayıtlarda tutulur; başvurana otomatik e-posta gitmez.">
              <Textarea name="reason" required minLength={3} maxLength={300} rows={3} />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" variant="danger" disabled={busy}>{busy ? "Kaydediliyor…" : "Başvuruyu reddet"}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRejecting(false)}>Vazgeç</Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
