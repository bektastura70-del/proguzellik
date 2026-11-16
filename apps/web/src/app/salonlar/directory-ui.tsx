import { ChevronRight, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { DirectionsLink } from "@/components/directions-link";
import { SalonOpenLink } from "@/components/native-home-link";
import type { DirectorySalon, Unit } from "@/lib/directory";

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Konum" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-neutral-500">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-4" aria-hidden />}
          {it.href ? <Link href={it.href} className="underline-offset-2 hover:underline">{it.label}</Link> : <span aria-current="page" className="text-neutral-800">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** İl ya da ilçe listesi: büyük dokunma alanlı satırlar, salon sayısıyla. */
export function UnitList({ items, hrefOf }: { items: Unit[]; hrefOf: (u: Unit) => string }) {
  return (
    <ul className="divide-y divide-sand-200 overflow-hidden rounded-2xl border border-sand-200 bg-white">
      {items.map((u) => (
        <li key={u.code}>
          <Link href={hrefOf(u)} className="flex min-h-14 items-center justify-between gap-3 px-4 text-base hover:bg-sand-50">
            <span className="font-medium">{u.name}</span>
            <span className="inline-flex items-center gap-1 text-sm text-neutral-500">
              {u.count} salon <ChevronRight className="size-4" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SalonCard({ s }: { s: DirectorySalon }) {
  return (
    <li className="rounded-2xl border border-sand-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {s.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.logoUrl} alt="" className="size-12 shrink-0 rounded-xl border border-sand-200 object-contain" />
        ) : (
          <div aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 font-semibold text-brand-700">{s.name.slice(0, 1)}</div>
        )}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <h2 className="text-base font-semibold">{s.name}</h2>
          {s.address && <p className="flex items-start gap-1 text-neutral-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{s.address}</p>}
          {s.phone && (
            <p><a href={`tel:${s.phone}`} className="inline-flex min-h-11 items-center gap-1 text-neutral-600 underline-offset-2 hover:underline"><Phone className="size-4" aria-hidden />{s.phone}</a></p>
          )}
          {s.directionsUrl && <p><DirectionsLink url={s.directionsUrl} className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-700 underline-offset-2 hover:underline" /></p>}
        </div>
      </div>
      <SalonOpenLink salon={{ slug: s.slug, name: s.name, logoUrl: s.logoUrl }} className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
        Randevu al
      </SalonOpenLink>
    </li>
  );
}

/** Rehber boşken: salon kodu / QR yolunu hatırlatır. */
export function EmptyDirectory({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-white p-6 text-center text-sm text-neutral-600">
      <p className="font-medium text-neutral-800">{text}</p>
      <p className="mt-2">Salonunuzun QR kodunu okutabilir ya da salonun size verdiği bağlantıyı açabilirsiniz.</p>
    </div>
  );
}
