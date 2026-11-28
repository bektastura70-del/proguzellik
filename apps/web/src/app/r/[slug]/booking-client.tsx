"use client";

import { NativeDirectoryLink, NativeHomeLink } from "@/components/native-home-link";
import { CalendarDays, CheckCircle2, Clock, MapPin, Phone } from "lucide-react";
import { DirectionsLink } from "@/components/directions-link";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Card, Field, Input, Spinner, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, dateTr, isoDay, timeTr, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelHref, loadSavedBookings, SavedBooking, saveBooking } from "./saved-bookings";

type Salon = {
  salon: { name: string; slug: string; phone: string | null; address: string | null; directionsUrl?: string | null };
  services: { id: string; name: string; description: string | null; durationMin: number; price: string; category: { name: string } | null }[];
  staff: { id: string; displayName: string; title: string | null; serviceIds: string[] }[];
};
type Slot = { staffId: string; staffName: string; startsAt: string; endsAt: string };

export function BookingClient({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, error, loading } = useApi<Salon>(`/public/salons/${slug}`);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string>("");
  const [day, setDay] = useState(isoDay());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [done, setDone] = useState<{
    bookingId: string; cancelToken: string; service: string; staff: string; startsAt: string; price: string;
    confirmation?: { whatsapp: boolean; email: boolean }; cancelHours?: number;
  } | null>(null);
  const [saved, setSaved] = useState<SavedBooking[]>([]);
  useEffect(() => setSaved(loadSavedBookings(slug)), [slug, done]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(isoDay(), i)), []);
  const service = data?.services.find((s) => s.id === serviceId);
  const staffForService = data?.staff.filter((s) => s.serviceIds.includes(serviceId ?? "")) ?? [];

  useEffect(() => {
    if (!serviceId) return;
    setSlots(null);
    setSlot(null);
    const q = new URLSearchParams({ date: day, serviceId, ...(staffId ? { staffId } : {}) });
    api<Slot[]>(`/public/salons/${slug}/availability?${q}`).then(setSlots).catch((e) => setErr(e.message));
  }, [slug, serviceId, staffId, day]);

  // Personel "fark etmez" ise aynı saatteki tekrarları tekilleştir.
  const uniqueSlots = useMemo(() => {
    if (!slots) return null;
    const seen = new Set<string>();
    return slots.filter((s) => (seen.has(s.startsAt) ? false : (seen.add(s.startsAt), true)));
  }, [slots]);

  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot || !serviceId) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const r = await api<typeof done>(`/public/salons/${slug}/bookings`, {
        method: "POST",
        body: {
          serviceId,
          staffId: staffId || undefined,
          startsAt: slot.startsAt,
          firstName: f.get("firstName"),
          lastName: f.get("lastName"),
          phone: f.get("phone"),
          email: f.get("email") || undefined,
          notes: f.get("notes") || undefined,
          kvkkConsent: f.get("kvkk") === "on",
          marketingConsent: f.get("marketing") === "on",
        },
      });
      if (r) saveBooking(slug, { id: r.bookingId, token: r.cancelToken, service: r.service, staff: r.staff, startsAt: r.startsAt });
      setDone(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <Logo />
        <p className="mt-6 text-neutral-600">Bu işletme şu an online randevu almıyor.</p>
      </div>
    );
  }

  if (done) {
    const cancelUrl = cancelHref(slug, { id: done.bookingId, token: done.cancelToken });
    const conf = done.confirmation;
    const confText = conf?.whatsapp && conf.email
      ? "Onay mesajı WhatsApp ve e-postayla gönderilecek."
      : conf?.whatsapp
        ? "Onay mesajı WhatsApp üzerinden gönderilecek."
        : conf?.email
          ? "Onay ve iptal bağlantısı e-posta adresinize gönderildi."
          : "Randevunuz işletmeye iletildi.";
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
          <h1 className="mt-4 font-display text-2xl font-semibold">Randevunuz alındı</h1>
          <p className="mt-2 text-neutral-600">{data.salon.name}</p>
          <div className="mt-6 space-y-1 rounded-xl bg-sand-50 p-4 text-left text-sm">
            <div><b>Hizmet:</b> {done.service}</div>
            <div><b>Uzman:</b> {done.staff}</div>
            <div><b>Tarih:</b> {dateTr(done.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(done.startsAt)}</div>
            <div><b>Ücret:</b> {tl(done.price)}</div>
          </div>
          <p className="mt-4 text-xs text-neutral-500" data-testid="onay-metni">
            {confText} Randevunuz bu cihazda bu sayfada da görünür; iptal etmek için {data.salon.name} sayfasına tekrar girebilir ya da bu bağlantıyı kullanabilirsiniz{done.cancelHours ? ` (en geç ${done.cancelHours} saat öncesine kadar)` : ""}:
          </p>
          <Link href={cancelUrl} className="mt-1 block break-all text-sm text-brand-700 underline">Randevuyu görüntüle / iptal et</Link>
          <Button variant="outline" className="mt-4" onClick={() => { setDone(null); setSlot(null); }}>Salon sayfasına dön</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="bg-brand-900 px-5 pb-10 pt-6 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3"><Logo light className="text-base" /><div className="flex flex-col items-end"><NativeHomeLink light salon={{ slug: data.salon.slug, name: data.salon.name }} /><NativeDirectoryLink light /></div></div>
          <h1 className="mt-6 font-display text-3xl font-semibold">{data.salon.name}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-brand-100">
            {data.salon.address && <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{data.salon.address}</span>}
            {data.salon.phone && <span className="inline-flex items-center gap-1"><Phone className="size-4" />{data.salon.phone}</span>}
            <DirectionsLink url={data.salon.directionsUrl} className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-2" />
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-3xl space-y-6 px-4">
        {saved.length > 0 && (
          <Card className="p-5" data-testid="kayitli-randevular">
            <h2 className="font-semibold">Randevularınız</h2>
            <p className="mt-1 text-xs text-neutral-500">Bu cihazdan aldığınız randevular. Yeniden kayıt olmanıza gerek yok.</p>
            <ul className="mt-3 divide-y divide-sand-100">
              {saved.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <b>{dateTr(b.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(b.startsAt)}</b> · {b.service} · {b.staff}
                  </span>
                  <Link href={cancelHref(slug, b)} className="text-brand-700 underline">Görüntüle / iptal et</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {err && <Alert>{err}</Alert>}
        <Card className="p-5">
          <h2 className="font-semibold">1. Hizmet seçin</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data.services.map((s) => (
              <button
                key={s.id}
                onClick={() => { setServiceId(s.id); setStaffId(""); }}
                className={cn("rounded-xl border p-4 text-left transition", serviceId === s.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-sand-200 hover:border-brand-300")}
              >
                <div className="font-medium">{s.name}</div>
                <div className="mt-1 flex items-center gap-3 text-sm text-neutral-500">
                  <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{s.durationMin} dk</span>
                  <span>{tl(s.price)}</span>
                </div>
              </button>
            ))}
            {data.services.length === 0 && <p className="text-sm text-neutral-500">Online randevuya açık hizmet yok.</p>}
          </div>
        </Card>

        {service && (
          <Card className="p-5">
            <h2 className="font-semibold">2. Uzman ve tarih</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {[{ id: "", displayName: "Fark etmez" }, ...staffForService].map((s) => (
                <button key={s.id} onClick={() => setStaffId(s.id)} className={cn("rounded-full border px-4 py-1.5 text-sm", staffId === s.id ? "border-brand-600 bg-brand-600 text-white" : "border-sand-300 bg-white")}>
                  {s.displayName}
                </button>
              ))}
            </div>
            <div className="-mx-5 mt-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:none]">
              {days.map((d) => (
                <button key={d} onClick={() => setDay(d)} className={cn("min-w-16 shrink-0 snap-start rounded-xl border px-3 py-2 text-center", d === day ? "border-brand-600 bg-brand-600 text-white" : "border-sand-200 bg-white")}>
                  <div className="text-xs opacity-80">{dateTr(`${d}T12:00:00+03:00`, { weekday: "short" })}</div>
                  <div className="text-lg font-semibold">{d.slice(8)}</div>
                </button>
              ))}
            </div>
            <div className="mt-4">
              {!uniqueSlots ? (
                <Spinner />
              ) : uniqueSlots.length === 0 ? (
                <p className="text-sm text-neutral-500"><CalendarDays className="mr-1 inline size-4" />Bu gün için boş saat yok. Başka bir gün deneyin.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {uniqueSlots.map((s) => (
                    <button key={s.startsAt} onClick={() => setSlot(s)} className={cn("rounded-lg border py-2 text-sm", slot?.startsAt === s.startsAt ? "border-brand-600 bg-brand-600 text-white" : "border-sand-200 bg-white hover:border-brand-300")}>
                      {timeTr(s.startsAt)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {slot && (
          <Card className="p-5">
            <h2 className="font-semibold">3. Bilgileriniz</h2>
            <p className="mt-1 text-sm text-neutral-500">{service?.name} · {dateTr(slot.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(slot.startsAt)}</p>
            <form onSubmit={book} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Adınız"><Input name="firstName" required autoComplete="given-name" /></Field>
                <Field label="Soyadınız"><Input name="lastName" required autoComplete="family-name" /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cep telefonu"><Input name="phone" type="tel" required autoComplete="tel" placeholder="05xx xxx xx xx" /></Field>
                <Field label="E-posta (isteğe bağlı)" hint="Onay ve iptal bağlantısı e-postanıza gönderilir."><Input name="email" type="email" autoComplete="email" /></Field>
              </div>
              <Field label="Not (isteğe bağlı)"><Textarea name="notes" maxLength={500} /></Field>
              <label className="flex items-start gap-3 text-sm text-neutral-600">
                <input type="checkbox" name="kvkk" required className="mt-1 size-4 accent-brand-600" />
                <span><Link href="/kvkk" target="_blank" className="text-brand-700 underline">Aydınlatma metnini</Link> okudum; randevu için verilerimin işlenmesini kabul ediyorum.</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-neutral-600">
                <input type="checkbox" name="marketing" className="mt-1 size-4 accent-brand-600" />
                <span>Kampanya ve bilgilendirme mesajları almak istiyorum (isteğe bağlı).</span>
              </label>
              <Button size="lg" className="w-full" disabled={busy}>{busy ? "Kaydediliyor…" : "Randevuyu onayla"}</Button>
            </form>
          </Card>
        )}
      </main>
    </div>
  );
}
