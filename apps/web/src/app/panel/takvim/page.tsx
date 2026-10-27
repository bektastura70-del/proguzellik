"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CustomerPicker } from "@/components/panel/customer-picker";
import { useSession } from "@/components/panel/session";
import type { Appointment, Customer, Service, Staff } from "@/components/panel/types";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Textarea, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTr, isoDay, istanbulToIso, METHOD_TR, STATUS_TR, timeTr, tl } from "@/lib/format";

const START_H = 8;
const END_H = 21;
const PX_PER_MIN = 1.1;

function minutesOfDay(iso: string) {
  const [h, m] = timeTr(iso).split(":").map(Number);
  return h * 60 + m;
}

export default function CalendarPage() {
  const { can } = useSession();
  const [day, setDay] = useState(isoDay());
  const from = istanbulToIso(day, "00:00");
  const to = istanbulToIso(addDays(day, 1), "00:00");
  const appts = useApi<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const staff = useApi<Staff[]>("/staff");
  const [creating, setCreating] = useState<{ staffId?: string; time?: string } | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);

  const columns = staff.data ?? [];
  const visible = (appts.data ?? []).filter((a) => a.status !== "CANCELLED");

  return (
    <>
      <PageHeader
        title="Takvim"
        description={dateTr(`${day}T12:00:00+03:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        action={
          <>
            <div className="flex items-center rounded-xl border border-sand-300 bg-white">
              <Button variant="ghost" size="icon" onClick={() => setDay(addDays(day, -1))} aria-label="Önceki gün"><ChevronLeft /></Button>
              <button className="px-2 text-sm font-medium" onClick={() => setDay(isoDay())}>Bugün</button>
              <Button variant="ghost" size="icon" onClick={() => setDay(addDays(day, 1))} aria-label="Sonraki gün"><ChevronRight /></Button>
            </div>
            <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" aria-label="Tarih seç" />
            {can("OWNER", "MANAGER", "RECEPTION") && <Button onClick={() => setCreating({})}><Plus /> Randevu</Button>}
          </>
        }
      />

      {staff.loading || appts.loading ? (
        <Spinner />
      ) : columns.length === 0 ? (
        <Alert tone="brand">Önce <Link className="underline" href="/panel/personel">personel</Link> ve <Link className="underline" href="/panel/hizmetler">hizmet</Link> ekleyin.</Alert>
      ) : (
        <>
          {/* Masaüstü: personel sütunlu zaman çizelgesi */}
          <Card className="hidden overflow-x-auto md:block">
            <div className="flex min-w-max">
              <div className="w-14 shrink-0 border-r border-sand-100 pt-10">
                {Array.from({ length: END_H - START_H }, (_, i) => (
                  <div key={i} className="pr-2 text-right text-xs text-neutral-400" style={{ height: 60 * PX_PER_MIN }}>{String(START_H + i).padStart(2, "0")}:00</div>
                ))}
              </div>
              {columns.map((s) => (
                <div key={s.id} className="w-56 shrink-0 border-r border-sand-100 last:border-r-0">
                  <div className="sticky top-0 flex h-10 items-center gap-2 border-b border-sand-100 bg-white px-3 text-sm font-medium">
                    <span className="size-2.5 rounded-full" style={{ background: s.color ?? "#c97399" }} />{s.displayName}
                  </div>
                  <div className="relative" style={{ height: (END_H - START_H) * 60 * PX_PER_MIN }}>
                    {Array.from({ length: (END_H - START_H) * 2 }, (_, i) => (
                      <button
                        key={i}
                        className="absolute inset-x-0 border-b border-dashed border-sand-100 hover:bg-brand-50/60"
                        style={{ top: i * 30 * PX_PER_MIN, height: 30 * PX_PER_MIN }}
                        onClick={() => can("OWNER", "MANAGER", "RECEPTION") && setCreating({ staffId: s.id, time: `${String(START_H + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}` })}
                        aria-label="Bu saate randevu ekle"
                      />
                    ))}
                    {visible.filter((a) => a.staff.id === s.id).map((a) => {
                      const top = (minutesOfDay(a.startsAt) - START_H * 60) * PX_PER_MIN;
                      const h = Math.max(24, (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000 * PX_PER_MIN);
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a)}
                          className="absolute inset-x-1.5 overflow-hidden rounded-lg border-l-4 bg-brand-50 px-2 py-1 text-left text-xs shadow-sm hover:bg-brand-100"
                          style={{ top, height: h, borderColor: a.service.color ?? s.color ?? "#b0507b", opacity: a.status === "NO_SHOW" ? 0.5 : 1 }}
                        >
                          <div className="font-semibold">{timeTr(a.startsAt)} {a.customer.firstName} {a.customer.lastName}</div>
                          <div className="truncate text-neutral-600">{a.service.name}{a.customerPackageId ? " · paket" : ""}</div>
                          {a.status === "COMPLETED" && <div className="text-emerald-700">✓ Tamamlandı</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Mobil: liste görünümü */}
          <div className="space-y-2 md:hidden">
            {visible.length === 0 && <p className="text-sm text-neutral-500">Bu gün için randevu yok.</p>}
            {visible.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)} className="flex w-full items-center gap-3 rounded-xl border border-sand-200 bg-white p-3 text-left">
                <span className="w-12 font-semibold">{timeTr(a.startsAt)}</span>
                <span className="h-8 w-1 rounded-full" style={{ background: a.staff.color ?? "#c97399" }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.customer.firstName} {a.customer.lastName}</span>
                  <span className="block truncate text-sm text-neutral-500">{a.service.name} · {a.staff.displayName}</span>
                </span>
                <Badge tone={statusTone(a.status)}>{STATUS_TR[a.status]}</Badge>
              </button>
            ))}
          </div>
        </>
      )}

      {creating && <NewAppointment day={day} preset={creating} staff={columns} onClose={() => setCreating(null)} onDone={() => { setCreating(null); appts.reload(); }} />}
      {selected && <AppointmentDetail appt={selected} onClose={() => setSelected(null)} onChange={() => { setSelected(null); appts.reload(); }} />}
    </>
  );
}

function NewAppointment({ day, preset, staff, onClose, onDone }: { day: string; preset: { staffId?: string; time?: string }; staff: Staff[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const services = useApi<Service[]>("/services");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState(preset.staffId ?? "");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState(preset.time ?? "10:00");
  const [pkgId, setPkgId] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const pkgs = useApi<{ id: string; name: string; serviceId: string; status: string; usedSessions: number; totalSessions: number }[]>(customer ? `/customers/${customer.id}/packages` : null, [customer?.id]);
  const eligibleStaff = useMemo(() => staff.filter((s) => !serviceId || s.services.some((x) => x.serviceId === serviceId)), [staff, serviceId]);
  const usablePkgs = (pkgs.data ?? []).filter((p) => p.status === "ACTIVE" && p.serviceId === serviceId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!customer) return setErr("Müşteri seçin");
    try {
      await api("/appointments", {
        method: "POST",
        body: { customerId: customer.id, serviceId, staffId, startsAt: istanbulToIso(date, time), notes: notes || undefined, customerPackageId: pkgId || undefined },
      });
      toast("Randevu oluşturuldu");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Yeni randevu">
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Müşteri"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <Field label="Hizmet">
          <Select required value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPkgId(""); }}>
            <option value="">Seçin</option>
            {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} dk · {tl(s.price)}</option>)}
          </Select>
        </Field>
        <Field label="Personel">
          <Select required value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Seçin</option>
            {eligibleStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tarih"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Saat"><Input type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        {usablePkgs.length > 0 && (
          <Field label="Paketten düş" hint="Seçerseniz randevu ücretsiz olur, tamamlanınca seans düşer.">
            <Select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
              <option value="">Paket kullanma</option>
              {usablePkgs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.totalSessions - p.usedSessions} seans kaldı)</option>)}
            </Select>
          </Field>
        )}
        <Field label="Not"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        <Button className="w-full">Randevuyu kaydet</Button>
      </form>
    </Dialog>
  );
}

function AppointmentDetail({ appt, onClose, onChange }: { appt: Appointment; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState(false);

  async function status(s: string) {
    try {
      await api(`/appointments/${appt.id}/status`, { method: "POST", body: { status: s } });
      toast(`Durum: ${STATUS_TR[s]}`);
      if (s === "COMPLETED" && Number(appt.price) > 0 && can("OWNER", "MANAGER", "RECEPTION")) setPay(true);
      else onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function collect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/finance/payments", { method: "POST", body: { customerId: appt.customer.id, appointmentId: appt.id, amount: Number(f.get("amount")), method: f.get("method") } });
      toast("Tahsilat kaydedildi");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const open = ["BOOKED", "CONFIRMED"].includes(appt.status);
  return (
    <Dialog open onClose={pay ? onChange : onClose} title={pay ? "Tahsilat" : "Randevu"}>
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {pay ? (
        <form onSubmit={collect} className="space-y-4">
          <p className="text-sm text-neutral-600">{appt.customer.firstName} {appt.customer.lastName} · {appt.service.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tutar (₺)"><Input name="amount" type="number" step="0.01" min="0.01" defaultValue={Number(appt.price)} required /></Field>
            <Field label="Yöntem">
              <Select name="method" defaultValue="CARD">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1">Tahsil et</Button>
            <Button type="button" variant="outline" onClick={onChange}>Sonra</Button>
          </div>
        </form>
      ) : (
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
          {open && (
            <div className="grid grid-cols-2 gap-2">
              {appt.status === "BOOKED" && <Button variant="outline" onClick={() => status("CONFIRMED")}>Onayla</Button>}
              <Button onClick={() => status("COMPLETED")}>Tamamlandı</Button>
              <Button variant="outline" onClick={() => status("NO_SHOW")}>Gelmedi</Button>
              <Button variant="danger" onClick={() => status("CANCELLED")}>İptal et</Button>
            </div>
          )}
          {appt.status === "COMPLETED" && Number(appt.price) > 0 && can("OWNER", "MANAGER", "RECEPTION") && (
            <Button variant="outline" className="w-full" onClick={() => setPay(true)}>Tahsilat al</Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
