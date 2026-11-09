import { CalendarCheck2, HandCoins, LineChart, PackageCheck, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrialCta } from "@/components/site/cta";
import { PricingCards } from "@/components/site/pricing";
import { FEATURES } from "@/components/site/content";
import { buttonVariants } from "@/components/ui/button-variants";
import { getPlans, getPurchaseOpen, getSiteInfo, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "ProGüzellik — Güzellik salonu yönetim yazılımı" },
  description: "Randevu, müşteri, personel, kasa, paket ve stok yönetimi tek panelde. Güzellik salonları için Türkçe bulut yazılım. 14 gün ücretsiz deneyin.",
  alternates: { canonical: "/" },
  openGraph: { title: "ProGüzellik — Güzellik salonu yönetim yazılımı", description: "Randevu, müşteri, kasa, paket ve stok yönetimi tek panelde.", url: SITE_URL, siteName: "ProGüzellik", locale: "tr_TR", type: "website" },
};

const ICONS = [CalendarCheck2, Users, HandCoins, LineChart];
const STRIP = [
  { icon: PackageCheck, title: "Paket ve seans", text: "Seanslı paketlerde kalan seans müşteri kartında." },
  { icon: ShieldCheck, title: "Veri ayrımı ve güvenlik", text: "Her işletmenin verisi ayrı; iki adımlı doğrulama." },
];

export default async function Home() {
  const [plans, site, purchase] = await Promise.all([getPlans(), getSiteInfo(), getPurchaseOpen()]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ProGüzellik",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "tr",
    url: SITE_URL,
    description: "Güzellik salonları için randevu, müşteri, personel, kasa, paket ve stok yönetimi.",
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-10 md:grid-cols-2 md:pt-16">
        <div>
          <p className="mb-4 inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800">Güzellik salonları için</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">Randevudan kasaya, salonunuz <span className="text-brand-600">tek panelde.</span></h1>
          <p className="mt-5 max-w-lg text-lg text-neutral-600">Randevu, müşteri, personel, kasa, paket ve stok yönetimi. Telefondan, tabletten ve bilgisayardan çalışır.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/ucretsiz-deneme" className={buttonVariants({ size: "lg" })}>14 Gün Ücretsiz Dene</Link>
            <Link href="/giris" className={buttonVariants({ size: "lg", variant: "outline" })}>Giriş Yap</Link>
          </div>
          <p className="mt-3 text-sm text-neutral-500">Kredi kartı gerekmez · Deneme bitince verileriniz silinmez</p>
        </div>
        <div className="relative" aria-hidden>
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-brand-200/60 to-sand-200 blur-2xl" />
          <div className="relative rounded-[1.75rem] border border-sand-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between text-sm"><span className="font-semibold">Örnek takvim</span><span className="text-neutral-500">Bugün</span></div>
            {[
              ["09:30", "Cilt bakımı", "Personel 1", "bg-brand-100 text-brand-800"],
              ["11:00", "Lazer epilasyon · 3/6 seans", "Personel 2", "bg-emerald-50 text-emerald-800"],
              ["13:15", "Kalıcı oje", "Personel 3", "bg-amber-50 text-amber-900"],
              ["15:00", "Kaş laminasyonu", "Personel 1", "bg-sky-50 text-sky-800"],
            ].map(([t, s, p, c]) => (
              <div key={t} className="mb-2 flex items-center gap-3 rounded-xl border border-sand-100 p-3">
                <span className="w-12 text-sm font-semibold">{t}</span>
                <span className={`flex-1 rounded-lg px-3 py-2 text-sm ${c}`}>{s}</span>
                <span className="hidden text-xs text-neutral-500 sm:inline">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16" aria-labelledby="ozellikler-baslik">
        <div className="mx-auto max-w-6xl px-5">
          <h2 id="ozellikler-baslik" className="font-display text-3xl font-semibold">Salonunuzun günlük işleri için</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {FEATURES.map((f, i) => {
              const Icon = ICONS[i];
              return (
                <Link key={f.slug} href={`/ozellikler/${f.slug}`} className="group rounded-2xl border border-sand-200 p-6 transition hover:border-brand-300 hover:shadow-sm">
                  <Icon className="size-6 text-brand-600" aria-hidden />
                  <h3 className="mt-4 font-semibold group-hover:text-brand-700">{f.title}</h3>
                  <p className="mt-1 text-sm text-neutral-600">{f.short}</p>
                </Link>
              );
            })}
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {STRIP.map((s) => (
              <div key={s.title} className="flex items-start gap-3 rounded-2xl bg-sand-50 p-5">
                <s.icon className="size-5 shrink-0 text-brand-600" aria-hidden />
                <div><h3 className="font-semibold">{s.title}</h3><p className="text-sm text-neutral-600">{s.text}</p></div>
              </div>
            ))}
          </div>
          <Link href="/ozellikler" className="mt-6 inline-block text-sm font-medium text-brand-700">Tüm özellikler →</Link>
        </div>
      </section>

      <section id="paketler" className="mx-auto max-w-6xl px-5 py-16" aria-labelledby="paketler-baslik">
        <h2 id="paketler-baslik" className="text-center font-display text-3xl font-semibold">Paketler</h2>
        <p className="mb-10 mt-2 text-center text-neutral-600">Personel sayınıza göre seçin; deneme süresince seçtiğiniz paketin özellikleri açıktır.</p>
        <PricingCards plans={plans} vat={site.vat} purchase={purchase} />
      </section>

      <TrialCta />
    </>
  );
}
