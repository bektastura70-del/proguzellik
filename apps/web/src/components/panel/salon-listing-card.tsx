"use client";

import { MapPin, Phone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Select, Spinner, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Unit = { code: number; name: string; slug: string };
type Province = Unit & { districts: Unit[] };
type Listing = {
  listing: {
    enabled: boolean; provinceCode: number | null; districtCode: number | null; provinceName: string | null; districtName: string | null;
    showAddress: boolean; showPhone: boolean; enabledAt: string | null; blocked: boolean; blockedReason: string | null;
  };
  visible: boolean;
  issues: string[];
  preview: { name: string; slug: string; logoUrl: string | null; address: string | null; phone: string | null; provinceName: string | null; districtName: string | null };
  salonAddress: string | null;
  salonPhone: string | null;
};

/**
 * "Pro Güzellik uygulamasında listelensin": varsayılan kapalı, il/ilçe zorunlu, adres ve telefon ayrı izinle.
 * Kaydetmeden önce rehberde tam olarak ne görüneceği önizlemede gösterilir. Değiştirmek yalnızca işletme sahibinde.
 */
export function SalonListingCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const q = useApi<Listing>("/directory/listing");
  const units = useApi<{ provinces: Province[] }>("/directory/units");
  const [form, setForm] = useState({ enabled: false, provinceCode: "", districtCode: "", showAddress: false, showPhone: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const l = q.data?.listing;
    if (!l) return;
    setForm({
      enabled: l.enabled,
      provinceCode: l.provinceCode ? String(l.provinceCode) : "",
      districtCode: l.districtCode ? String(l.districtCode) : "",
      showAddress: l.showAddress,
      showPhone: l.showPhone,
    });
  }, [q.data]);

  const province = useMemo(() => units.data?.provinces.find((p) => String(p.code) === form.provinceCode), [units.data, form.provinceCode]);
  const district = province?.districts.find((d) => String(d.code) === form.districtCode);

  if ((q.loading && !q.data) || (units.loading && !units.data)) return <Card><CardBody><Spinner /></CardBody></Card>;
  if (q.error) return <Alert>{q.error.message}</Alert>;
  if (units.error) return <Alert>{units.error.message}</Alert>;
  const d = q.data!;
  const blocked = d.listing.blocked;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      q.setData(await api<Listing>("/directory/listing", {
        method: "PUT",
        body: {
          enabled: form.enabled,
          provinceCode: form.provinceCode ? Number(form.provinceCode) : null,
          districtCode: form.districtCode ? Number(form.districtCode) : null,
          showAddress: form.showAddress,
          showPhone: form.showPhone,
        },
      }));
      toast(form.enabled ? "Rehber ayarı kaydedildi" : "Salonunuz rehberde listelenmiyor");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = blocked ? <Badge tone="red">Rehberden çıkarıldı</Badge> : d.visible ? <Badge tone="green">Rehberde görünüyor</Badge> : <Badge>Listelenmiyor</Badge>;

  return (
    <Card>
      <CardHeader
        title="Pro Güzellik uygulamasında listelensin"
        description="Salon kodunuzu bilmeyen müşteriler Pro Güzellik uygulamasında ve proguzellik.com/salonlar sayfasında şehir ve ilçe seçerek salonunuzu bulabilir (arama motorlarında listelenmez). Varsayılan olarak kapalıdır; istediğiniz zaman kapatabilirsiniz."
        action={status}
      />
      <CardBody>
        <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
          <fieldset className="space-y-4" disabled={!canEdit || busy}>
            <legend className="sr-only">Rehber ayarı</legend>
            {!canEdit && <Alert tone="amber">Bu ayarı yalnızca işletme sahibi değiştirebilir.</Alert>}
            {blocked && (
              <Alert>
                Salonunuz Pro Güzellik tarafından rehberden çıkarıldı{d.listing.blockedReason ? `: ${d.listing.blockedReason}` : ""}. Yeniden listelenmek için info@proguzellik.com adresine yazın.
              </Alert>
            )}
            {err && <Alert>{err}</Alert>}
            {d.issues.length > 0 && form.enabled && d.issues.map((i) => <Alert key={i} tone="amber">{i}</Alert>)}
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="size-5" checked={form.enabled} disabled={blocked && !form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Salonum uygulamadaki ve proguzellik.com/salonlar sayfasındaki salon rehberinde listelensin
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="İl">
                <Select value={form.provinceCode} required={form.enabled} onChange={(e) => setForm({ ...form, provinceCode: e.target.value, districtCode: "" })}>
                  <option value="">Seçin</option>
                  {units.data!.provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="İlçe">
                <Select value={form.districtCode} required={form.enabled} disabled={!province} onChange={(e) => setForm({ ...form, districtCode: e.target.value })}>
                  <option value="">Seçin</option>
                  {province?.districts.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                </Select>
              </Field>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={form.showAddress} disabled={!d.salonAddress} onChange={(e) => setForm({ ...form, showAddress: e.target.checked })} />
              Adresim rehberde görünsün{!d.salonAddress && " (Ayarlar'da adres girilmemiş)"}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={form.showPhone} disabled={!d.salonPhone} onChange={(e) => setForm({ ...form, showPhone: e.target.checked })} />
              Telefonum rehberde görünsün{!d.salonPhone && " (Ayarlar'da telefon girilmemiş)"}
            </label>
            <p className="text-xs text-neutral-500">
              Rehberde salonunuzun adı, logosu ve randevu sayfanız her zaman görünür; adres ve telefon yalnızca işaretlerseniz görünür.
              Şahıs işletmelerinde ad, adres ve telefon kişisel veri sayılabilir. Konum bilgisi alınmaz. Askıya alınan, aboneliği biten ya da online
              randevusu kapalı salonlar rehberde görünmez.
            </p>
            {canEdit && (
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</Button>
              </div>
            )}
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Rehberde böyle görünecek</p>
            <div className="rounded-2xl border border-sand-200 bg-white p-4" aria-label="Rehber önizlemesi">
              <p className="mb-3 text-xs text-neutral-500">{province?.name ?? "İl"} › {district?.name ?? "İlçe"}</p>
              <div className="flex items-start gap-3">
                {d.preview.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.preview.logoUrl} alt="" className="size-12 rounded-xl border border-sand-200 object-contain" />
                ) : (
                  <div aria-hidden className="grid size-12 place-items-center rounded-xl bg-brand-50 font-semibold text-brand-700">{d.preview.name.slice(0, 1)}</div>
                )}
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-semibold">{d.preview.name}</p>
                  {form.showAddress && <ListingLine icon={<MapPin className="size-4 shrink-0" aria-hidden />} text={d.salonAddress ?? ""} />}
                  {form.showPhone && <ListingLine icon={<Phone className="size-4 shrink-0" aria-hidden />} text={d.salonPhone ?? ""} />}
                  <p className="text-xs text-brand-700">Randevu al → proguzellik.com/r/{d.preview.slug}</p>
                </div>
              </div>
            </div>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function ListingLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <p className="flex items-start gap-1 text-neutral-600">{icon}<span>{text}</span></p>;
}
