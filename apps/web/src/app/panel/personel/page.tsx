"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { Service, Staff } from "@/components/panel/types";
import { Alert, Badge, Button, Card, CardBody, Dialog, Field, Input, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { hhmmToMinutes, minutesToHHMM, WEEKDAYS } from "@/lib/format";

type Member = { id: string; role: string; user: { id: string; fullName: string; email: string } };

export default function StaffPage() {
  const staff = useApi<Staff[]>("/staff?includeInactive=true");
  const services = useApi<Service[]>("/services");
  const [edit, setEdit] = useState<Staff | "new" | null>(null);
  const [hours, setHours] = useState<Staff | null>(null);

  return (
    <>
      <PageHeader title="Personel" description="Uzmanlar, verdikleri hizmetler, çalışma saatleri ve prim oranları" action={<Button onClick={() => setEdit("new")}><Plus /> Personel</Button>} />
      {staff.loading ? <Spinner /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {staff.data?.map((s) => (
            <Card key={s.id} className={s.isActive ? "" : "opacity-60"}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-full text-lg font-semibold text-white" style={{ background: s.color ?? "#b0507b" }}>{s.displayName[0]}</span>
                    <div>
                      <div className="font-semibold">{s.displayName}</div>
                      <div className="text-sm text-neutral-500">{s.title ?? "Uzman"}</div>
                    </div>
                  </div>
                  <Badge tone={s.isActive ? "green" : "neutral"}>{s.isActive ? "Aktif" : "Pasif"}</Badge>
                </div>
                <div className="mt-4 space-y-1 text-sm text-neutral-600">
                  <div>Prim oranı: %{Number(s.commissionRate)} hizmet · %{Number(s.productCommissionRate ?? 0)} ürün</div>
                  <div>Hizmetler: {s.services.length ? s.services.map((x) => services.data?.find((v) => v.id === x.serviceId)?.name).filter(Boolean).join(", ") : "—"}</div>
                  <div>Çalışma: {s.workingHours.length ? [...new Set(s.workingHours.map((h) => WEEKDAYS[h.weekday].slice(0, 3)))].join(", ") : "tanımlı değil"}</div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEdit(s)}>Düzenle</Button>
                  <Button size="sm" variant="outline" onClick={() => setHours(s)}>Çalışma saatleri</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {edit && <StaffForm initial={edit === "new" ? undefined : edit} services={services.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); staff.reload(); }} />}
      {hours && <HoursForm staff={hours} onClose={() => setHours(null)} onSaved={() => { setHours(null); staff.reload(); }} />}
    </>
  );
}

function StaffForm({ initial, services, onClose, onSaved }: { initial?: Staff; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const team = useApi<Member[]>("/team");
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initial?.services.map((s) => s.serviceId) ?? []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      displayName: f.get("displayName"), title: (f.get("title") as string) || undefined, phone: (f.get("phone") as string) || undefined,
      color: f.get("color"), commissionRate: Number(f.get("commissionRate") || 0), productCommissionRate: Number(f.get("productCommissionRate") || 0), isActive: f.get("isActive") === "on",
      onlineBookable: f.get("onlineBookable") === "on", userId: (f.get("userId") as string) || null,
    };
    try {
      const s = await api<Staff>(initial ? `/staff/${initial.id}` : "/staff", { method: initial ? "PATCH" : "POST", body });
      await api(`/staff/${s.id}/services`, { method: "PUT", body: { serviceIds: selected } });
      toast("Personel kaydedildi");
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Dialog open onClose={onClose} title={initial ? "Personeli düzenle" : "Yeni personel"} wide>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Görünen ad"><Input name="displayName" required defaultValue={initial?.displayName} /></Field>
          <Field label="Unvan"><Input name="title" placeholder="Cilt bakım uzmanı" defaultValue={initial?.title ?? ""} /></Field>
          <Field label="Telefon"><Input name="phone" type="tel" defaultValue={initial?.phone ?? ""} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hizmet primi %"><Input name="commissionRate" type="number" min={0} max={100} step="0.5" defaultValue={initial ? Number(initial.commissionRate) : 0} /></Field>
            <Field label="Ürün primi %"><Input name="productCommissionRate" type="number" min={0} max={100} step="0.5" defaultValue={initial ? Number(initial.productCommissionRate ?? 0) : 0} /></Field>
            <Field label="Renk"><Input name="color" type="color" defaultValue={initial?.color ?? "#b0507b"} className="p-1" /></Field>
          </div>
        </div>
        <Field label="Panel hesabı" hint="Personel kendi randevularını görüp tamamlayabilsin diye ekip üyesiyle eşleştirin.">
          <Select name="userId" defaultValue={initial?.userId ?? ""}>
            <option value="">Bağlı hesap yok</option>
            {team.data?.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.fullName} ({m.user.email})</option>)}
          </Select>
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium">Verdiği hizmetler</p>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${selected.includes(s.id) ? "border-brand-600 bg-brand-600 text-white" : "border-sand-300"}`}>
                <input type="checkbox" className="sr-only" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="accent-brand-600" /> Aktif (paket personel sınırına sayılır)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="onlineBookable" defaultChecked={initial?.onlineBookable ?? true} className="accent-brand-600" /> Online randevuda görünsün</label>
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}

function HoursForm({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState(() =>
    [1, 2, 3, 4, 5, 6, 0].map((wd) => {
      const h = staff.workingHours.find((x) => x.weekday === wd);
      return { weekday: wd, on: !!h, start: h ? minutesToHHMM(h.startMin) : "09:00", end: h ? minutesToHHMM(h.endMin) : "19:00" };
    }),
  );
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={`${staff.displayName} · çalışma saatleri`}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.weekday} className="flex items-center gap-2">
            <label className="flex w-32 items-center gap-2 text-sm">
              <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} className="accent-brand-600" />
              {WEEKDAYS[r.weekday]}
            </label>
            <Input type="time" disabled={!r.on} value={r.start} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
            <span>–</span>
            <Input type="time" disabled={!r.on} value={r.end} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          </div>
        ))}
      </div>
      <Button className="mt-5 w-full" onClick={async () => {
        try {
          await api(`/staff/${staff.id}/working-hours`, { method: "PUT", body: { hours: rows.filter((r) => r.on).map((r) => ({ weekday: r.weekday, startMin: hhmmToMinutes(r.start), endMin: hhmmToMinutes(r.end) })) } });
          toast("Çalışma saatleri kaydedildi");
          onSaved();
        } catch (e) { setErr((e as Error).message); }
      }}>Kaydet</Button>
    </Dialog>
  );
}
