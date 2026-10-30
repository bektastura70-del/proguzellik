import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { tl } from "@/lib/format";
import { FEATURE_TR, type SiteInfo, type SitePlan } from "@/lib/site";

/** Paket kartları: fiyat, sınır ve özellikler doğrudan veritabanındaki paketlerden gelir. */
export function PricingCards({ plans, vat }: { plans: SitePlan[]; vat: SiteInfo["vat"] }) {
  if (!plans.length) return <p className="text-center text-sm text-neutral-500">Paket bilgisi şu an yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>;
  return (
    <>
      <div className={`grid gap-6 ${plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {plans.map((p) => (
          <article key={p.code} className="flex flex-col rounded-2xl border border-sand-200 bg-white p-6">
            <h3 className="text-xl font-semibold">{p.name}</h3>
            <p className="mt-1 text-sm text-neutral-500">En fazla {p.maxStaff} aktif personel</p>
            <p className="mt-4 text-3xl font-semibold">{tl(p.monthlyPrice)}<span className="text-base font-normal text-neutral-500"> / ay</span></p>
            {Number(p.yearlyPrice) > 0 && <p className="text-sm text-neutral-500">Yıllık: {tl(p.yearlyPrice)}</p>}
            <ul className="mt-5 flex-1 space-y-2 text-sm" aria-label={`${p.name} paketi özellikleri`}>
              {p.features.map((f) => (
                <li key={f} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{FEATURE_TR[f] ?? f}</li>
              ))}
            </ul>
            <Link href={`/ucretsiz-deneme?paket=${p.code}`} className={buttonVariants({ className: "mt-6 w-full", variant: "outline" })}>14 Gün Ücretsiz Dene</Link>
          </article>
        ))}
      </div>
      {vat && <p className="mt-6 text-center text-xs text-neutral-500">Fiyatlara %{Number(vat.rate).toLocaleString("tr-TR")} KDV {vat.included ? "dahildir" : "dahil değildir"}.</p>}
    </>
  );
}
