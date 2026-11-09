import type { Metadata } from "next";
import { PageIntro, TrialCta } from "@/components/site/cta";
import { PricingCards } from "@/components/site/pricing";
import { getPlans, getPurchaseOpen, getSiteInfo } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fiyatlar", description: "ProGüzellik paketleri ve fiyatları. Personel sayınıza göre paket seçin; 14 gün ücretsiz deneyin.", alternates: { canonical: "/fiyatlar" } };

export default async function Pricing() {
  const [plans, site, purchase] = await Promise.all([getPlans(), getSiteInfo(), getPurchaseOpen()]);
  return (
    <>
      <PageIntro eyebrow="Fiyatlar" title="Personel sayınıza uygun paketi seçin">{purchase ? "Paketinizi hemen satın alabilir ya da 14 gün ücretsiz deneyebilirsiniz; deneme için ödeme bilgisi istenmez." : "Her pakette 14 günlük ücretsiz deneme vardır; deneme için ödeme bilgisi istenmez."}</PageIntro>
      <section className="mx-auto max-w-6xl px-5 pb-16"><PricingCards plans={plans} vat={site.vat} purchase={purchase} /></section>
      <section className="mx-auto max-w-3xl px-5 pb-16 text-sm text-neutral-600">
        <h2 className="mb-2 text-base font-semibold text-ink">Ödeme</h2>
        {purchase ? (
          <p>&quot;Satın al&quot; ile paketinizi kartla, iyzico güvencesiyle hemen alabilirsiniz; hesabınız ödeme alındığında açılır. Abonelik her dönem otomatik yenilenir ve panelden istediğiniz zaman iptal edilebilir. Denemedeki ya da mevcut hesabınız için paketi panelinizdeki Abonelik sayfasından alın. Sorularınız için <a className="text-brand-700 underline" href={`mailto:${site.company.email}`}>{site.company.email}</a>.</p>
        ) : (
          <p>Ücretli pakete geçiş için <a className="text-brand-700 underline" href={`mailto:${site.company.email}`}>{site.company.email}</a> adresine yazabilirsiniz. Paketiniz tanımlandığında hesabınız kaldığı yerden devam eder.</p>
        )}
      </section>
      <TrialCta />
    </>
  );
}
