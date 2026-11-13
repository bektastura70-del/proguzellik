"use client";

import { CalendarDays, CalendarPlus, CheckCircle2, Clock, LogOut, MapPin, Package, Phone, User } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Spinner, Textarea } from "@/components/ui";
import { addDays, dateTr, isoDay, STATUS_TR, timeTr, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AppInfo, MyAppointment, MyPackage, papi, PortalError, Salon, Slot } from "./portal-api";
import { disablePush } from "@/lib/web-push-client";
import { AfterBookingInstall, InstallBanner } from "./install";
import { AccountExtras } from "./portal-extras";
import { NativeHomeLink, NativeReminderSync } from "./native";
import { syncNativeReminders } from "@/lib/native-app";

type Tab = "book" | "mine" | "packages" | "account";
type Me = { email: string; notifyAppointments: boolean; notifyReminders: boolean };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Salonun markasıyla müşteri uygulaması: randevu al, randevularım, paketlerim, hesabım. */
export function PortalClient({ slug, app }: { slug: string; app: AppInfo }) {
  const [tab, setTab] = useState<Tab>("book");
  useEffect(() => {
    // Bildirime dokununca doğrudan ilgili sekme açılır (?sekme=randevularim).
    const s = new URLSearchParams(window.location.search).get("sekme");
    if (s === "randevularim") setTab("mine");
    else if (s === "paketlerim") setTab("packages");
    else if (s === "hesabim") setTab("account");
  }, []);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [salon, setSalon] = useState<Salon | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await papi<Me>(slug, "portal/me"));
    } catch {
      setMe(null);
    }
  }, [slug]);

  useEffect(() => {
    void loadMe();
    fetch(`/api/p/public/salons/${slug}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Salon bilgisi alınamadı"))))
      .then(setSalon)
      .catch((e) => setErr((e as Error).message));
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("sekme");
      if (t === "randevularim") setTab("mine");
      if (t === "paketlerim" && app.features.packages) setTab("packages");
    }
  }, [slug, loadMe, app.features.packages]);

  const style = {
    "--salon": app.primaryColor ?? "#4a2535",
    "--salon2": app.secondaryColor ?? "#933c63",
  } as React.CSSProperties;

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "book", label: "Randevu al", icon: CalendarPlus },
    { id: "mine", label: "Randevularım", icon: CalendarDays },
    ...(app.features.packages ? [{ id: "packages" as Tab, label: "Paketlerim", icon: Package }] : []),
    { id: "account", label: "Hesabım", icon: User },
  ];

  return (
    <div style={style} className="min-h-screen bg-sand-50 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <header className="bg-[var(--salon)] px-5 pb-8 pt-[calc(1.25rem+env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {app.logoUrl || app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(app.logoUrl ?? app.iconUrl)!} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl bg-white object-contain p-1" />
          ) : (
            <div aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15 text-xl font-semibold">{app.name.slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold">{app.name}</h1>
            {app.description && <p className="line-clamp-2 text-sm text-white/80">{app.description}</p>}
          </div>
          <div className="ml-auto shrink-0"><NativeHomeLink light /></div>
        </div>
        {salon && (
          <div className="mx-auto mt-3 flex max-w-2xl flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
            {salon.salon.address && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="size-4 shrink-0" /><span className="truncate">{salon.salon.address}</span></span>}
            {salon.salon.phone && <a href={`tel:${salon.salon.phone}`} className="inline-flex items-center gap-1 underline-offset-2 hover:underline"><Phone className="size-4" />{salon.salon.phone}</a>}
          </div>
        )}
      </header>

      <NativeReminderSync slug={slug} name={app.name} loggedIn={me === undefined ? undefined : me !== null} />
      <main className="mx-auto -mt-4 max-w-2xl space-y-4 px-4">
        {err && <Alert>{err}</Alert>}
        {!salon && !err && <div className="grid place-items-center py-16"><Spinner /></div>}
        {salon && tab === "book" && <BookTab slug={slug} salon={salon} me={me} app={app} onLoggedIn={loadMe} onDone={() => setTab("mine")} onOpenAccount={() => setTab("account")} />}
        {salon && tab === "mine" && <MineTab slug={slug} me={me} onLoggedIn={loadMe} app={app} />}
        {salon && tab === "packages" && <PackagesTab slug={slug} me={me} onLoggedIn={loadMe} />}
        {salon && tab === "account" && <AccountTab slug={slug} me={me} app={app} onLoggedIn={loadMe} onLogout={() => setMe(null)} />}
        <p className="pt-2 text-center text-xs text-neutral-400">
          <Link href="/kvkk" className="underline">KVKK</Link> · <Link href="/gizlilik-politikasi" className="underline">Gizlilik</Link> · <Link href="/cerez-politikasi" className="underline">Çerezler</Link> · ProGüzellik altyapısı
        </p>
      </main>

      <nav aria-label="Ana menü" className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-2xl">
          {tabs.map((t) => (
            <li key={t.id} className="flex-1">
              <button
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn("flex w-full flex-col items-center gap-0.5 py-2.5 text-xs", tab === t.id ? "font-semibold text-[var(--salon)]" : "text-neutral-500")}
              >
                <t.icon className="size-5" />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** E-posta + tek kullanımlık kod ile giriş. */
export function LoginCard({ slug, onLoggedIn, reason }: { slug: string; onLoggedIn: () => void; reason?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await papi(slug, "portal/otp", { method: "POST", body: { email } });
      setStep("code");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await papi(slug, "portal/verify", { method: "POST", body: { email, code } });
      onLoggedIn();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">E-posta ile doğrulama</h2>
      <p className="mt-1 text-sm text-neutral-600">{reason ?? "Randevularınızı görmek için e-posta adresinize gönderilecek 6 haneli kodla giriş yapın."} Parola gerekmez.</p>
      {err && <div className="mt-3"><Alert>{err}</Alert></div>}
      {step === "email" ? (
        <form onSubmit={send} className="mt-4 space-y-3">
          <Field label="E-posta adresiniz"><Input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button className="w-full bg-[var(--salon)] hover:opacity-90" disabled={busy}>{busy ? "Gönderiliyor…" : "Kod gönder"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-3">
          <p className="text-sm text-neutral-600"><b>{email}</b> adresine kod gönderdik. Gelen kutunuzu ve istenmeyen klasörünü kontrol edin.</p>
          <Field label="6 haneli kod">
            <Input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Button className="w-full bg-[var(--salon)] hover:opacity-90" disabled={busy || code.length !== 6}>{busy ? "Doğrulanıyor…" : "Doğrula"}</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-neutral-500 underline" onClick={() => { setStep("email"); setCode(""); }}>E-postayı değiştir</button>
            <button type="button" className="text-neutral-500 underline" onClick={() => void send()} disabled={busy}>Kodu tekrar gönder</button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Tarih ve saat seçici: gerçek müsaitlik (personel saatleri, izinler, mevcut randevular) sunucudan gelir. */
function SlotPicker({ slug, serviceId, staffId, value, onChange }: { slug: string; serviceId: string; staffId: string; value: Slot | null; onChange: (s: Slot | null) => void }) {
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(isoDay(), i)), []);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSlots(null);
    setErr(null);
    onChange(null);
    const q = new URLSearchParams({ date: day, serviceId, ...(staffId ? { staffId } : {}) });
    papi<Slot[]>(slug, `availability?${q}`).then(setSlots).catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, serviceId, staffId, day]);

  const unique = useMemo(() => {
    if (!slots) return null;
    const seen = new Set<string>();
    return slots.filter((s) => (seen.has(s.startsAt) ? false : (seen.add(s.startsAt), true)));
  }, [slots]);

  return (
    <div>
      <div className="-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:none]" role="listbox" aria-label="Tarih">
        {days.map((d) => (
          <button key={d} type="button" role="option" aria-selected={d === day} onClick={() => setDay(d)} className={cn("min-w-14 shrink-0 snap-start rounded-xl border px-2 py-2 text-center", d === day ? "border-[var(--salon)] bg-[var(--salon)] text-white" : "border-sand-200 bg-white")}>
            <div className="text-xs opacity-80">{dateTr(`${d}T12:00:00+03:00`, { weekday: "short" })}</div>
            <div className="text-lg font-semibold">{d.slice(8)}</div>
          </button>
        ))}
      </div>
      <div className="mt-3">
        {err ? <Alert>{err}</Alert> : !unique ? <Spinner /> : unique.length === 0 ? (
          <p className="text-sm text-neutral-500"><CalendarDays className="mr-1 inline size-4" />Bu gün için boş saat yok. Başka bir gün deneyin.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {unique.map((s) => (
              <button key={s.startsAt} type="button" onClick={() => onChange(s)} aria-pressed={value?.startsAt === s.startsAt} className={cn("rounded-lg border py-2 text-sm", value?.startsAt === s.startsAt ? "border-[var(--salon)] bg-[var(--salon)] text-white" : "border-sand-200 bg-white")}>
                {timeTr(s.startsAt)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookTab({ slug, salon, me, app, onLoggedIn, onDone, onOpenAccount }: { slug: string; salon: Salon; me: Me | null | undefined; app: AppInfo; onLoggedIn: () => void; onDone: () => void; onOpenAccount: () => void }) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ service: string; staff: string; startsAt: string; price: string } | null>(null);
  // Aynı onay için tekrar denemede aynı anahtar gönderilir (mükerrer randevu oluşmaz).
  const [idemKey, setIdemKey] = useState(newKey);
  const service = salon.services.find((s) => s.id === serviceId);
  const staffForService = salon.staff.filter((s) => s.serviceIds.includes(serviceId ?? ""));

  useEffect(() => setIdemKey(newKey()), [serviceId, staffId, slot?.startsAt]);

  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot || !serviceId) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const r = await papi<{ service: string; staff: string; startsAt: string; price: string }>(slug, "portal/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey },
        body: {
          serviceId, staffId: staffId || undefined, startsAt: slot.startsAt,
          firstName: f.get("firstName"), lastName: f.get("lastName"), phone: f.get("phone"),
          notes: f.get("notes") || undefined, kvkkConsent: f.get("kvkk") === "on", marketingConsent: f.get("marketing") === "on",
        },
      });
      setDone(r);
    } catch (x) {
      if (x instanceof PortalError && x.status === 401) onLoggedIn();
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
        <h2 className="mt-4 font-display text-2xl font-semibold">Randevunuz alındı</h2>
        <div className="mt-5 space-y-1 rounded-xl bg-sand-50 p-4 text-left text-sm">
          <div><b>Hizmet:</b> {done.service}</div>
          <div><b>Uzman:</b> {done.staff}</div>
          <div><b>Tarih:</b> {dateTr(done.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(done.startsAt)}</div>
          <div><b>Ücret:</b> {tl(done.price)}</div>
        </div>
        <AfterBookingInstall slug={slug} app={app} onOpenAccount={onOpenAccount} />
        <Button className="mt-5 w-full bg-[var(--salon)] hover:opacity-90" onClick={onDone}>Randevularıma git</Button>
      </Card>
    );
  }

  return (
    <>
      <InstallBanner slug={slug} app={app} />
      <Card className="p-5">
        <h2 className="font-semibold">1. Hizmet seçin</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {salon.services.map((s) => (
            <button key={s.id} type="button" aria-pressed={serviceId === s.id} onClick={() => { setServiceId(s.id); setStaffId(""); setSlot(null); }} className={cn("rounded-xl border p-4 text-left transition", serviceId === s.id ? "border-[var(--salon)] ring-2 ring-[var(--salon)]/20" : "border-sand-200 bg-white")}>
              <div className="font-medium">{s.name}</div>
              <div className="mt-1 flex items-center gap-3 text-sm text-neutral-500">
                <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{s.durationMin} dk</span>
                <span>{tl(s.price)}</span>
              </div>
            </button>
          ))}
          {salon.services.length === 0 && <p className="text-sm text-neutral-500">Online randevuya açık hizmet yok.</p>}
        </div>
      </Card>

      {service && (
        <Card className="p-5">
          <h2 className="font-semibold">2. Uzman, tarih ve saat</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {[{ id: "", displayName: "Fark etmez" }, ...staffForService].map((s) => (
              <button key={s.id} type="button" aria-pressed={staffId === s.id} onClick={() => setStaffId(s.id)} className={cn("rounded-full border px-4 py-1.5 text-sm", staffId === s.id ? "border-[var(--salon)] bg-[var(--salon)] text-white" : "border-sand-300 bg-white")}>
                {s.displayName}
              </button>
            ))}
          </div>
          <div className="mt-4"><SlotPicker slug={slug} serviceId={service.id} staffId={staffId} value={slot} onChange={setSlot} /></div>
        </Card>
      )}

      {slot && me === null && <LoginCard slug={slug} onLoggedIn={onLoggedIn} reason="Randevuyu kesinleştirmek için kimliğinizi doğrulayın." />}

      {slot && me && (
        <Card className="p-5">
          <h2 className="font-semibold">3. Bilgileriniz</h2>
          <p className="mt-1 text-sm text-neutral-500">{service?.name} · {dateTr(slot.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(slot.startsAt)} · {me.email}</p>
          {err && <div className="mt-3"><Alert>{err}</Alert></div>}
          <form onSubmit={book} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Adınız"><Input name="firstName" required autoComplete="given-name" /></Field>
              <Field label="Soyadınız"><Input name="lastName" required autoComplete="family-name" /></Field>
            </div>
            <Field label="Cep telefonu"><Input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" /></Field>
            <Field label="Not (isteğe bağlı)"><Textarea name="notes" maxLength={500} /></Field>
            <label className="flex items-start gap-3 text-sm text-neutral-600">
              <input type="checkbox" name="kvkk" required className="mt-1 size-4" />
              <span><Link href="/kvkk" target="_blank" className="underline">Aydınlatma metnini</Link> okudum; randevu için verilerimin işlenmesini kabul ediyorum.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-neutral-600">
              <input type="checkbox" name="marketing" className="mt-1 size-4" />
              <span>Salondan kampanya ve bilgilendirme mesajları almak istiyorum (isteğe bağlı).</span>
            </label>
            <Button size="lg" className="w-full bg-[var(--salon)] hover:opacity-90" disabled={busy}>{busy ? "Kaydediliyor…" : "Randevuyu onayla"}</Button>
          </form>
        </Card>
      )}
    </>
  );
}

function MineTab({ slug, me, onLoggedIn, app }: { slug: string; me: Me | null | undefined; onLoggedIn: () => void; app: AppInfo }) {
  const [data, setData] = useState<{ upcoming: MyAppointment[]; past: MyAppointment[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [moving, setMoving] = useState<MyAppointment | null>(null);
  const [newSlot, setNewSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await papi<{ upcoming: MyAppointment[]; past: MyAppointment[] }>(slug, "portal/appointments");
      setData(d);
      setErr(null);
      void syncNativeReminders(slug, app.name, d.upcoming);
    } catch (x) {
      if (x instanceof PortalError && x.status === 401) onLoggedIn();
      else setErr((x as Error).message);
    }
  }, [slug, onLoggedIn, app.name]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (me === undefined) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (me === null) return <LoginCard slug={slug} onLoggedIn={onLoggedIn} />;

  async function cancel(a: MyAppointment) {
    if (!window.confirm(`${a.service} randevunuz iptal edilsin mi?`)) return;
    setBusy(true);
    try {
      await papi(slug, `portal/appointments/${a.id}/cancel`, { method: "POST" });
      await load();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move() {
    if (!moving || !newSlot) return;
    setBusy(true);
    try {
      await papi(slug, `portal/appointments/${moving.id}/reschedule`, { method: "POST", body: { startsAt: newSlot.startsAt, staffId: newSlot.staffId } });
      setMoving(null);
      setNewSlot(null);
      await load();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err && <Alert>{err}</Alert>}
      {!data ? <div className="grid place-items-center py-16"><Spinner /></div> : (
        <>
          <Card className="p-5">
            <h2 className="font-semibold">Yaklaşan randevular</h2>
            {data.upcoming.length === 0 && <p className="mt-3 text-sm text-neutral-500">Yaklaşan randevunuz yok.</p>}
            <ul className="mt-3 space-y-3">
              {data.upcoming.map((a) => (
                <li key={a.id} className="rounded-xl border border-sand-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{a.service}</div>
                      <div className="text-sm text-neutral-600">{dateTr(a.startsAt, { weekday: "long", day: "numeric", month: "long" })} · {timeTr(a.startsAt)}</div>
                      <div className="text-sm text-neutral-500">{a.staff}</div>
                    </div>
                    <Badge className="shrink-0 whitespace-nowrap" tone={a.status === "CONFIRMED" ? "green" : a.status === "CANCELLED" ? "red" : "amber"}>{a.status === "BOOKED" ? "Planlandı" : (STATUS_TR[a.status] ?? a.status)}</Badge>
                  </div>
                  {(a.canCancel || a.canReschedule) && (
                    <div className="mt-3 flex gap-2">
                      {a.canReschedule && <Button size="sm" variant="secondary" onClick={() => { setMoving(a); setNewSlot(null); }} disabled={busy}>Değiştir</Button>}
                      {a.canCancel && <Button size="sm" variant="danger" onClick={() => void cancel(a)} disabled={busy}>İptal et</Button>}
                    </div>
                  )}
                  {["BOOKED", "CONFIRMED"].includes(a.status) && !a.canCancel && app.rules && (
                    <p className="mt-2 text-xs text-neutral-500">Değişiklik ve iptal için randevuya en az {Math.max(app.rules.cancelMinHours, app.rules.rescheduleMinHours)} saat kalmalı; lütfen salonu arayın.</p>
                  )}
                  {moving?.id === a.id && (
                    <div className="mt-4 border-t border-sand-200 pt-4">
                      <p className="mb-2 text-sm font-medium">Yeni tarih ve saat</p>
                      <SlotPicker slug={slug} serviceId={a.serviceId} staffId={a.staffId} value={newSlot} onChange={setNewSlot} />
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" className="bg-[var(--salon)]" disabled={!newSlot || busy} onClick={() => void move()}>Kaydet</Button>
                        <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>Vazgeç</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          {data.past.length > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold">Geçmiş randevular</h2>
              <ul className="mt-3 divide-y divide-sand-100 text-sm">
                {data.past.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{dateTr(a.startsAt, { day: "numeric", month: "short", year: "numeric" })} · {a.service}</span>
                    <span className="shrink-0 text-neutral-500">{STATUS_TR[a.status] ?? a.status}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function PackagesTab({ slug, me, onLoggedIn }: { slug: string; me: Me | null | undefined; onLoggedIn: () => void }) {
  const [rows, setRows] = useState<MyPackage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!me) return;
    papi<MyPackage[]>(slug, "portal/packages").then(setRows).catch((x) => {
      if (x instanceof PortalError && x.status === 401) onLoggedIn();
      else setErr((x as Error).message);
    });
  }, [slug, me, onLoggedIn]);
  if (me === undefined) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (me === null) return <LoginCard slug={slug} onLoggedIn={onLoggedIn} reason="Paketlerinizi görmek için salona kayıtlı e-posta adresinizle giriş yapın." />;
  const STATUS: Record<string, { label: string; tone: "green" | "neutral" | "red" | "amber" }> = {
    ACTIVE: { label: "Geçerli", tone: "green" }, COMPLETED: { label: "Tamamlandı", tone: "neutral" }, EXPIRED: { label: "Süresi doldu", tone: "red" }, CANCELLED: { label: "İptal", tone: "red" },
  };
  return (
    <>
      {err && <Alert>{err}</Alert>}
      {!rows ? <div className="grid place-items-center py-16"><Spinner /></div> : rows.length === 0 ? (
        <Card className="p-5 text-sm text-neutral-600">Bu e-posta adresiyle eşleşen paket kaydı yok. Paketiniz varsa salondan e-posta adresinizi kaydınıza eklemesini isteyin.</Card>
      ) : rows.map((p) => {
        const st = STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
        const pct = p.totalSessions ? Math.round((p.usedSessions / p.totalSessions) * 100) : 0;
        return (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-sm text-neutral-500">{p.service}</p>
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-sand-50 p-3"><div className="text-2xl font-semibold">{p.totalSessions}</div><div className="text-xs text-neutral-500">Toplam</div></div>
              <div className="rounded-xl bg-sand-50 p-3"><div className="text-2xl font-semibold">{p.usedSessions}</div><div className="text-xs text-neutral-500">Kullanılan</div></div>
              <div className="rounded-xl bg-sand-50 p-3"><div className="text-2xl font-semibold text-[var(--salon)]">{p.remainingSessions}</div><div className="text-xs text-neutral-500">Kalan</div></div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Kullanılan seans oranı">
              <div className="h-full bg-[var(--salon)]" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-3 space-y-0.5 text-xs text-neutral-500">
              {p.plannedSessions > 0 && <div>Planlı randevu: {p.plannedSessions}</div>}
              {p.expiresAt && <div>Son kullanım: {dateTr(p.expiresAt)}</div>}
            </div>
          </Card>
        );
      })}
    </>
  );
}

function AccountTab({ slug, me, app, onLoggedIn, onLogout }: { slug: string; me: Me | null | undefined; app: AppInfo; onLoggedIn: () => void; onLogout: () => void }) {
  if (me === undefined) return <div className="grid place-items-center py-16"><Spinner /></div>;
  return (
    <>
      {me === null ? <LoginCard slug={slug} onLoggedIn={onLoggedIn} /> : (
        <Card className="p-5">
          <h2 className="font-semibold">Hesabım</h2>
          <p className="mt-1 text-sm text-neutral-600">{me.email} ile giriş yaptınız.</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={async () => {
            // Paylaşılan cihazda sonraki kişiye bu müşterinin bildirimleri gitmesin.
            await disablePush(`/r/${slug}/`, (endpoint) => papi(slug, "portal/push/subscriptions", { method: "DELETE", body: { endpoint } })).catch(() => undefined);
            await papi(slug, "portal/logout", { method: "POST" }).catch(() => null);
            await syncNativeReminders(slug, app.name, null);
            onLogout();
          }}>
            <LogOut className="size-4" /> Çıkış yap
          </Button>
        </Card>
      )}
      <AccountExtras slug={slug} app={app} me={me} onDeleted={onLogout} />
    </>
  );
}
