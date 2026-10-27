"use client";

import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { ROLE_TR } from "@/lib/format";

type Settings = { name: string; slug: string; phone: string | null; email: string | null; address: string | null; timezone: string; onlineBookingEnabled: boolean };
type Member = { id: string; role: string; isActive: boolean; user: { id: string; fullName: string; email: string } };

export default function SettingsPage() {
  const { can, me } = useSession();
  const toast = useToast();
  const settings = useApi<Settings>("/settings");
  const team = useApi<Member[]>("/team");
  const [inviting, setInviting] = useState(false);
  const [tempPw, setTempPw] = useState<string | null>(null);

  if (!settings.data) return <Spinner />;
  const s = settings.data;
  return (
    <>
      <PageHeader title="Ayarlar" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="İşletme bilgileri" />
          <CardBody>
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api("/settings", { method: "PATCH", body: { name: f.get("name"), phone: (f.get("phone") as string) || undefined, email: (f.get("email") as string) || undefined, address: (f.get("address") as string) || undefined, onlineBookingEnabled: f.get("online") === "on" } });
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
              <Button>Kaydet</Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ekip ve yetkiler" action={<Button size="sm" onClick={() => setInviting(true)}>Kullanıcı ekle</Button>} />
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
      {inviting && (
        <Dialog open onClose={() => { setInviting(false); setTempPw(null); }} title="Ekibe kullanıcı ekle">
          {tempPw ? (
            <div className="space-y-3">
              <Alert tone="green">Kullanıcı oluşturuldu. Geçici parolayı kişiye güvenli bir kanaldan iletin; ilk girişte değiştirmesini isteyin.</Alert>
              <code className="block rounded-lg bg-sand-100 px-3 py-2 text-sm">{tempPw}</code>
              <Button className="w-full" onClick={() => { setInviting(false); setTempPw(null); }}>Tamam</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await api<{ temporaryPassword?: string }>("/team", { method: "POST", body: { fullName: f.get("fullName"), email: f.get("email"), role: f.get("role") } });
                team.reload();
                if (r.temporaryPassword) setTempPw(r.temporaryPassword); else { toast("Mevcut kullanıcı ekibe eklendi"); setInviting(false); }
              } catch (err) { toast((err as Error).message, "red"); }
            }}>
              <Field label="Ad soyad"><Input name="fullName" required /></Field>
              <Field label="E-posta"><Input name="email" type="email" required /></Field>
              <Field label="Rol"><Select name="role" defaultValue="STAFF">{Object.entries(ROLE_TR).filter(([k]) => k !== "OWNER" || can("OWNER")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Button className="w-full">Ekle</Button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
