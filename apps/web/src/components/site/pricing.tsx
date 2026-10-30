import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { tl } from "@/lib/format";
import { FEATURE_TR, type SiteInfo, type SitePlan } from "@/lib/site";

/** Paket kartları: fiyat, sınır ve özellikler doğrudan veritabanındaki paketlerden gelir. */
/** Fiyatlar açıklanmadıysa (API tutarları null döndürür) kartlarda tutar yerine bilgilendirme gösterilir. */
export function PricingCards({ plans, vat }: { plans: SitePlan[]; vat: SiteInfo["vat"] }) {
  if (!plans.length) return <p className="text-center text-sm text-neutral-500">Paket bilgisi şu an yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>;
  const announced = plans.every((p) => p.monthlyPrice != null);
  return (
    <>
      {!announced && (
        <div className="mb-8 rounded-2xl border border-brand-200 bg-brand-50 p-6 text-center" role="note">
          <h2 className="text-2xl font-semibold text-ink">Fiyatlar Yakında Açıklanacak</h2>
          <p className="mt-2 text-sm text-neutral-600">Paket içerikleri aşağıdadır. Fiyatlar kesinleştiğinde bu sayfada yayımlanacaktır.</p>
        </div>
      )}
      <div className={`grid gap-6 ${plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {plans.map((p) => (
          <article key={p.code} className="flex flex-col rounded-2xl border border-sand-200 bg-white p-6">
            <h3 className="text-xl font-semibold">{p.name}</h3>
            <p className="mt-1 text-sm text-neutral-500">En fazla {p.maxStaff} aktif personel</p>
            {p.monthlyPrice != null ? (
              <>
                <p className="mt-4 text-3xl font-semibold">{tl(p.monthlyPrice)}<span className="text-base font-normal text-neutral-500"> / ay + KDV</span></p>
                {Number(p.yearlyPrice) > 0 && <p className="text-sm text-neutral-500">Yıllık: {tl(p.yearlyPrice!)} + KDV</p>}
              </>
            ) : (
              <p className="mt-4 text-lg font-medium text-neutral-500">Fiyat yakında</p>
            )}
            <ul className="mt-5 flex-1 space-y-2 text-sm" aria-label={`${p.name} paketi özellikleri`}>
              {p.features.map((f) => (
                <li key={f} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{FEATURE_TR[f] ?? f}</li>
              ))}
            </ul>
            <Link href={`/ucretsiz-deneme?paket=${p.code}`} className={buttonVariants({ className: "mt-6 w-full", variant: "outline" })}>14 Gün Ücretsiz Dene</Link>
          </article>
        ))}
      </div>
      {announced && (
        <p className="mt-6 text-center text-xs text-neutral-500">
          {vat ? `Fiyatlara %${Number(vat.rate).toLocaleString("tr-TR")} KDV ${vat.included ? "dahildir" : "dahil değildir"}.` : "Fiyatlara KDV dahil değildir."}
        </p>
      )}
    </>
  );
}
