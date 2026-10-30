"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";

export const MEMBER_ROLE_TR: Record<string, string> = { OWNER: "Sahip", MANAGER: "Yönetici", RECEPTION: "Resepsiyon", STAFF: "Personel" };
const day = (iso: string | null) => (iso ? dateTr(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");

type Membership = { id: string; role: string; isActive: boolean; tenant: { id: string; name: string; status: string } };
type UserRow = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  memberships: Membership[];
};
type UserDetail = UserRow & {
  activeSessions: number;
  openInvites: { id: string; role: string; status: string; tenant: { name: string } }[];
  audit: { id: string; action: string; createdAt: string }[];
};

const AUDIT_TR: Record<string, string> = {
  "platform.member_invited": "Davet edildi",
  "platform.member_role_changed": "Rol değiştirildi",
  "platform.member_deactivated": "İşletme erişimi kapatıldı",
  "platform.member_activated": "İşletme erişimi açıldı",
  "platform.user_deactivated": "Hesap pasifleştirildi",
  "platform.user_activated": "Hesap aktifleştirildi",
  "platform.user_password_reset_sent": "Sıfırlama bağlantısı gönderildi",
  "platform.user_mfa_reset": "2FA sıfırlandı",
  "tenant.member_invited": "İşletme tarafından davet edildi",
  "platform.user_password_reset_blocked": "Sıfırlama gönderilemedi (e-posta yok)",
  "tenant.invite_accepted": "Daveti kabul etti",
  "auth.login": "Giriş yaptı",
  "auth.login_failed": "Hatalı giriş",
  "auth.password_reset": "Parolasını sıfırladı",
  "auth.password_changed": "Parolasını değiştirdi",
};

export function UserStatusBadges({ u }: { u: Pick<UserRow, "isActive" | "locked" | "isPlatformAdmin" | "mfaEnabled" | "emailVerified"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Pasif</Badge>}
      {u.locked && <Badge tone="amber">Kilitli</Badge>}
      {u.isPlatformAdmin && <Badge tone="brand">Platform yöneticisi</Badge>}
      {u.mfaEnabled && <Badge tone="blue">2FA</Badge>}
      {!u.emailVerified && <Badge>E-posta doğrulanmadı</Badge>}
    </span>
  );
}

/** SaaS sahibi: tüm işletmelerdeki kullanıcılar (arama + filtre). */
export function UsersCard({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const take = 25;
  const qs = new URLSearchParams({
    ...(search ? { search } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(role ? { role } : {}),
    ...(status === "platform" ? { kind: "platform" } : status ? { status } : {}),
    take: String(take),
    skip: String(page * take),
  });
  const users = useApi<{ items: UserRow[]; total: number }>(`/platform/users?${qs}`);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(0);
    fn(v);
  };

  return (
    <Card className="mt-6">
      <CardHeader
        title="Kullanıcılar"
        action={
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Ara (ad, e-posta, telefon)" aria-label="Kullanıcı ara" className="h-9 w-52" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
            <Select aria-label="İşletme filtresi" className="h-9 w-44" value={tenantId} onChange={(e) => reset(setTenantId)(e.target.value)}>
              <option value="">Tüm işletmeler</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Select aria-label="Rol filtresi" className="h-9 w-36" value={role} onChange={(e) => reset(setRole)(e.target.value)}>
              <option value="">Tüm roller</option>
              {Object.entries(MEMBER_ROLE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select aria-label="Durum filtresi" className="h-9 w-36" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
              <option value="">Tüm durumlar</option>
              <option value="active">Aktif</option>
              <option value="inactive">Pasif</option>
              <option value="locked">Kilitli</option>
              <option value="platform">Platform yöneticileri</option>
            </Select>
          </div>
        }
      />
      {!users.data ? <div className="p-4"><Spinner /></div> : (
        <>
          <Table head={["Kullanıcı", "İşletme ve rol", "Durum", "Son giriş", ""]} empty="Kullanıcı bulunamadı">
            {users.data.items.map((u) => (
              <tr key={u.id}>
                <Td><div className="font-medium">{u.fullName}</div><div className="text-xs text-neutral-500">{u.email}</div></Td>
                <Td>
                  {u.memberships.length === 0 ? <span className="text-neutral-400">—</span> : u.memberships.map((m) => (
                    <div key={m.id} className={m.isActive ? "" : "text-neutral-400 line-through"}>{m.tenant.name} · {MEMBER_ROLE_TR[m.role]}</div>
                  ))}
                </Td>
                <Td><UserStatusBadges u={u} /></Td>
                <Td>{day(u.lastLoginAt)}</Td>
                <Td><Button size="sm" variant="outline" onClick={() => setDetail(u.id)}>Yönet</Button></Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm text-neutral-500">
            <span>{users.data.total} kullanıcı</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Önceki</Button>
              <Button size="sm" variant="ghost" disabled={(page + 1) * take >= users.data.total} onClick={() => setPage((p) => p + 1)}>Sonraki</Button>
            </div>
          </div>
        </>
      )}
      {detail && <UserDetailDialog id={detail} onClose={() => setDetail(null)} onChanged={() => users.reload()} />}
    </Card>
  );
}

/** Kullanıcı detayı: işletme rolleri, erişim, hesap durumu, parola sıfırlama ve geçmiş. */
export function UserDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const d = useApi<UserDetail>(`/platform/users/${id}`);
  const [deactivating, setDeactivating] = useState(false);
  const [mfaResetting, setMfaResetting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try {
      await fn();
      toast(ok);
      d.reload();
      onChanged();
      return true;
    } catch (e) {
      // Ör. e-posta yapılandırılmamışsa açıkça hata gösterilir; gönderilmiş gibi davranılmaz.
      setErr((e as Error).message);
      return false;
    }
  };
  const u = d.data;
  return (
    <Dialog open onClose={onClose} title={u?.fullName ?? "Kullanıcı"} wide>
      {!u ? <Spinner /> : (
        <div className="space-y-6">
          {err && <Alert>{err}</Alert>}
          <section className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-neutral-500">E-posta: </span>{u.email}</div>
            <div><span className="text-neutral-500">Telefon: </span>{u.phone ?? "—"}</div>
            <div className="sm:col-span-2"><UserStatusBadges u={u} /></div>
            <div><span className="text-neutral-500">Son giriş: </span>{day(u.lastLoginAt)}</div>
            <div><span className="text-neutral-500">Açık oturum: </span>{u.activeSessions}</div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">İşletmeler ve roller</h3>
            {u.memberships.length === 0 ? <p className="text-sm text-neutral-500">Bir işletmeye bağlı değil.</p> : (
              <ul className="space-y-2 text-sm">
                {u.memberships.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-40 font-medium">{m.tenant.name}</span>
                    <Select
                      aria-label={`${m.tenant.name} rolü`}
                      className="h-8 w-36"
                      value={m.role}
                      onChange={(e) => run(() => api(`/platform/memberships/${m.id}`, { method: "PATCH", body: { role: e.target.value } }), "Rol güncellendi")}
                    >
                      {Object.entries(MEMBER_ROLE_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    {m.isActive ? (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run(() => api(`/platform/memberships/${m.id}/deactivate`, { method: "POST", body: {} }), "İşletme erişimi kapatıldı")}>Erişimi kapat</Button>
                    ) : (
                      <><Badge tone="red">Erişim kapalı</Badge><Button size="sm" variant="outline" onClick={() => run(() => api(`/platform/memberships/${m.id}/activate`, { method: "POST" }), "İşletme erişimi açıldı")}>Erişimi aç</Button></>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {u.openInvites.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500">Açık davet: {u.openInvites.map((i) => `${i.tenant.name} (${MEMBER_ROLE_TR[i.role]})`).join(", ")}</p>
            )}
          </section>

          {!u.isPlatformAdmin && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Hesap</h3>
              <div className="flex flex-wrap gap-2">
                {u.isActive && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => run(() => api(`/platform/users/${u.id}/password-reset`, { method: "POST", body: {} }), "Sıfırlama bağlantısı e-postayla gönderildi")}>Parola sıfırlama bağlantısı gönder</Button>
                    <Button size="sm" variant="outline" onClick={() => run(() => api(`/platform/users/${u.id}/password-reset`, { method: "POST", body: { revokeSessions: true } }), "Bağlantı gönderildi, oturumlar kapatıldı")}>Gönder ve oturumları kapat</Button>
                  </>
                )}
                {u.isActive ? (
                  !deactivating && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeactivating(true)}>Hesabı pasifleştir</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => run(() => api(`/platform/users/${u.id}/activate`, { method: "POST" }), "Hesap aktifleştirildi")}>Hesabı aktifleştir</Button>
                )}
              </div>
              {deactivating && (
                <form
                  className="mt-3 space-y-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const reason = new FormData(e.currentTarget).get("reason");
                    if (await run(() => api(`/platform/users/${u.id}/deactivate`, { method: "POST", body: { reason } }), "Hesap pasifleştirildi, oturumlar kapatıldı")) setDeactivating(false);
                  }}
                >
                  <Field label="Pasifleştirme gerekçesi"><Textarea name="reason" required minLength={3} maxLength={300} rows={2} /></Field>
                  <div className="flex gap-2"><Button variant="danger">Pasifleştir</Button><Button type="button" variant="ghost" onClick={() => setDeactivating(false)}>Vazgeç</Button></div>
                </form>
              )}
              <p className="mt-1 text-xs text-neutral-500">Pasif hesap hiçbir işletmeye giriş yapamaz; tüm oturumlar kapanır. Veriler silinmez.</p>
              {u.mfaEnabled && (
                <div className="mt-4">
                  {!mfaResetting ? (
                    <Button size="sm" variant="outline" onClick={() => setMfaResetting(true)}>2FA'yı sıfırla</Button>
                  ) : (
                    <form
                      className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        const ok = await run(async () => {
                          const r = await api<{ notified: boolean }>(`/platform/users/${u.id}/mfa-reset`, { method: "POST", body: { password: f.get("password"), code: f.get("code"), reason: f.get("reason") } });
                          if (!r.notified) toast("2FA sıfırlandı; kullanıcıya bilgilendirme e-postası GÖNDERİLMEDİ (SMTP yok)", "red");
                        }, "2FA sıfırlandı, oturumlar kapatıldı");
                        if (ok) setMfaResetting(false);
                      }}
                    >
                      <p className="text-xs text-amber-900">Kimliği doğrulanmış kullanıcının talebiyle yapın. İşlem için kendi parolanızı ve güncel 2FA kodunuzu girin; kullanıcının tüm oturumları kapanır.</p>
                      <Field label="Sıfırlama gerekçesi"><Textarea name="reason" required minLength={5} maxLength={500} rows={2} /></Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Parolanız"><Input name="password" type="password" autoComplete="current-password" required /></Field>
                        <Field label="2FA kodunuz"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required /></Field>
                      </div>
                      <div className="flex gap-2"><Button variant="danger">2FA'yı sıfırla</Button><Button type="button" variant="ghost" onClick={() => setMfaResetting(false)}>Vazgeç</Button></div>
                    </form>
                  )}
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold">Son işlemler</h3>
            <Table head={["Tarih", "İşlem"]} empty="Kayıt yok">
              {u.audit.map((a) => (
                <tr key={a.id}><Td>{dateTr(a.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Td><Td>{AUDIT_TR[a.action] ?? a.action}</Td></tr>
              ))}
            </Table>
          </section>
        </div>
      )}
    </Dialog>
  );
}

type Invite = { id: string; email: string; fullName: string; role: string; status: string };
type InviteResult = { delivered: boolean; reason?: string };

/** İşletme detayında: yönetici/resepsiyon/personel daveti ve açık ekip davetleri. */
export function MemberInvites({ tenantId, invites, onChanged }: { tenantId: string; invites: Invite[]; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const pending = invites.filter((i) => i.role !== "OWNER" && (i.status === "SENT" || i.status === "PENDING_DELIVERY"));
  const report = (r: InviteResult, ok: string) => {
    if (r.delivered) {
      setWarn(null);
      toast(ok);
    } else {
      // Gönderilmemiş davet başarılı gibi gösterilmez.
      setWarn(r.reason ?? "Davet gönderilemedi");
      toast("Davet gönderilemedi", "red");
    }
    onChanged();
  };
  const act = async (fn: () => Promise<InviteResult | unknown>, ok: string) => {
    setErr(null);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "delivered" in r && ok !== "Davet iptal edildi") report(r as InviteResult, ok);
      else {
        toast(ok);
        onChanged();
      }
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  return (
    <div className="mt-3">
      {warn && <div className="mb-2"><Alert tone="amber">{warn}</Alert></div>}
      {pending.length > 0 && (
        <ul className="mb-2 space-y-1 text-sm">
          {pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={i.status === "SENT" ? "blue" : "amber"}>{i.status === "SENT" ? "Davet gönderildi" : "Gönderilmedi (e-posta yok)"}</Badge>
              <span>{i.fullName} · <span className="text-neutral-500">{i.email}</span> · {MEMBER_ROLE_TR[i.role]}</span>
              <Button size="sm" variant="ghost" onClick={() => act(() => api(`/platform/invites/${i.id}/resend`, { method: "POST" }), "Davet yeniden gönderildi")}>Yeniden gönder</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(() => api(`/platform/invites/${i.id}/revoke`, { method: "POST" }), "Davet iptal edildi")}>İptal</Button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <form
          className="grid items-end gap-3 sm:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await act(() => api<InviteResult>(`/platform/tenants/${tenantId}/members`, { method: "POST", body: { fullName: f.get("fullName"), email: f.get("email"), role: f.get("role") } }), "Davet e-postası gönderildi")) setOpen(false);
          }}
        >
          {err && <div className="sm:col-span-4"><Alert>{err}</Alert></div>}
          <Field label="Ad soyad"><Input name="fullName" required minLength={2} maxLength={120} /></Field>
          <Field label="E-posta"><Input name="email" type="email" required maxLength={200} /></Field>
          <Field label="Rol">
            <Select name="role" defaultValue="STAFF">
              <option value="MANAGER">Yönetici</option>
              <option value="RECEPTION">Resepsiyon</option>
              <option value="STAFF">Personel</option>
            </Select>
          </Field>
          <div className="flex gap-2"><Button>Davet et</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button></div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Kullanıcı davet et</Button>
      )}
      {err && !open && <div className="mt-2"><Alert>{err}</Alert></div>}
      <p className="mt-1 text-xs text-neutral-500">Davetli, e-postadaki tek kullanımlık bağlantıyla kendi parolasını belirler. Geçici parola üretilmez.</p>
    </div>
  );
}
