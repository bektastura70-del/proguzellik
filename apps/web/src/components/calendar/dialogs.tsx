"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CustomerPicker } from "@/components/panel/customer-picker";
import { useSession } from "@/components/panel/session";
import type { Appointment, Customer, Service, Staff } from "@/components/panel/types";
import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner, Textarea, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, isoDay, istanbulToIso, METHOD_TR, STATUS_TR, timeTr, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimeOff } from "./shared";

type Slot = { staffId: string; staffName: string; startsAt: string };

/** Hızlı randevu: hizmet+personel+tarih seçilince boş saatler önerilir. */
export function NewAppointment({ preset, staff, onClose, onDone }: { preset: { staffId?: string; date?: string; time?: string }; staff: Staff[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const services = useApi<Service[]>("/services");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState(preset.staffId ?? "");
  const [date, setDate] = useState(preset.date ?? isoDay());
  const [time, setTime] = useState(preset.time ?? "");
  const [pkgId, setPkgId] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const pkgs = useApi<{ id: string; name: string; serviceId: string; status: string; usedSessions: number; totalSessions: number }[]>(customer ? `/customers/${customer.id}/packages` : null, [customer?.id]);
  const eligibleStaff = useMemo(() => staff.filter((s) => !serviceId || s.services.some((x) => x.serviceId === serviceId)), [staff, serviceId]);
  const usablePkgs = (pkgs.data ?? []).filter((p) => p.status === "ACTIVE" && p.serviceId === serviceId && p.usedSessions < p.totalSessions);

  useEffect(() => {
    if (!serviceId || !date) return setSlots(null);
    setSlots(null);
    const q = new URLSearchParams({ date, serviceId, ...(staffId ? { staffId } : {}) });
    api<Slot[]>(`/availability?${q}`).then(setSlots).catch(() => setSlots([]));
  }, [serviceId, staffId, date]);

  const staffSlots = (slots ?? []).filter((s) => !staffId || s.staffId === staffId);
  const uniqueTimes = [...new Map(staffSlots.map((s) => [timeTr(s.startsAt), s])).values()];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!customer) return setErr("Müşteri seçin");
    if (!time) return setErr("Saat seçin");
    let chosenStaff = staffId;
    if (!chosenStaff) {
      chosenStaff = staffSlots.find((s) => timeTr(s.startsAt) === time)?.staffId ?? "";
      if (!chosenStaff) return setErr("Personel seçin");
    }
    setBusy(true);
    try {
      await api("/appointments", {
        method: "POST",
        body: { customerId: customer.id, serviceId, staffId: chosenStaff, startsAt: istanbulToIso(date, time), notes: notes || undefined, customerPackageId: pkgId || undefined, ignoreSchedule: force || undefined },
      });
      toast("Randevu oluşturuldu");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Yeni randevu" wide>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Müşteri"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hizmet">
            <Select required value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPkgId(""); }}>
              <option value="">Seçin</option>
              {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} dk · {tl(s.price)}</option>)}
            </Select>
          </Field>
          <Field label="Personel">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Uygun olan herhangi biri</option>
              {eligibleStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Tarih"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Saat"><Input type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        {serviceId && (
          <div>
            <p className="mb-2 text-sm font-medium">Boş saatler</p>
            {slots === null ? <Spinner /> : uniqueTimes.length === 0 ? (
              <p className="text-sm text-neutral-500">Bu gün için uygun boş saat yok.</p>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" data-testid="slot-list">
                {uniqueTimes.map((s) => {
                  const t = timeTr(s.startsAt);
                  return (
                    <button type="button" key={t} onClick={() => setTime(t)} className={cn("rounded-lg border px-2.5 py-1 text-xs", time === t ? "border-brand-600 bg-brand-600 text-white" : "border-sand-300 hover:border-brand-400")}>
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {usablePkgs.length > 0 && (
          <Field label="Paketten düş" hint="Seçerseniz randevu ücretsiz olur, tamamlanınca seans düşer.">
            <Select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
              <option value="">Paket kullanma</option>
              {usablePkgs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.totalSessions - p.usedSessions} seans kaldı)</option>)}
            </Select>
          </Field>
        )}
        <Field label="Not"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        {can("OWNER", "MANAGER") && (
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-brand-600" /> Çalışma saati dışına yine de ekle (çakışma kontrolü sürer)
          </label>
        )}
        <Button className="w-full" disabled={busy}>{busy ? "Kaydediliyor…" : "Randevuyu kaydet"}</Button>
      </form>
    </Dialog>
  );
}

export function TimeOffDialog({ value, staff, onClose, onDone }: { value: { staffId?: string; date?: string } | TimeOff; staff: Staff[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  if ("id" in value) {
    return (
      <Dialog open onClose={onClose} title="İzin / blok">
        <div className="space-y-2 text-sm">
          <p><b>{value.staff.displayName}</b></p>
          <p>{dateTr(value.startsAt, { day: "numeric", month: "long" })} {timeTr(value.startsAt)} – {dateTr(value.endsAt, { day: "numeric", month: "long" })} {timeTr(value.endsAt)}</p>
          {value.reason && <p className="text-neutral-600">{value.reason}</p>}
        </div>
        {err && <div className="mt-3"><Alert>{err}</Alert></div>}
        <Button variant="danger" className="mt-5 w-full" onClick={async () => {
          try {
            await api(`/staff/${value.staff.id}/time-off/${value.id}`, { method: "DELETE" });
            toast("İzin kaldırıldı");
            onDone();
          } catch (e) { setErr((e as Error).message); }
        }}>İzni kaldır</Button>
      </Dialog>
    );
  }
  const d = value.date ?? isoDay();
  return (
    <Dialog open onClose={onClose} title="İzin / blok ekle">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setErr(null);
        const allDay = f.get("allDay") === "on";
        const startDay = f.get("startDay") as string;
        const endDay = (f.get("endDay") as string) || startDay;
        const startsAt = istanbulToIso(startDay, allDay ? "00:00" : (f.get("start") as string));
        const endsAt = allDay ? istanbulToIso(endDay, "23:59") : istanbulToIso(endDay, f.get("end") as string);
        try {
          await api(`/staff/${f.get("staffId")}/time-off`, { method: "POST", body: { startsAt, endsAt, reason: (f.get("reason") as string) || undefined } });
          toast("İzin eklendi");
          onDone();
        } catch (e) { setErr((e as Error).message); }
      }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Personel">
          <Select name="staffId" required defaultValue={value.staffId ?? ""}>
            <option value="">Seçin</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Başlangıç günü"><Input name="startDay" type="date" required defaultValue={d} /></Field>
          <Field label="Bitiş günü"><Input name="endDay" type="date" defaultValue={d} /></Field>
          <Field label="Başlangıç saati"><Input name="start" type="time" defaultValue="12:00" /></Field>
          <Field label="Bitiş saati"><Input name="end" type="time" defaultValue="13:00" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allDay" className="accent-brand-600" /> Tüm gün</label>
        <Field label="Sebep"><Input name="reason" placeholder="Yıllık izin, eğitim, öğle arası…" maxLength={200} /></Field>
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}

export function AppointmentDetail({ appt, staff, onClose, onChange }: { appt: Appointment; staff: Staff[]; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "pay" | "edit" | "cancel">("view");
  const desk = can("OWNER", "MANAGER", "RECEPTION");
  const open = appt.status === "BOOKED" || appt.status === "CONFIRMED";

  async function status(s: string, reason?: string) {
    setErr(null);
    try {
      await api(`/appointments/${appt.id}/status`, { method: "POST", body: { status: s, reason } });
      toast(`Durum: ${STATUS_TR[s]}`);
      if (s === "COMPLETED" && Number(appt.price) > 0 && desk) setMode("pay");
      else onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Dialog open onClose={mode === "pay" ? onChange : onClose} title={mode === "pay" ? "Tahsilat" : mode === "edit" ? "Randevuyu düzenle" : mode === "cancel" ? "Randevuyu iptal et" : "Randevu"}>
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {mode === "pay" && (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api("/finance/payments", { method: "POST", body: { customerId: appt.customer.id, appointmentId: appt.id, amount: Number(f.get("amount")), method: f.get("method") } });
            toast("Tahsilat kaydedildi");
            onChange();
          } catch (e) { setErr((e as Error).message); }
        }}>
          <p className="text-sm text-neutral-600">{appt.customer.firstName} {appt.customer.lastName} · {appt.service.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tutar (₺)"><Input name="amount" type="number" step="0.01" min="0.01" defaultValue={Number(appt.price)} required /></Field>
            <Field label="Yöntem"><Select name="method" defaultValue="CARD">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1">Tahsil et</Button>
            <Button type="button" variant="outline" onClick={onChange}>Sonra</Button>
          </div>
        </form>
      )}
      {mode === "edit" && (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const body: Record<string, unknown> = { startsAt: istanbulToIso(f.get("date") as string, f.get("time") as string), notes: f.get("notes") as string };
          if (f.get("staffId") !== appt.staff.id) body.staffId = f.get("staffId");
          if (can("OWNER", "MANAGER") && !appt.customerPackageId && Number(f.get("price")) !== Number(appt.price)) body.price = Number(f.get("price"));
          if (f.get("force") === "on") body.ignoreSchedule = true;
          try {
            await api(`/appointments/${appt.id}`, { method: "PATCH", body });
            toast("Randevu güncellendi");
            onChange();
          } catch (e) { setErr((e as Error).message); }
        }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tarih"><Input name="date" type="date" required defaultValue={isoDay(new Date(appt.startsAt))} /></Field>
            <Field label="Saat"><Input name="time" type="time" step={300} required defaultValue={timeTr(appt.startsAt)} /></Field>
          </div>
          <Field label="Personel">
            <Select name="staffId" defaultValue={appt.staff.id}>
              {staff.filter((s) => s.services.some((x) => x.serviceId === appt.service.id)).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
          {can("OWNER", "MANAGER") && !appt.customerPackageId && <Field label="Fiyat (₺)"><Input name="price" type="number" step="0.01" min={0} defaultValue={Number(appt.price)} /></Field>}
          <Field label="Not"><Textarea name="notes" defaultValue={appt.notes ?? ""} maxLength={1000} /></Field>
          {can("OWNER", "MANAGER") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" className="accent-brand-600" /> Çalışma saati dışına izin ver</label>}
          <div className="flex gap-2">
            <Button className="flex-1">Kaydet</Button>
            <Button type="button" variant="outline" onClick={() => setMode("view")}>Vazgeç</Button>
          </div>
        </form>
      )}
      {mode === "cancel" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); status("CANCELLED", (new FormData(e.currentTarget).get("reason") as string) || undefined); }}>
          <p className="text-sm text-neutral-600">Müşteriye WhatsApp iptal bildirimi planlanır (paketinizde varsa).</p>
          <Field label="İptal sebebi"><Input name="reason" maxLength={300} placeholder="Müşteri talebi" /></Field>
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1">İptal et</Button>
            <Button type="button" variant="outline" onClick={() => setMode("view")}>Vazgeç</Button>
          </div>
        </form>
      )}
      {mode === "view" && (
        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <Link href={`/panel/musteriler/${appt.customer.id}`} className="text-lg font-semibold hover:underline">{appt.customer.firstName} {appt.customer.lastName}</Link>
            <div className="text-neutral-600">{appt.service.name} · {appt.staff.displayName}</div>
            <div>{dateTr(appt.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(appt.startsAt)}–{timeTr(appt.endsAt)}</div>
            <div>{appt.customerPackageId ? "Paketten" : tl(appt.price)} · {appt.source === "ONLINE" ? "Online randevu" : "Panel"}</div>
            {appt.customer.phone && <a className="text-brand-700" href={`tel:${appt.customer.phone}`}>{appt.customer.phone}</a>}
            {appt.notes && <p className="rounded-lg bg-sand-50 p-2 text-neutral-600">{appt.notes}</p>}
            <div><Badge tone={statusTone(appt.status)}>{STATUS_TR[appt.status]}</Badge></div>
          </div>
          {open && desk && (
            <div className="grid grid-cols-2 gap-2">
              {appt.status === "BOOKED" && <Button variant="outline" onClick={() => status("CONFIRMED")}>Onayla</Button>}
              <Button onClick={() => status("COMPLETED")}>Tamamlandı</Button>
              <Button variant="outline" onClick={() => setMode("edit")}>Düzenle / ertele</Button>
              <Button variant="outline" onClick={() => status("NO_SHOW")}>Gelmedi</Button>
              <Button variant="danger" onClick={() => setMode("cancel")}>İptal et</Button>
            </div>
          )}
          {open && !desk && <Button onClick={() => status("COMPLETED")} className="w-full">Tamamlandı olarak işaretle</Button>}
          {appt.status === "COMPLETED" && Number(appt.price) > 0 && desk && <Button variant="outline" className="w-full" onClick={() => setMode("pay")}>Tahsilat al</Button>}
        </div>
      )}
    </Dialog>
  );
}
