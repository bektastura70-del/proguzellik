"use client";

import { useState } from "react";
import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner, statusTone, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR } from "@/lib/format";
import { AdminSubscription, SubscriptionAdmin } from "./subscription-admin";

export const PLAN_TR: Record<string, string> = { STARTER: "Başlangıç", PROFESSIONAL: "Profesyonel", SMART: "Akıllı" };
export const INVITE_TR: Record<string, string> = {
  PENDING_DELIVERY: "Davet bekliyor (e-posta yok)",
  SENT: "Davet gönderildi",
  ACCEPTED: "Kabul edildi",
  REVOKED: "İptal edildi",
};
const inviteTone = (s: string) => (s === "SENT" ? "blue" : s === "ACCEPTED" ? "green" : s === "PENDING_DELIVERY" ? "amber" : "neutral") as "blue" | "green" | "amber" | "neutral";

export function InviteBadge({ status }: { status: string }) {
  return <Badge tone={inviteTone(status)}>{INVITE_TR[status] ?? status}</Badge>;
}

type InviteResult = { status: string; delivered: boolean; reason?: string };

const inviteToast = (r: InviteResult) => (r.delivered ? "Davet e-postası gönderildi" : (r.reason ?? "Davet bekletiliyor"));

/** Yeni güzellik merkezi + sahip daveti. */
export function NewTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title="Yeni güzellik merkezi">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setErr(null);
          setBusy(true);
          try {
            const r = await api<{ tenant: { name: string }; invite: InviteResult }>("/platform/tenants", {
              method: "POST",
              body: {
                name: f.get("name"),
                ownerName: f.get("ownerName"),
                ownerEmail: f.get("ownerEmail"),
                phone: (f.get("phone") as string) || undefined,
                planCode: f.get("planCode"),
                trialDays: Number(f.get("trialDays")),
              },
            });
            toast(`${r.tenant.name} oluşturuldu. ${inviteToast(r.invite)}`);
            onCreated();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {err && <Alert>{err}</Alert>}
        <Field label="İşletme adı"><Input name="name" required minLength={2} maxLength={120} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sahip adı soyadı"><Input name="ownerName" required minLength={2} maxLength={120} /></Field>
          <Field label="Telefon"><Input name="phone" type="tel" maxLength={30} /></Field>
        </div>
        <Field label="Sahip e-postası" hint="Hesabı oluşturması için bu adrese tek kullanımlık davet bağlantısı gider.">
          <Input name="ownerEmail" type="email" required maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paket">
            <Select name="planCode" defaultValue="PROFESSIONAL">
              {Object.entries(PLAN_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Deneme süresi (gün)"><Input name="trialDays" type="number" min={1} max={60} defaultValue={14} required /></Field>
        </div>
        <Button className="w-full" disabled={busy}>{busy ? "Oluşturuluyor…" : "Oluştur ve davet et"}</Button>
      </form>
    </Dialog>
  );
}

type Invite = { id: string; email: string; fullName: string; status: string; expiresAt: string | null; sentAt: string | null; sendCount: number; acceptedAt: string | null; createdAt: string };
type Detail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planCode: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  plan: { name: string; maxStaff: number };
  memberships: { role: string; isActive: boolean; user: { email: string; fullName: string; lastLoginAt: string | null } }[];
  invites: Invite[];
  subscriptions: AdminSubscription[];
  _count: { customers: number; staff: number; services: number };
};

const ROLE_TR: Record<string, string> = { OWNER: "Sahip", MANAGER: "Yönetici", RECEPTION: "Resepsiyon", STAFF: "Personel" };
const toDateInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10) : "");

/** İşletme detayı: bilgiler, paket/deneme, aktif/pasif, davetler. */
export function TenantDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const d = useApi<Detail>(`/platform/tenants/${id}`);
  const [suspending, setSuspending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string | ((r: never) => string)) => {
    try {
      const r = await fn();
      toast(typeof ok === "string" ? ok : ok(r as never));
      d.reload();
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "red");
      return false;
    }
  };
  const t = d.data;
  const open = t?.invites.find((i) => i.status === "PENDING_DELIVERY" || i.status === "SENT");
  const hasOwner = t?.memberships.some((m) => m.role === "OWNER" && m.isActive);

  return (
    <Dialog open onClose={onClose} title={t?.name ?? "İşletme"} wide>
      {!t ? <Spinner /> : (
        <div className="space-y-6">
          <section className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-neutral-500">Durum: </span><Badge tone={statusTone(t.status)}>{STATUS_TR[t.status]}</Badge></div>
            <div><span className="text-neutral-500">Adres: </span>/{t.slug}</div>
            <div><span className="text-neutral-500">Paket: </span>{t.plan.name} (en çok {t.plan.maxStaff} personel)</div>
            <div><span className="text-neutral-500">Deneme bitişi: </span>{t.trialEndsAt ? dateTr(t.trialEndsAt, { day: "numeric", month: "long", year: "numeric" }) : "—"}</div>
            <div><span className="text-neutral-500">Personel / müşteri / hizmet: </span>{t._count.staff} / {t._count.customers} / {t._count.services}</div>
            <div><span className="text-neutral-500">Oluşturma: </span>{dateTr(t.createdAt, { day: "numeric", month: "short", year: "numeric" })}</div>
            {t.status === "SUSPENDED" && <div className="sm:col-span-2"><Alert tone="amber">Pasif: {t.suspendedReason}</Alert></div>}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Deneme paketi ve süresi</h3>
            {t.subscriptions.some((x) => x.status === "ACTIVE" || x.status === "PAST_DUE") ? (
              <p className="text-sm text-neutral-500">Açık abonelik var; paket abonelik bölümünden atanır.</p>
            ) : (
            <form
              className="grid items-end gap-3 sm:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const trial = f.get("trialEndsAt") as string;
                await run(
                  () => api(`/platform/tenants/${t.id}`, { method: "PATCH", body: { planCode: f.get("planCode"), ...(trial ? { trialEndsAt: new Date(`${trial}T23:59:00+03:00`).toISOString() } : {}) } }),
                  "İşletme güncellendi",
                );
              }}
            >
              <Field label="Paket">
                <Select name="planCode" defaultValue={t.planCode}>{Object.entries(PLAN_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              <Field label="Deneme bitişi"><Input name="trialEndsAt" type="date" defaultValue={toDateInput(t.trialEndsAt)} /></Field>
              <Button>Kaydet</Button>
            </form>
            )}
          </section>

          <SubscriptionAdmin
            tenantId={t.id}
            subscriptions={t.subscriptions}
            onChanged={(msg) => {
              toast(msg);
              d.reload();
              onChanged();
            }}
          />

          <section>
            <h3 className="mb-2 text-sm font-semibold">Erişim</h3>
            {t.status === "SUSPENDED" ? (
              <Button variant="outline" onClick={() => run(() => api(`/platform/tenants/${t.id}/reactivate`, { method: "POST" }), "İşletme aktifleştirildi")}>Aktifleştir</Button>
            ) : suspending ? (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const reason = new FormData(e.currentTarget).get("reason");
                  if (await run(() => api(`/platform/tenants/${t.id}/suspend`, { method: "POST", body: { reason } }), "İşletme pasife alındı")) setSuspending(false);
                }}
              >
                <Field label="Pasife alma gerekçesi"><Textarea name="reason" required minLength={3} maxLength={300} rows={2} /></Field>
                <div className="flex gap-2"><Button variant="danger">Pasife al</Button><Button type="button" variant="ghost" onClick={() => setSuspending(false)}>Vazgeç</Button></div>
              </form>
            ) : (
              <Button variant="outline" onClick={() => setSuspending(true)}>Pasife al</Button>
            )}
            <p className="mt-1 text-xs text-neutral-500">Pasif işletmenin kullanıcıları panele erişemez, online randevu kapanır. Veriler silinmez.</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Kullanıcılar</h3>
            {t.memberships.length === 0 ? <p className="text-sm text-neutral-500">Henüz kullanıcı yok (davet kabul edilmedi).</p> : (
              <ul className="space-y-1 text-sm">
                {t.memberships.map((m) => (
                  <li key={m.user.email}>{m.user.fullName} · <span className="text-neutral-500">{m.user.email}</span> · {ROLE_TR[m.role]}{!m.isActive && " (pasif)"}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Sahip daveti</h3>
            {t.invites.length === 0 ? <p className="text-sm text-neutral-500">Davet yok.</p> : (
              <ul className="space-y-2 text-sm">
                {t.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <InviteBadge status={i.status} />
                    <span>{i.fullName} · <span className="text-neutral-500">{i.email}</span></span>
                    {i.status === "SENT" && i.expiresAt && <span className="text-xs text-neutral-500">son geçerlilik {dateTr(i.expiresAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                  </li>
                ))}
              </ul>
            )}
            {open && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => run(() => api<InviteResult>(`/platform/tenants/${t.id}/invite/resend`, { method: "POST" }), (r: InviteResult) => inviteToast(r))}>Daveti yeniden gönder</Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => api(`/platform/tenants/${t.id}/invite/revoke`, { method: "POST" }), "Davet iptal edildi")}>Daveti iptal et</Button>
              </div>
            )}
            {!open && !hasOwner && (inviting ? (
              <form
                className="mt-3 grid items-end gap-3 sm:grid-cols-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (await run(() => api<InviteResult>(`/platform/tenants/${t.id}/invite`, { method: "POST", body: { fullName: f.get("fullName"), email: f.get("email") } }), (r: InviteResult) => inviteToast(r))) setInviting(false);
                }}
              >
                <Field label="Ad soyad"><Input name="fullName" required minLength={2} /></Field>
                <Field label="E-posta"><Input name="email" type="email" required /></Field>
                <Button>Davet et</Button>
              </form>
            ) : (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setInviting(true)}>Yeni sahip davet et</Button>
            ))}
            <p className="mt-2 text-xs text-neutral-500">Bağlantı yalnızca e-postayla iletilir; bu panelde gösterilmez. E-posta yapılandırılmamışsa davet bekletilir.</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}
