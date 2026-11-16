"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { ROLE_TR } from "@/lib/format";
import { SalonListingCard } from "@/components/panel/salon-listing-card";

type Settings = { name: string; slug: string; phone: string | null; email: string | null; address: string | null; timezone: string; onlineBookingEnabled: boolean; requireMfa: boolean; packageReminderDays: number; renewalRemindersEnabled: boolean; lowStockEmailEnabled?: boolean; features?: { renewalReminders: boolean } };
type TeamInvite = { id: string; email: string; fullName: string; role: string; status: "PENDING_DELIVERY" | "SENT"; expiresAt: string | null; sentAt: string | null };
type InviteResult = { delivered: boolean; reason?: string };
type Member = { id: string; role: string; isActive: boolean; user: { id: string; fullName: string; email: string } };

export default function SettingsPage() {
  const { can, me, has } = useSession();
  const toast = useToast();
  const settings = useApi<Settings>("/settings");
  const team = useApi<Member[]>("/team");
  const [inviting, setInviting] = useState(false);
  const invites = useApi<TeamInvite[]>("/team/invites");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const inviteNotice = (r: InviteResult) => {
    if (r.delivered) toast("Davet e-postası gönderildi");
    else toast(r.reason ?? "Davet GÖNDERİLMEDİ", "red");
  };

  if (!settings.data) return <Spinner />;
  const s = settings.data;
  return (
    <>
      <PageHeader title="Ayarlar" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="İşletme bilgileri" action={<Link href="/panel/baslangic" className="text-sm text-brand-700 underline">Kurulum sihirbazı</Link>} />
          <CardBody>
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api("/settings", { method: "PATCH", body: { name: f.get("name"), phone: (f.get("phone") as string) || undefined, email: (f.get("email") as string) || undefined, address: (f.get("address") as string) || undefined, onlineBookingEnabled: f.get("online") === "on", packageReminderDays: Number(f.get("packageReminderDays")) || undefined } });
                toast("Ayarlar kaydedildi"); settings.reload();
              } catch (err) { toast((err as Error).message, "red"); }
            }}>
              <Field label="Salon adı"><Input name="name" defaultValue={s.name} required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefon"><Input name="phone" defaultValue={s.phone ?? ""} /></Field>
                <Field label="E-posta"><Input name="email" type="email" defaultValue={s.email ?? ""} /></Field>
              </div>
              <Field label="Adres"><Input name="address" defaultValue={s.address ?? ""} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="online" defaultChecked={s.onlineBookingEnabled} className="accent-brand-600" /> Online randevu sayfası açık</label>
              <p className="text-xs text-neutral-500">Online randevu adresi: /r/{s.slug}</p>
              <Field label="Paket bitiş hatırlatması (gün önce)" hint="WhatsApp bağlıysa süreli paketi bitmek üzere olan ve seansı kalan müşteriye mesaj planlanır."><Input name="packageReminderDays" type="number" min={1} max={60} defaultValue={s.packageReminderDays} /></Field>
              <Button>Kaydet</Button>
            </form>
          </CardBody>
        </Card>
        {s.features?.renewalReminders && (
          <Card>
            <CardHeader title="Yenilenme hatırlatması" description="Tekrar süresi tanımlı hizmetlerde, süre dolmadan müşteriye uygulama bildirimi ve e-posta gönderilir." />
            <CardBody className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={s.renewalRemindersEnabled} className="accent-brand-600" onChange={async (e) => {
                  const next = e.target.checked;
                  settings.setData({ ...s, renewalRemindersEnabled: next });
                  try {
                    await api("/settings", { method: "PATCH", body: { renewalRemindersEnabled: next } });
                    toast(next ? "Yenilenme hatırlatması açıldı" : "Yenilenme hatırlatması kapatıldı");
                  } catch (err) {
                    settings.setData({ ...s, renewalRemindersEnabled: !next });
                    toast((err as Error).message, "red");
                  }
                }} />
                Müşterilere yenilenme hatırlatması gönder
              </label>
              <p className="text-neutral-500">Yalnızca ticari ileti (kampanya) izni olan ve hatırlatmaları kapatmamış müşterilere gider. Gün ayarları Hizmetler sayfasında yapılır. Müşteri zaten randevu aldıysa hatırlatma gönderilmez.</p>
            </CardBody>
          </Card>
        )}
        {has("STOCK") && (
          <Card>
            <CardHeader title="Kritik stok uyarısı" description="Kritik seviyeye düşen ürünler işletme sahibi ve yöneticilere e-postayla bildirilir." />
            <CardBody className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={s.lowStockEmailEnabled ?? true} className="accent-brand-600" onChange={async (e) => {
                  const next = e.target.checked;
                  settings.setData({ ...s, lowStockEmailEnabled: next });
                  try {
                    await api("/settings", { method: "PATCH", body: { lowStockEmailEnabled: next } });
                    toast(next ? "Kritik stok e-postası açıldı" : "Kritik stok e-postası kapatıldı");
                  } catch (err) {
                    settings.setData({ ...s, lowStockEmailEnabled: !next });
                    toast((err as Error).message, "red");
                  }
                }} />
                Kritik stok e-postası gönder
              </label>
              <p className="text-neutral-500">Günde bir kez kontrol edilir. Yeni bir ürün kritik seviyeye düştüğünde e-posta gider; liste değişmezse haftada bir hatırlatılır. Kritik seviye, ürün düzenlenirken girilir.</p>
            </CardBody>
          </Card>
        )}
        {can("OWNER") && (
          <Card>
            <CardHeader title="Güvenlik politikası" description="İşletme sahibi ve yöneticiler için iki adımlı doğrulamayı zorunlu kılın." />
            <CardBody className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={s.requireMfa} className="accent-brand-600" onChange={async (e) => {
                  const next = e.target.checked;
                  settings.setData({ ...s, requireMfa: next });
                  try {
                    await api("/settings", { method: "PATCH", body: { requireMfa: next } });
                    toast(next ? "2FA zorunluluğu açıldı" : "2FA zorunluluğu kapatıldı");
                  } catch (err) {
                    settings.setData({ ...s, requireMfa: !next });
                    toast((err as Error).message, "red");
                  }
                }} />
                Sahip ve yöneticiler için 2FA zorunlu
              </label>
              <p className="text-xs text-neutral-500">Açmadan önce kendi hesabınızda 2FA'yı etkinleştirip 2FA ile giriş yapmış olmalısınız. <Link className="text-brand-700" href="/guvenlik">Hesap güvenliği</Link></p>
            </CardBody>
          </Card>
        )}
        {can("OWNER", "MANAGER") && (
          <div className="lg:col-span-2">
            <SalonListingCard canEdit={can("OWNER")} />
          </div>
        )}
        <Card>
          <CardHeader title="Ekip ve yetkiler" action={<Button size="sm" onClick={() => setInviting(true)}>Kullanıcı davet et</Button>} />
          {team.loading ? <div className="p-6"><Spinner /></div> : (
            <Table head={["Kişi", "Rol", ""]}>
              {team.data?.map((m) => (
                <tr key={m.id}>
                  <Td><div className="font-medium">{m.user.fullName}</div><div className="text-xs text-neutral-500">{m.user.email}</div></Td>
                  <Td>
                    {m.user.id === me?.id ? <Badge tone="brand">{ROLE_TR[m.role]}</Badge> : (
                      <Select className="h-8 w-36 text-xs" defaultValue={m.role} disabled={m.role === "OWNER" && !can("OWNER")} onChange={async (e) => {
                        try { await api(`/team/${m.id}`, { method: "PATCH", body: { role: e.target.value } }); toast("Rol güncellendi"); } catch (err) { toast((err as Error).message, "red"); team.reload(); }
                      }}>
                        {Object.entries(ROLE_TR).filter(([k]) => k !== "OWNER" || can("OWNER")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    )}
                  </Td>
                  <Td className="text-right">
                    {m.user.id !== me?.id && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await api(`/team/${m.id}`, { method: "PATCH", body: { isActive: !m.isActive } }); team.reload(); } catch (err) { toast((err as Error).message, "red"); }
                      }}>{m.isActive ? "Devre dışı bırak" : "Etkinleştir"}</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {(invites.data?.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader title="Bekleyen davetler" />
          <Table head={["Kişi", "Rol", "Durum", ""]}>
            {invites.data!.map((i) => (
              <tr key={i.id}>
                <Td><div className="font-medium">{i.fullName}</div><div className="text-xs text-neutral-500">{i.email}</div></Td>
                <Td>{ROLE_TR[i.role]}</Td>
                <Td>{i.status === "SENT"
                  ? <Badge tone="brand">Gönderildi{i.expiresAt ? ` · ${new Date(i.expiresAt).toLocaleDateString("tr-TR")} tarihine kadar` : ""}</Badge>
                  : <Badge tone="red">Gönderilmedi</Badge>}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try { inviteNotice(await api<InviteResult>(`/team/invites/${i.id}/resend`, { method: "POST" })); invites.reload(); } catch (err) { toast((err as Error).message, "red"); }
                  }}>Tekrar gönder</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try { await api(`/team/invites/${i.id}/revoke`, { method: "POST" }); toast("Davet iptal edildi"); invites.reload(); } catch (err) { toast((err as Error).message, "red"); }
                  }}>İptal et</Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {inviting && (
        <Dialog open onClose={() => { setInviting(false); setInviteError(null); }} title="Ekibe kullanıcı davet et">
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setInviteError(null);
            try {
              const r = await api<InviteResult>("/team", { method: "POST", body: { fullName: f.get("fullName"), email: f.get("email"), role: f.get("role") } });
              invites.reload();
              inviteNotice(r);
              if (r.delivered) setInviting(false);
              else setInviteError(r.reason ?? "Davet GÖNDERİLMEDİ");
            } catch (err) { setInviteError((err as Error).message); }
          }}>
            <p className="text-sm text-neutral-600">Kişiye süreli ve tek kullanımlık bir davet bağlantısı e-postayla gönderilir; parolasını kendisi belirler.</p>
            {inviteError && <Alert tone="red">{inviteError}</Alert>}
            <Field label="Ad soyad"><Input name="fullName" required /></Field>
            <Field label="E-posta"><Input name="email" type="email" required /></Field>
            <Field label="Rol"><Select name="role" defaultValue="STAFF">{Object.entries(ROLE_TR).filter(([k]) => k !== "OWNER").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Button className="w-full">Davet gönder</Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
