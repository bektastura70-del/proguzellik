"use client";

import { CalendarOff, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { AppointmentDetail, NewAppointment, TimeOffDialog } from "@/components/calendar/dialogs";
import { END_H, layoutLanes, movable, PX_PER_MIN, SNAP, START_H, STATUS_DOT, STATUS_STYLE, TimeOff } from "@/components/calendar/shared";
import { useSession } from "@/components/panel/session";
import type { Appointment, Staff } from "@/components/panel/types";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Spinner, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTr, isoDay, istanbulToIso, minutesOfDay, minutesToHHMM, monthGridStart, STATUS_TR, timeTr, weekdayOfDay, weekStart } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "gun" | "hafta" | "ay";
const HOURS = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
const BODY_H = (END_H - START_H) * 60 * PX_PER_MIN;

function CalendarInner() {
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const view = (["gun", "hafta", "ay"].includes(params.get("gorunum") ?? "") ? params.get("gorunum") : "gun") as View;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get("tarih") ?? "") ? params.get("tarih")! : isoDay();
  const [staffFilter, setStaffFilter] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState<{ staffId?: string; date?: string; time?: string; customerId?: string; serviceId?: string } | null>(() =>
    params.get("yeni") === "1" ? { date: day, customerId: params.get("musteri") ?? undefined, serviceId: params.get("hizmet") ?? undefined } : null,
  );
  const [blocking, setBlocking] = useState<{ staffId?: string; date?: string } | TimeOff | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [dragging, setDragging] = useState<Appointment | null>(null);
  const desk = can("OWNER", "MANAGER", "RECEPTION");

  const go = useCallback(
    (next: { gorunum?: View; tarih?: string }) => {
      const q = new URLSearchParams({ gorunum: next.gorunum ?? view, tarih: next.tarih ?? day });
      router.replace(`/panel/takvim?${q}`);
    },
    [router, view, day],
  );

  const range = useMemo(() => {
    if (view === "gun") return { from: day, to: addDays(day, 1), days: [day] };
    if (view === "hafta") {
      const s = weekStart(day);
      return { from: s, to: addDays(s, 7), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
    }
    const s = monthGridStart(day);
    return { from: s, to: addDays(s, 42), days: Array.from({ length: 42 }, (_, i) => addDays(s, i)) };
  }, [view, day]);

  const q = `from=${encodeURIComponent(istanbulToIso(range.from, "00:00"))}&to=${encodeURIComponent(istanbulToIso(range.to, "00:00"))}`;
  const appts = useApi<Appointment[]>(`/appointments?${q}`);
  const offs = useApi<TimeOff[]>(`/time-off?${q}`);
  const staff = useApi<Staff[]>("/staff");
  const allStaff = staff.data ?? [];
  const columns = staffFilter ? allStaff.filter((s) => s.id === staffFilter) : allStaff;
  const visible = (appts.data ?? []).filter((a) => (showCancelled || a.status !== "CANCELLED") && (!staffFilter || a.staff.id === staffFilter));
  const reload = () => {
    appts.reload();
    offs.reload();
  };

  async function move(a: Appointment, date: string, minute: number, staffId: string) {
    const snapped = Math.round(minute / SNAP) * SNAP;
    const startsAt = istanbulToIso(date, minutesToHHMM(Math.max(0, Math.min(snapped, 24 * 60 - SNAP))));
    if (startsAt === new Date(a.startsAt).toISOString() && staffId === a.staff.id) return;
    try {
      await api(`/appointments/${a.id}`, { method: "PATCH", body: { startsAt, ...(staffId !== a.staff.id ? { staffId } : {}) } });
      toast(`Randevu ${dateTr(startsAt, { day: "numeric", month: "short" })} ${timeTr(startsAt)} saatine taşındı`);
    } catch (e) {
      toast((e as Error).message, "red");
    } finally {
      reload();
    }
  }

  const title =
    view === "gun"
      ? dateTr(`${day}T12:00:00+03:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : view === "hafta"
        ? `${dateTr(`${range.from}T12:00:00+03:00`, { day: "numeric", month: "short" })} – ${dateTr(`${addDays(range.from, 6)}T12:00:00+03:00`, { day: "numeric", month: "short", year: "numeric" })}`
        : dateTr(`${day}T12:00:00+03:00`, { month: "long", year: "numeric" });
  const step = view === "gun" ? 1 : view === "hafta" ? 7 : 0;
  const shift = (dir: 1 | -1) => {
    if (view !== "ay") return go({ tarih: addDays(day, dir * step) });
    const d = new Date(`${day.slice(0, 8)}15T12:00:00+03:00`);
    d.setUTCMonth(d.getUTCMonth() + dir);
    go({ tarih: isoDay(d) });
  };

  return (
    <>
      <PageHeader
        title="Takvim"
        description={title}
        action={
          <>
            {desk && <Button variant="outline" onClick={() => setBlocking({ date: day })}><CalendarOff /> İzin / blok</Button>}
            {desk && <Button onClick={() => setCreating({ date: day })}><Plus /> Randevu</Button>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-sand-300 bg-white p-1" role="tablist" aria-label="Takvim görünümü">
          {(["gun", "hafta", "ay"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => go({ gorunum: v })} className={cn("rounded-lg px-3 py-1.5 text-sm", view === v ? "bg-brand-700 text-white" : "hover:bg-sand-100")}>
              {v === "gun" ? "Gün" : v === "hafta" ? "Hafta" : "Ay"}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-xl border border-sand-300 bg-white">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Önceki"><ChevronLeft /></Button>
          <button className="px-2 text-sm font-medium" onClick={() => go({ tarih: isoDay() })}>Bugün</button>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Sonraki"><ChevronRight /></Button>
        </div>
        <Input type="date" value={day} onChange={(e) => e.target.value && go({ tarih: e.target.value })} className="w-40" aria-label="Tarih seç" />
        <Select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="w-44" aria-label="Personel filtresi">
          <option value="">Tüm personel</option>
          {allStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-brand-600" /> İptalleri göster
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-neutral-600" aria-label="Durum renkleri">
        {["BOOKED", "CONFIRMED", "COMPLETED", "NO_SHOW"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", STATUS_DOT[s])} />{STATUS_TR[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[repeating-linear-gradient(45deg,#d3c8b9_0,#d3c8b9_2px,transparent_2px,transparent_5px)]" />İzin / blok</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sand-200" />Çalışma saati dışı</span>
        {desk && view !== "ay" && <span className="hidden md:inline">· Randevuları sürükleyerek taşıyabilirsiniz</span>}
      </div>

      {staff.loading || (appts.loading && !appts.data) ? (
        <Spinner />
      ) : allStaff.length === 0 ? (
        <Alert tone="brand">Önce <Link className="underline" href="/panel/personel">personel</Link> ve <Link className="underline" href="/panel/hizmetler">hizmet</Link> ekleyin.</Alert>
      ) : view === "ay" ? (
        <MonthView days={range.days} anchor={day} appts={visible} onDay={(d) => go({ gorunum: "gun", tarih: d })} />
      ) : (
        <>
          <Card className="hidden overflow-x-auto md:block" data-testid="calendar-grid">
            <div className="flex w-full">
              <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-sand-100 bg-white pt-12">
                {HOURS.map((h) => (
                  <div key={h} className="pr-2 text-right text-xs text-neutral-400" style={{ height: 60 * PX_PER_MIN }}>{String(h).padStart(2, "0")}:00</div>
                ))}
              </div>
              {(view === "gun" ? columns.map((s) => ({ key: s.id, date: day, staff: s })) : range.days.map((d) => ({ key: d, date: d, staff: null as Staff | null }))).map((col) => (
                <TimeColumn
                  key={col.key}
                  date={col.date}
                  staff={col.staff}
                  allStaff={columns}
                  wide={view === "gun"}
                  appts={visible.filter((a) => isoDay(new Date(a.startsAt)) === col.date && (!col.staff || a.staff.id === col.staff.id))}
                  offs={(offs.data ?? []).filter((o) => (!col.staff || o.staff.id === col.staff.id) && (!staffFilter || o.staff.id === staffFilter) && o.startsAt < istanbulToIso(addDays(col.date, 1), "00:00") && o.endsAt > istanbulToIso(col.date, "00:00"))}
                  canEdit={desk}
                  dragging={dragging}
                  setDragging={setDragging}
                  onCreate={(staffId, time) => desk && setCreating({ staffId, date: col.date, time })}
                  onOpen={setSelected}
                  onOff={(o) => desk && setBlocking(o)}
                  onDrop={(a, minute) => move(a, col.date, minute, col.staff?.id ?? a.staff.id)}
                />
              ))}
            </div>
          </Card>
          <AgendaList days={range.days} appts={visible} offs={offs.data ?? []} onOpen={setSelected} />
        </>
      )}

      {creating && <NewAppointment preset={creating} staff={allStaff} onClose={() => setCreating(null)} onDone={() => { setCreating(null); reload(); }} />}
      {blocking && <TimeOffDialog value={blocking} staff={allStaff} onClose={() => setBlocking(null)} onDone={() => { setBlocking(null); reload(); }} />}
      {selected && <AppointmentDetail appt={selected} staff={allStaff} onClose={() => setSelected(null)} onChange={() => { setSelected(null); reload(); }} />}
    </>
  );
}

function TimeColumn(props: {
  date: string;
  staff: Staff | null;
  allStaff: Staff[];
  wide: boolean;
  appts: Appointment[];
  offs: TimeOff[];
  canEdit: boolean;
  dragging: Appointment | null;
  setDragging: (a: Appointment | null) => void;
  onCreate: (staffId: string | undefined, time: string) => void;
  onOpen: (a: Appointment) => void;
  onOff: (o: TimeOff) => void;
  onDrop: (a: Appointment, minute: number) => void;
}) {
  const { date, staff, appts, offs } = props;
  const [hover, setHover] = useState<number | null>(null);
  const weekday = weekdayOfDay(date);
  const today = date === isoDay();
  // Çalışma saati dışı alanlar (gün görünümünde personel bazlı; hafta görünümünde tüm personelin birleşimi)
  const hours = (staff ? [staff] : props.allStaff).flatMap((s) => s.workingHours.filter((h) => h.weekday === weekday));
  const working = (m: number) => hours.some((h) => h.startMin <= m && m < h.endMin);
  const cells = Array.from({ length: (END_H - START_H) * 2 }, (_, i) => START_H * 60 + i * 30);
  const minuteFromEvent = (e: React.DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return START_H * 60 + Math.round((e.clientY - rect.top) / PX_PER_MIN / SNAP) * SNAP;
  };

  return (
    <div className={cn("flex-1 shrink-0 border-r border-sand-100 last:border-r-0", props.wide ? "min-w-56" : "min-w-36")} data-testid={`col-${staff?.displayName ?? date}`}>
      <div className={cn("sticky top-0 z-10 flex h-12 flex-col justify-center border-b border-sand-100 bg-white px-3 text-sm", today && !staff && "bg-brand-50")}>
        {staff ? (
          <span className="flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: staff.color ?? "#c97399" }} />{staff.displayName}</span>
        ) : (
          <>
            <span className="text-xs text-neutral-500">{dateTr(`${date}T12:00:00+03:00`, { weekday: "short" })}</span>
            <span className={cn("font-semibold", today && "text-brand-700")}>{dateTr(`${date}T12:00:00+03:00`, { day: "numeric", month: "short" })}</span>
          </>
        )}
      </div>
      <div
        className="relative"
        style={{ height: BODY_H }}
        onDragOver={(e) => {
          if (!props.dragging) return;
          e.preventDefault();
          setHover(minuteFromEvent(e));
        }}
        onDragLeave={() => setHover(null)}
        onDrop={(e) => {
          e.preventDefault();
          const a = props.dragging;
          setHover(null);
          props.setDragging(null);
          if (a) props.onDrop(a, minuteFromEvent(e));
        }}
      >
        {cells.map((m) => (
          <button
            key={m}
            type="button"
            className={cn("absolute inset-x-0 border-b border-dashed border-sand-100", working(m) ? "hover:bg-brand-50/70" : "bg-sand-100/80 hover:bg-sand-200/70")}
            style={{ top: (m - START_H * 60) * PX_PER_MIN, height: 30 * PX_PER_MIN }}
            onClick={() => props.onCreate(staff?.id, minutesToHHMM(m))}
            aria-label={`${minutesToHHMM(m)} için randevu ekle`}
            tabIndex={props.canEdit ? 0 : -1}
          />
        ))}
        {offs.map((o) => {
          const s = Math.max(START_H * 60, o.startsAt < istanbulToIso(date, "00:00") ? 0 : minutesOfDay(o.startsAt));
          const eIso = o.endsAt > istanbulToIso(addDays(date, 1), "00:00") ? 24 * 60 : minutesOfDay(o.endsAt);
          const e = Math.min(END_H * 60, eIso);
          if (e <= s) return null;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => props.onOff(o)}
              className="absolute inset-x-1 rounded-md border border-sand-300 bg-[repeating-linear-gradient(45deg,#e6dfd5_0,#e6dfd5_4px,#f3efe9_4px,#f3efe9_9px)] px-2 py-1 text-left text-xs text-neutral-600"
              style={{ top: (s - START_H * 60) * PX_PER_MIN, height: (e - s) * PX_PER_MIN }}
            >
              <b>İzin</b>{!staff && ` · ${o.staff.displayName}`}{o.reason && ` · ${o.reason}`}
            </button>
          );
        })}
        {layoutLanes(appts).map(({ item: a, lane, lanes }) => {
          const top = (minutesOfDay(a.startsAt) - START_H * 60) * PX_PER_MIN;
          const h = Math.max(22, ((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000) * PX_PER_MIN);
          const canMove = props.canEdit && movable(a);
          return (
            <button
              key={a.id}
              type="button"
              draggable={canMove}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.id);
                props.setDragging(a);
              }}
              onDragEnd={() => props.setDragging(null)}
              onClick={() => props.onOpen(a)}
              data-testid="appt"
              data-appt-id={a.id}
              className={cn("absolute overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-left text-xs leading-tight shadow-sm transition hover:z-10 hover:shadow-md", STATUS_STYLE[a.status], canMove && "cursor-grab active:cursor-grabbing", props.dragging?.id === a.id && "opacity-40")}
              style={{ top, height: h, left: `calc(${(lane / lanes) * 100}% + 4px)`, width: `calc(${100 / lanes}% - 8px)` }}
              title={`${timeTr(a.startsAt)}–${timeTr(a.endsAt)} ${a.customer.firstName} ${a.customer.lastName} · ${a.service.name} · ${a.staff.displayName}`}
            >
              <div className="truncate font-semibold">{timeTr(a.startsAt)} {lanes > 1 && !staff ? a.customer.firstName : `${a.customer.firstName} ${a.customer.lastName}`}</div>
              <div className="truncate opacity-80">{lanes > 1 && !staff ? a.staff.displayName : `${a.service.name}${!staff ? ` · ${a.staff.displayName}` : ""}${a.customerPackageId ? " · paket" : ""}`}</div>
            </button>
          );
        })}
        {hover !== null && props.dragging && (
          <div className="pointer-events-none absolute inset-x-1 rounded-lg border-2 border-dashed border-brand-500 bg-brand-100/50 px-2 text-xs font-semibold text-brand-800" style={{ top: (hover - START_H * 60) * PX_PER_MIN, height: props.dragging.service.durationMin * PX_PER_MIN }}>
            {minutesToHHMM(hover)}
          </div>
        )}
        {today && <NowLine />}
      </div>
    </div>
  );
}

function NowLine() {
  const m = minutesOfDay(new Date().toISOString());
  if (m < START_H * 60 || m > END_H * 60) return null;
  return <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500" style={{ top: (m - START_H * 60) * PX_PER_MIN }} aria-hidden />;
}

function AgendaList({ days, appts, offs, onOpen }: { days: string[]; appts: Appointment[]; offs: TimeOff[]; onOpen: (a: Appointment) => void }) {
  return (
    <div className="space-y-4 md:hidden" data-testid="agenda">
      {days.map((d) => {
        const list = appts.filter((a) => isoDay(new Date(a.startsAt)) === d).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const dayOffs = offs.filter((o) => isoDay(new Date(o.startsAt)) === d);
        if (days.length > 1 && !list.length && !dayOffs.length) return null;
        return (
          <section key={d}>
            {days.length > 1 && <h3 className="mb-2 text-sm font-semibold text-neutral-600">{dateTr(`${d}T12:00:00+03:00`, { weekday: "long", day: "numeric", month: "long" })}</h3>}
            {!list.length && !dayOffs.length && <p className="text-sm text-neutral-500">Bu gün için randevu yok.</p>}
            <div className="space-y-2">
              {dayOffs.map((o) => (
                <div key={o.id} className="rounded-xl border border-dashed border-sand-300 bg-sand-100 p-3 text-sm text-neutral-600">
                  İzin · {o.staff.displayName} · {timeTr(o.startsAt)}–{timeTr(o.endsAt)} {o.reason && `· ${o.reason}`}
                </div>
              ))}
              {list.map((a) => (
                <button key={a.id} onClick={() => onOpen(a)} className="flex w-full items-center gap-3 rounded-xl border border-sand-200 bg-white p-3 text-left">
                  <span className="w-12 font-semibold">{timeTr(a.startsAt)}</span>
                  <span className={cn("h-9 w-1 rounded-full", STATUS_DOT[a.status])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.customer.firstName} {a.customer.lastName}</span>
                    <span className="block truncate text-sm text-neutral-500">{a.service.name} · {a.staff.displayName}</span>
                  </span>
                  <Badge tone={statusTone(a.status)}>{STATUS_TR[a.status]}</Badge>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ days, anchor, appts, onDay }: { days: string[]; anchor: string; appts: Appointment[]; onDay: (d: string) => void }) {
  const month = anchor.slice(0, 7);
  return (
    <Card className="overflow-hidden" data-testid="month-grid">
      <div className="grid grid-cols-7 border-b border-sand-100 bg-sand-50 text-center text-xs font-medium text-neutral-500">
        {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = appts.filter((a) => isoDay(new Date(a.startsAt)) === d).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const out = d.slice(0, 7) !== month;
          return (
            <button key={d} onClick={() => onDay(d)} className={cn("min-h-20 border-b border-r border-sand-100 p-1.5 text-left align-top hover:bg-brand-50/60 sm:min-h-28", out && "bg-sand-50/70 text-neutral-400")} aria-label={`${d}: ${list.length} randevu`}>
              <div className="flex items-center justify-between">
                <span className={cn("grid size-6 place-items-center rounded-full text-xs font-semibold", d === isoDay() && "bg-brand-700 text-white")}>{Number(d.slice(8))}</span>
                {list.length > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-800">{list.length}</span>}
              </div>
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-center gap-1 truncate text-[11px]"><span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[a.status])} />{timeTr(a.startsAt)} {a.customer.firstName}</div>
                ))}
                {list.length > 3 && <div className="text-[11px] text-neutral-500">+{list.length - 3} daha</div>}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CalendarInner />
    </Suspense>
  );
}
