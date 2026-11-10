"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/panel/session";
import type { Onboarding, Service, Staff } from "@/components/panel/types";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { hhmmToMinutes, tl, WEEKDAYS } from "@/lib/format";
import { cn } from "@/lib/utils";

type Settings = { name: string; phone: string | null; address: string | null; onlineBookingEnabled: boolean };

const STEPS = [
  { key: "salon", title: "Salon bilgileri" },
  { key: "services", title: "Hizmetler" },
  { key: "staff", title: "Personel ve saatler" },
  { key: "online", title: "Online randevu" },
  { key: "done", title: "Hazır" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

/** Hazır hizmet listesi: süreler örnek; fiyatı salon kendisi girer. */
const PRESETS: { group: string; items: { name: string; durationMin: number }[] }[] = [
  { group: "Saç", items: [{ name: "Saç kesimi", durationMin: 45 }, { name: "Fön", durationMin: 30 }, { name: "Saç boyama", durationMin: 120 }, { name: "Röfle / balyaj", durationMin: 180 }, { name: "Keratin bakımı", durationMin: 150 }] },
  { group: "Tırnak", items: [{ name: "Manikür", durationMin: 45 }, { name: "Pedikür", durationMin: 60 }, { name: "Kalıcı oje", durationMin: 60 }, { name: "Protez tırnak", durationMin: 90 }] },
  { group: "Kaş ve kirpik", items: [{ name: "Kaş alımı", durationMin: 15 }, { name: "Kaş laminasyonu", durationMin: 45 }, { name: "Kirpik lifting", durationMin: 60 }, { name: "İpek kirpik", durationMin: 120 }] },
  { group: "Cilt ve epilasyon", items: [{ name: "Cilt bakımı", durationMin: 60 }, { name: "Hydrafacial", durationMin: 60 }, { name: "Lazer epilasyon", durationMin: 30 }, { name: "Ağda", durationMin: 30 }] },
  { group: "Makyaj", items: [{ name: "Günlük makyaj", durationMin: 45 }, { name: "Gelin makyajı", durationMin: 120 }] },
];

/** Yeni personele uygulanacak varsayılan hafta: Pazartesi–Cumartesi 09:00–19:00. */
const DEFAULT_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, on: weekday !== 0, start: "09:00", end: "19:00" }));
type WeekRow = (typeof DEFAULT_WEEK)[number];

export default function OnboardingPage() {
  const { can } = useSession();
  const status = useApi<Onboarding>(can("OWNER", "MANAGER") ? "/onboarding" : null);
  const [step, setStep] = useState<StepKey | null>(null);

  // İlk açılışta tamamlanmamış ilk adıma git.
  useEffect(() => {
    if (step || !status.data) return;
    const s = status.data.steps;
    setStep(!s.salon ? "salon" : !s.services ? "services" : !s.staff ? "staff" : !s.online ? "online" : "done");
  }, [status.data, step]);

  if (!can("OWNER", "MANAGER")) return <Alert tone="amber">Kurulum sihirbazını işletme sahibi ve yöneticiler kullanabilir.</Alert>;
  if (status.error) return <Alert>{status.error.message}</Alert>;
  if (!status.data || !step) return <Spinner />;
  const d = status.data;
  const idx = STEPS.findIndex((s) => s.key === step);
  const go = (k: StepKey) => { setStep(k); void status.reload(); window.scrollTo({ top: 0 }); };
  const next = () => go(STEPS[Math.min(idx + 1, STEPS.length - 1)].key);

  return (
    <>
      <PageHeader title="Salonunuzu kuralım" description={`${d.done} / ${d.total} adım tamam. Birkaç dakikada müşterileriniz online randevu alabilir hale gelir.`} action={can("OWNER") && <LaterButton />} />
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuemin={0} aria-valuemax={d.total} aria-valuenow={d.done} aria-label="Kurulum ilerlemesi">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(d.done / d.total) * 100}%` }} />
      </div>
      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => {
          const ok = s.key !== "done" && d.steps[s.key];
          return (
            <li key={s.key}>
              <button type="button" onClick={() => go(s.key)} aria-current={s.key === step ? "step" : undefined}
                className={cn("flex items-center gap-1 rounded-full border px-3 py-1", s.key === step ? "border-brand-600 bg-brand-600 text-white" : ok ? "border-green-200 bg-green-50 text-green-800" : "border-sand-300 text-neutral-600")}>
                {ok && <Check className="size-3" />} {i + 1}. {s.title}
              </button>
            </li>
          );
        })}
      </ol>
      {step === "salon" && <SalonStep onNext={next} />}
      {step === "services" && <ServicesStep onNext={next} />}
      {step === "staff" && <StaffStep onNext={next} />}
      {step === "online" && <OnlineStep status={d} onNext={next} />}
      {step === "done" && <DoneStep status={d} onGo={go} />}
      {step !== "done" && (
        <div className="mt-4 flex justify-between">
          <Button variant="outline" disabled={idx === 0} onClick={() => go(STEPS[idx - 1].key)}>Geri</Button>
          <Button variant="outline" onClick={next}>Bu adımı geç</Button>
        </div>
      )}
    </>
  );
}

function LaterButton() {
  const router = useRouter();
  const toast = useToast();
  return (
    <Button variant="outline" onClick={async () => {
      try {
        await api("/onboarding", { method: "PATCH", body: { dismissed: true } });
        router.push("/panel");
      } catch (e) { toast((e as Error).message, "red"); }
    }}>Sonra yaparım</Button>
  );
}

function SalonStep({ onNext }: { onNext: () => void }) {
  const toast = useToast();
  const s = useApi<Settings>("/settings");
  const [busy, setBusy] = useState(false);
  if (!s.data) return s.error ? <Alert>{s.error.message}</Alert> : <Spinner />;
  return (
    <Card>
      <CardHeader title="Salon bilgileri" description="Online randevu sayfanızda ve müşteri mesajlarında görünür." />
      <CardBody>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api("/settings", { method: "PATCH", body: { name: String(f.get("name")).trim(), phone: String(f.get("phone")).trim(), address: String(f.get("address")).trim() } });
            toast("Salon bilgileri kaydedildi");
            onNext();
          } catch (err) { toast((err as Error).message, "red"); } finally { setBusy(false); }
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Salon adı"><Input name="name" required minLength={2} maxLength={120} defaultValue={s.data.name} /></Field>
            <Field label="Telefon" hint="Müşterilerin sizi arayacağı numara"><Input name="phone" required inputMode="tel" placeholder="05xx xxx xx xx" defaultValue={s.data.phone ?? ""} /></Field>
          </div>
          <Field label="Adres"><Input name="address" required maxLength={300} placeholder="Mahalle, cadde, no, ilçe / il" defaultValue={s.data.address ?? ""} /></Field>
          <Button disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet ve devam et"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

type Pick = { name: string; durationMin: number; price: string; on: boolean };

function ServicesStep({ onNext }: { onNext: () => void }) {
  const toast = useToast();
  const existing = useApi<Service[]>("/services");
  const [picks, setPicks] = useState<Pick[]>(() => PRESETS.flatMap((g) => g.items.map((i) => ({ ...i, price: "", on: false }))));
  const [custom, setCustom] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  if (!existing.data) return existing.error ? <Alert>{existing.error.message}</Alert> : <Spinner />;
  const have = new Set(existing.data.map((s) => s.name.toLocaleLowerCase("tr")));
  const set = (list: "p" | "c", i: number, v: Partial<Pick>) => (list === "p" ? setPicks : setCustom)((xs) => xs.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const chosen = [...picks, ...custom].filter((p) => p.on && p.name.trim() && !have.has(p.name.trim().toLocaleLowerCase("tr")));

  const row = (p: Pick, i: number, list: "p" | "c") => (
    <div key={`${list}${i}`} className="grid grid-cols-[auto_1fr_5.5rem_7rem] items-center gap-2">
      <input type="checkbox" aria-label={`${p.name || "Hizmet"} ekle`} className="accent-brand-600" checked={p.on} onChange={(e) => set(list, i, { on: e.target.checked })} />
      {list === "p" ? <span className="text-sm">{p.name}</span> : <Input aria-label="Hizmet adı" placeholder="Hizmet adı" value={p.name} maxLength={120} onChange={(e) => set(list, i, { name: e.target.value, on: true })} />}
      <Input aria-label={`${p.name || "Hizmet"} süresi (dakika)`} type="number" min={5} max={720} step={5} value={p.durationMin} onChange={(e) => set(list, i, { durationMin: Number(e.target.value) })} />
      <Input aria-label={`${p.name || "Hizmet"} fiyatı (TL)`} type="number" min={0} step="0.01" placeholder="Fiyat ₺" value={p.price} onChange={(e) => set(list, i, { price: e.target.value, on: p.on || e.target.value !== "" })} />
    </div>
  );

  return (
    <Card>
      <CardHeader title="Hizmetler" description="Verdiğiniz hizmetleri işaretleyin; süre ve fiyatı kendinize göre düzenleyin. Sonradan Hizmetler sayfasından değiştirebilirsiniz." />
      <CardBody className="space-y-5">
        {existing.data.length > 0 && (
          <div className="rounded-xl bg-sand-50 p-3 text-sm">
            <p className="mb-1 font-medium">Kayıtlı hizmetleriniz ({existing.data.length})</p>
            <p className="text-neutral-600">{existing.data.map((s) => `${s.name} (${s.durationMin} dk, ${tl(s.price)})`).join(" · ")}</p>
          </div>
        )}
        <div className="grid grid-cols-[auto_1fr_5.5rem_7rem] gap-2 px-0 text-xs text-neutral-500"><span /><span>Hizmet</span><span>Süre (dk)</span><span>Fiyat (₺)</span></div>
        {PRESETS.map((g) => {
          const start = PRESETS.slice(0, PRESETS.indexOf(g)).reduce((n, x) => n + x.items.length, 0);
          return (
            <fieldset key={g.group} className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-brand-800">{g.group}</legend>
              {g.items.map((it, k) => (have.has(it.name.toLocaleLowerCase("tr")) ? null : row(picks[start + k], start + k, "p")))}
            </fieldset>
          );
        })}
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-brand-800">Kendi hizmetleriniz</legend>
          {custom.map((p, i) => row(p, i, "c"))}
          <Button type="button" size="sm" variant="outline" onClick={() => setCustom((c) => [...c, { name: "", durationMin: 30, price: "", on: true }])}>+ Hizmet ekle</Button>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 border-t border-sand-200 pt-4">
          <Button disabled={busy || chosen.length === 0} onClick={async () => {
            const missing = chosen.find((p) => p.price === "" || !(Number(p.price) >= 0) || !(p.durationMin >= 5));
            if (missing) return toast(`"${missing.name}" için süre ve fiyat girin`, "red");
            setBusy(true);
            let added = 0;
            try {
              for (const p of chosen) {
                await api("/services", { method: "POST", body: { name: p.name.trim(), durationMin: p.durationMin, price: Number(p.price) } });
                added++;
              }
              toast(`${added} hizmet eklendi`);
              onNext();
            } catch (err) {
              toast(`${added} hizmet eklendi; sonraki eklenemedi: ${(err as Error).message}`, "red");
              void existing.reload();
            } finally { setBusy(false); }
          }}>{busy ? "Ekleniyor…" : chosen.length ? `${chosen.length} hizmeti ekle ve devam et` : "Hizmet seçin"}</Button>
          {existing.data.length > 0 && <Button variant="outline" onClick={onNext}>Mevcut hizmetlerle devam et</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

function WeekEditor({ rows, onChange }: { rows: WeekRow[]; onChange: (r: WeekRow[]) => void }) {
  // Pazartesi'den başlayarak göster.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const set = (wd: number, v: Partial<WeekRow>) => onChange(rows.map((r) => (r.weekday === wd ? { ...r, ...v } : r)));
  return (
    <div className="space-y-2">
      {order.map((wd) => {
        const r = rows.find((x) => x.weekday === wd)!;
        return (
          <div key={wd} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-32 items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={r.on} onChange={(e) => set(wd, { on: e.target.checked })} />{WEEKDAYS[wd]}</label>
            <Input aria-label={`${WEEKDAYS[wd]} başlangıç`} type="time" className="w-28" disabled={!r.on} value={r.start} onChange={(e) => set(wd, { start: e.target.value })} />
            <span>–</span>
            <Input aria-label={`${WEEKDAYS[wd]} bitiş`} type="time" className="w-28" disabled={!r.on} value={r.end} onChange={(e) => set(wd, { end: e.target.value })} />
            {!r.on && <span className="text-xs text-neutral-500">Kapalı</span>}
          </div>
        );
      })}
    </div>
  );
}

function StaffStep({ onNext }: { onNext: () => void }) {
  const toast = useToast();
  const { me } = useSession();
  const staff = useApi<Staff[]>("/staff");
  const services = useApi<Service[]>("/services");
  const [week, setWeek] = useState<WeekRow[]>(DEFAULT_WEEK);
  const [self, setSelf] = useState(true);
  const [names, setNames] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  if (!staff.data || !services.data) return <Spinner />;
  const mine = staff.data.some((s) => s.userId === me?.id);
  const incomplete = staff.data.filter((s) => !s.workingHours.length || !s.services.length);
  const toAdd = [...(self && !mine && me ? [{ displayName: me.fullName, userId: me.id }] : []), ...names.map((n) => n.trim()).filter(Boolean).map((displayName) => ({ displayName, userId: null as string | null }))];
  const hours = week.filter((r) => r.on).map((r) => ({ weekday: r.weekday, startMin: hhmmToMinutes(r.start), endMin: hhmmToMinutes(r.end) }));
  const serviceIds = services.data.map((s) => s.id);

  const save = async () => {
    if (hours.some((h) => !(h.startMin < h.endMin))) return toast("Her açık gün için başlangıç saati bitişten önce olmalı", "red");
    if (!hours.length) return toast("En az bir çalışma günü seçin", "red");
    setBusy(true);
    try {
      for (const p of toAdd) {
        const s = await api<Staff>("/staff", { method: "POST", body: p.userId ? { displayName: p.displayName, userId: p.userId } : { displayName: p.displayName } });
        await api(`/staff/${s.id}/services`, { method: "PUT", body: { serviceIds } });
        await api(`/staff/${s.id}/working-hours`, { method: "PUT", body: { hours } });
      }
      // Saati veya hizmeti eksik kayıtlı personel de aynı ayarla tamamlanır (var olanlar değiştirilmez).
      for (const s of incomplete) {
        if (!s.services.length) await api(`/staff/${s.id}/services`, { method: "PUT", body: { serviceIds } });
        if (!s.workingHours.length) await api(`/staff/${s.id}/working-hours`, { method: "PUT", body: { hours } });
      }
      toast("Personel kaydedildi");
      onNext();
    } catch (err) {
      toast((err as Error).message, "red");
      void staff.reload();
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Personel ve çalışma saatleri" description="Randevu alınabilmesi için en az bir kişinin çalışma saati ve verdiği hizmetler tanımlı olmalı." />
      <CardBody className="space-y-5 text-sm">
        {!services.data.length && <Alert tone="amber">Önce en az bir hizmet ekleyin; personele hizmetler otomatik atanır.</Alert>}
        {staff.data.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Kayıtlı personel</p>
            <ul className="space-y-1">
              {staff.data.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  {s.displayName}
                  {!s.workingHours.length || !s.services.length
                    ? <Badge tone="amber">{!s.workingHours.length ? "Çalışma saati yok" : "Hizmet atanmamış"}</Badge>
                    : <Badge tone="green">Hazır</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!mine && (
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={self} onChange={(e) => setSelf(e.target.checked)} /> Ben de hizmet veriyorum ({me?.fullName})</label>
        )}
        <div className="space-y-2">
          <p className="font-medium">Diğer çalışanlar</p>
          {names.map((n, i) => (
            <Input key={i} aria-label={`Çalışan ${i + 1} adı`} placeholder="Ad Soyad (ör. Elif Yılmaz)" maxLength={80} value={n} onChange={(e) => setNames((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setNames((xs) => [...xs, ""])}>+ Çalışan ekle</Button>
          <p className="text-xs text-neutral-500">Çalışanlara panel girişi vermek isterseniz daha sonra Ayarlar &gt; Ekip bölümünden davet edebilirsiniz.</p>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Çalışma saatleri</p>
          <p className="text-xs text-neutral-500">Eklenen herkese uygulanır; kişiye özel saatleri sonra Personel sayfasından değiştirebilirsiniz.</p>
          <WeekEditor rows={week} onChange={setWeek} />
        </div>
        <div className="flex flex-wrap gap-3 border-t border-sand-200 pt-4">
          <Button disabled={busy || !services.data.length || (toAdd.length === 0 && incomplete.length === 0)} onClick={() => void save()}>
            {busy ? "Kaydediliyor…" : toAdd.length || incomplete.length ? "Kaydet ve devam et" : "Eklenecek kişi yok"}
          </Button>
          {staff.data.length > 0 && incomplete.length === 0 && toAdd.length === 0 && <Button variant="outline" onClick={onNext}>Devam et</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

function CopyLink({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Online randevu bağlantısı" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" variant="outline" aria-label="Bağlantıyı kopyala" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* panoya erişim yok */ }
      }}>{ok ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl border border-sand-300 px-3" aria-label="Randevu sayfasını aç"><ExternalLink className="size-4" /></a>
    </div>
  );
}

function OnlineStep({ status, onNext }: { status: Onboarding; onNext: () => void }) {
  const toast = useToast();
  const s = useApi<Settings>("/settings");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!s.data) return <Spinner />;
  const url = `${origin}/r/${status.slug}`;
  const ready = status.steps.staff;
  return (
    <Card>
      <CardHeader title="Online randevu" description="Müşterileriniz bu bağlantıdan 7/24 randevu alabilir. Instagram profilinize, Google işletme kaydınıza veya WhatsApp durumunuza ekleyin." />
      <CardBody className="space-y-4 text-sm">
        {!ready && <Alert tone="amber">Randevu sayfasında saat görünmesi için önce çalışma saati ve hizmeti olan en az bir personel ekleyin.</Alert>}
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand-600" checked={s.data.onlineBookingEnabled} onChange={async (e) => {
            try { await api("/settings", { method: "PATCH", body: { onlineBookingEnabled: e.target.checked } }); void s.reload(); } catch (err) { toast((err as Error).message, "red"); }
          }} />
          Online randevu açık
        </label>
        <CopyLink url={url} />
        <Button onClick={onNext}>Devam et</Button>
      </CardBody>
    </Card>
  );
}

function DoneStep({ status, onGo }: { status: Onboarding; onGo: (k: StepKey) => void }) {
  const { has, can } = useSession();
  const missing = STEPS.filter((s) => s.key !== "done" && !status.steps[s.key]);
  const extras = [
    { href: "/panel/takvim", title: "İlk randevuyu ekleyin", text: "Takvimden telefonla gelen randevuları girin." },
    can("OWNER", "MANAGER") && { href: "/panel/ayarlar", title: "Ekibinizi davet edin", text: "Resepsiyon ve personele kendi girişlerini verin." },
    { href: "/panel/paketler", title: "Paket tanımlayın", text: "Seanslı hizmetleri (ör. 6 seans lazer) paket olarak satın." },
    has("WHATSAPP") && { href: "/panel/kanallar", title: "WhatsApp'ı bağlayın", text: "Müşteri mesajları ve hatırlatmalar panele gelsin." },
  ].filter(Boolean) as { href: string; title: string; text: string }[];
  return (
    <Card>
      <CardHeader title={status.complete ? "Salonunuz hazır 🎉" : "Neredeyse hazır"} description={status.complete ? "Müşterileriniz artık online randevu alabilir." : "Aşağıdaki adımlar tamamlanınca online randevu çalışır."} />
      <CardBody className="space-y-4 text-sm">
        {missing.length > 0 && (
          <ul className="space-y-2">
            {missing.map((m) => <li key={m.key}><button type="button" className="text-brand-700 underline" onClick={() => onGo(m.key)}>{m.title} adımını tamamlayın</button></li>)}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {extras.map((x) => (
            <Link key={x.href} href={x.href} className="rounded-2xl border border-sand-200 p-4 transition hover:border-brand-300 hover:shadow-sm">
              <p className="font-medium">{x.title}</p>
              <p className="text-neutral-500">{x.text}</p>
            </Link>
          ))}
        </div>
        <Link href="/panel" className="inline-block text-brand-700 underline">Genel bakışa dön</Link>
      </CardBody>
    </Card>
  );
}
