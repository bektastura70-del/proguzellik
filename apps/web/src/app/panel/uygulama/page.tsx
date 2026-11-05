"use client";

import { ExternalLink, ImageUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Field, Input, PageHeader, Spinner, Textarea, useToast } from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { SalonQrCard } from "@/components/panel/salon-qr";

type Asset = { id: string; kind: string; mime: string; width: number; height: number };
type Branding = {
  salonName: string;
  slug: string;
  appUrl: string;
  flags: { customerPwaEnabled: boolean; customerBookingEnabled: boolean; customerSessionTrackingEnabled: boolean; webPushEnabled: boolean };
  branding: { appName: string | null; shortName: string | null; description: string | null; primaryColor: string | null; secondaryColor: string | null; logo: Asset | null; icon: Asset | null };
  rules: { cancelMinHours: number; rescheduleMinHours: number; allowCustomerCancel: boolean; allowCustomerReschedule: boolean };
};

const DEFAULT_PRIMARY = "#4a2535";
const DEFAULT_SECONDARY = "#c9a227";

/** Salon uygulaması (müşteri PWA'sı) ayarları: ad, renk, logo/simge ve müşteri iptal/değişiklik kuralları. */
export default function SalonAppSettingsPage() {
  const { can } = useSession();
  const toast = useToast();
  const q = useApi<Branding>("/pwa/branding");
  const [form, setForm] = useState({ appName: "", shortName: "", description: "", primaryColor: DEFAULT_PRIMARY, secondaryColor: DEFAULT_SECONDARY, cancelMinHours: 2, rescheduleMinHours: 2, allowCustomerCancel: true, allowCustomerReschedule: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = q.data;
    if (!d) return;
    setForm({
      appName: d.branding.appName ?? "",
      shortName: d.branding.shortName ?? "",
      description: d.branding.description ?? "",
      primaryColor: d.branding.primaryColor ?? DEFAULT_PRIMARY,
      secondaryColor: d.branding.secondaryColor ?? DEFAULT_SECONDARY,
      ...d.rules,
    });
  }, [q.data]);

  if (!can("OWNER", "MANAGER")) return <Empty title="Bu sayfa yalnızca işletme sahibi ve yönetici içindir" />;
  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <Alert>{q.error.message}</Alert>;
  const d = q.data!;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setErr(null);
    try {
      q.setData(await api<Branding>("/pwa/branding", { method: "PATCH", body: { ...form, appName: form.appName || null, shortName: form.shortName || null, description: form.description || null } }));
      toast("Salon uygulaması ayarları kaydedildi");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "logo" | "icon", file: File) {
    setBusy(kind);
    setErr(null);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Yalnızca PNG, JPEG veya WebP yükleyebilirsiniz");
      if (file.size > 512 * 1024) throw new Error("Görsel en fazla 512 KB olabilir");
      const res = await fetch(`/api/p/pwa/branding/${kind}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, Array.isArray(data?.message) ? data.message.join(", ") : (data?.message ?? "Yükleme başarısız"));
      await q.reload();
      toast(kind === "logo" ? "Logo yüklendi" : "Uygulama simgesi yüklendi");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: "logo" | "icon") {
    setBusy(kind);
    try {
      q.setData(await api<Branding>(`/pwa/branding/${kind}`, { method: "DELETE" }));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const appLive = d.flags.customerPwaEnabled || d.flags.customerBookingEnabled;
  const name = form.appName || d.salonName;
  const short = (form.shortName || name).slice(0, 12);

  return (
    <>
      <PageHeader
        title="Salon uygulaması"
        description="Müşterilerinizin telefonuna ekleyebileceği, salonunuzun adı ve renkleriyle görünen randevu uygulaması."
        action={appLive ? (
          <a href={d.appUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
            Uygulamayı aç <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : undefined}
      />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={save} className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Görünüm" description="Ad ve renkler müşteri uygulamasında ve telefonun ana ekranında görünür." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Uygulama adı" hint={`Boş bırakırsanız "${d.salonName}" kullanılır`}>
                <Input value={form.appName} maxLength={40} onChange={(e) => set("appName", e.target.value)} placeholder={d.salonName} />
              </Field>
              <Field label="Kısa ad" hint="Ana ekranda simgenin altında (en fazla 12 karakter)">
                <Input value={form.shortName} maxLength={12} onChange={(e) => set("shortName", e.target.value)} placeholder={short} />
              </Field>
              <Field label="Açıklama" className="sm:col-span-2">
                <Textarea value={form.description} maxLength={160} rows={2} onChange={(e) => set("description", e.target.value)} placeholder="Ör. Lazer epilasyon ve cilt bakımında uzman salon" />
              </Field>
              <Field label="Ana renk">
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="Ana renk seçici" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border border-sand-200" />
                  <Input value={form.primaryColor} pattern="#[0-9a-fA-F]{6}" onChange={(e) => set("primaryColor", e.target.value)} />
                </div>
              </Field>
              <Field label="İkinci renk">
                <div className="flex items-center gap-2">
                  <input type="color" aria-label="İkinci renk seçici" value={form.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border border-sand-200" />
                  <Input value={form.secondaryColor} pattern="#[0-9a-fA-F]{6}" onChange={(e) => set("secondaryColor", e.target.value)} />
                </div>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Müşteri iptal ve değişiklik kuralları" description="Müşteri uygulamadan yalnızca bu kurallar içinde iptal veya saat değişikliği yapabilir." />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" className="size-5" checked={form.allowCustomerCancel} onChange={(e) => set("allowCustomerCancel", e.target.checked)} />
                Müşteri randevusunu iptal edebilir
              </label>
              <Field label="İptal için en az kaç saat önce">
                <Input type="number" min={0} max={168} value={form.cancelMinHours} disabled={!form.allowCustomerCancel} onChange={(e) => set("cancelMinHours", Number(e.target.value))} />
              </Field>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" className="size-5" checked={form.allowCustomerReschedule} onChange={(e) => set("allowCustomerReschedule", e.target.checked)} />
                Müşteri randevu saatini değiştirebilir
              </label>
              <Field label="Değişiklik için en az kaç saat önce">
                <Input type="number" min={0} max={168} value={form.rescheduleMinHours} disabled={!form.allowCustomerReschedule} onChange={(e) => set("rescheduleMinHours", Number(e.target.value))} />
              </Field>
            </CardBody>
          </Card>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </form>

        <div className="space-y-4">
          {d.flags.customerPwaEnabled && <SalonQrCard slug={d.slug} salonName={d.branding.appName ?? d.salonName} />}
          <Card>
            <CardHeader title="Önizleme" />
            <CardBody>
              <div className="overflow-hidden rounded-2xl border border-sand-200">
                <div className="flex items-center gap-3 p-4 text-white" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})` }}>
                  {d.branding.logo && appLive ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/r/${d.slug}/marka/${d.branding.logo.id}`} alt="" className="size-10 rounded-lg bg-white object-contain p-0.5" />
                  ) : (
                    <div aria-hidden className="grid size-10 place-items-center rounded-lg bg-white/20 font-semibold">{name.slice(0, 1)}</div>
                  )}
                  <span className="truncate font-semibold">{name}</span>
                </div>
                <div className="p-4 text-sm text-neutral-600">{form.description || "Online randevu"}</div>
              </div>
            </CardBody>
          </Card>
          <AssetCard title="Logo" hint="PNG, JPEG veya WebP · en fazla 512 KB" asset={d.branding.logo} busy={busy === "logo"} previewUrl={d.branding.logo && appLive ? `/r/${d.slug}/marka/${d.branding.logo.id}` : null} onUpload={(f) => upload("logo", f)} onRemove={() => remove("logo")} accept="image/png,image/jpeg,image/webp" />
          <AssetCard title="Uygulama simgesi" hint="Kare PNG veya JPEG · en az 192×192, önerilen 512×512 · en fazla 512 KB. Yüklenmezse salon renginde baş harfli simge kullanılır." asset={d.branding.icon} busy={busy === "icon"} previewUrl={d.flags.customerPwaEnabled ? `/r/${d.slug}/simge/192?v=${d.branding.icon?.id ?? "varsayilan"}` : null} onUpload={(f) => upload("icon", f)} onRemove={() => remove("icon")} accept="image/png,image/jpeg" />
          <Card>
            <CardHeader title="Özellik durumu" description="Bu özellikler ProGüzellik tarafından işletmenize açılır." />
            <CardBody className="space-y-2 text-sm">
              {[
                ["Ana ekrana eklenebilir uygulama", d.flags.customerPwaEnabled],
                ["Müşteri girişi ve online randevu yönetimi", d.flags.customerBookingEnabled],
                ["Paket ve kalan seans görünümü", d.flags.customerSessionTrackingEnabled],
                ["Anlık bildirimler", d.flags.webPushEnabled],
              ].map(([label, on]) => (
                <div key={label as string} className="flex items-center justify-between gap-2">
                  <span>{label}</span>
                  <Badge tone={on ? "green" : "neutral"}>{on ? "Açık" : "Kapalı"}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function AssetCard({ title, hint, asset, busy, previewUrl, onUpload, onRemove, accept }: { title: string; hint: string; asset: Asset | null; busy: boolean; previewUrl: string | null; onUpload: (f: File) => void; onRemove: () => void; accept: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader title={title} description={hint} />
      <CardBody className="flex items-center gap-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${title} önizlemesi`} className="size-16 rounded-xl border border-sand-200 bg-white object-contain" />
        ) : (
          <div className="grid size-16 place-items-center rounded-xl border border-dashed border-sand-300 text-xs text-neutral-400">{asset ? `${asset.width}×${asset.height}` : "Yok"}</div>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={accept} className="sr-only" aria-label={`${title} dosyası seç`} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp className="size-4" aria-hidden /> {busy ? "Yükleniyor…" : asset ? "Değiştir" : "Yükle"}
          </Button>
          {asset && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove} aria-label={`${title} kaldır`}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
