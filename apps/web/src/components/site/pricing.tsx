import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { tl } from "@/lib/format";
import { FEATURE_TR, type SiteInfo, type SitePlan } from "@/lib/site";

const pct = (v: string) => `%${Number(v).toLocaleString("tr-TR")}`;

/**
 * Paket kartları: ad, açıklama, sınırlar ve özellikler veritabanından gelir.
 * Tutar yalnız SaaS sahibinin onayladığı fiyat sürümünden gelir (KDV hariç); onaylı fiyatı olmayan pakette "Fiyat yakında" yazar.
 */
export function PricingCards({ plans, purchase = false }: { plans: SitePlan[]; vat?: SiteInfo["vat"]; purchase?: boolean }) {
  if (!plans.length) return <p className="text-center text-sm text-neutral-500">Paket bilgisi şu an yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>;
  const anyPrice = plans.some((p) => p.monthlyPrice != null);
  return (
    <>
      {!anyPrice && (
        <div className="mb-8 rounded-2xl border border-brand-200 bg-brand-50 p-6 text-center" role="note">
          <h2 className="text-2xl font-semibold text-ink">Fiyatlar Yakında Açıklanacak</h2>
          <p className="mt-2 text-sm text-neutral-600">Paket içerikleri aşağıdadır. Fiyatlar kesinleştiğinde bu sayfada yayımlanacaktır.</p>
        </div>
      )}
      <div className={`grid gap-6 ${plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {plans.map((p) => (
          <article key={p.code} className="flex flex-col rounded-2xl border border-sand-200 bg-white p-6" data-plan={p.code}>
            <h3 className="text-xl font-semibold">{p.name}</h3>
            {p.description && <p className="mt-1 text-sm text-neutral-600">{p.description}</p>}
            <p className="mt-1 text-sm text-neutral-500">En fazla {p.maxStaff} aktif personel</p>
            {p.maxCustomers != null && <p className="text-sm text-neutral-500">En fazla {p.maxCustomers.toLocaleString("tr-TR")} müşteri kaydı</p>}
            {p.maxMonthlyAppointments != null && <p className="text-sm text-neutral-500">Ayda en fazla {p.maxMonthlyAppointments.toLocaleString("tr-TR")} randevu</p>}
            {p.monthlyPrice != null && p.vatRate != null ? (
              <>
                <p className="mt-4 text-3xl font-semibold">{tl(p.monthlyPrice)}<span className="text-base font-normal text-neutral-500"> / ay + KDV</span></p>
                {Number(p.yearlyPrice) > 0 && <p className="text-sm text-neutral-500">Yıllık: {tl(p.yearlyPrice!)} + KDV</p>}
                <p className="text-xs text-neutral-500">Fiyatlara KDV dahil değildir; {pct(p.vatRate)} KDV eklenir.</p>
              </>
            ) : (
              <p className="mt-4 text-lg font-medium text-neutral-500">Fiyat yakında</p>
            )}
            <ul className="mt-5 flex-1 space-y-2 text-sm" aria-label={`${p.name} paketi özellikleri`}>
              {p.features.map((f) => (
                <li key={f} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{FEATURE_TR[f] ?? f}</li>
              ))}
            </ul>
            {purchase && p.monthlyPrice != null && p.vatRate != null && (
              <div className="mt-6 grid gap-2" data-testid={`buy-${p.code}`}>
                <Link href={`/satin-al?paket=${p.code}&donem=MONTHLY`} className={buttonVariants({ className: "w-full" })}>Aylık satın al</Link>
                {Number(p.yearlyPrice) > 0 && <Link href={`/satin-al?paket=${p.code}&donem=YEARLY`} className={buttonVariants({ className: "w-full", variant: "outline" })}>Yıllık satın al</Link>}
              </div>
            )}
            <Link href={`/ucretsiz-deneme?paket=${p.code}`} className={buttonVariants({ className: purchase ? "mt-2 w-full" : "mt-6 w-full", variant: purchase ? "ghost" : "outline" })}>14 Gün Ücretsiz Dene</Link>
          </article>
        ))}
      </div>
    </>
  );
}
