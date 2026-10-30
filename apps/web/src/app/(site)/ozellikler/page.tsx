import type { Metadata } from "next";
import Link from "next/link";
import { FEATURES } from "@/components/site/content";
import { PageIntro, TrialCta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Özellikler",
  description: "ProGüzellik özellikleri: randevu ve müşteri, personel ve prim, stok ve kasa, raporlar.",
  alternates: { canonical: "/ozellikler" },
};

export default function Features() {
  return (
    <>
      <PageIntro eyebrow="Özellikler" title="Salon yönetimi için ihtiyacınız olanlar">Randevudan kasaya, personelden stoğa kadar birbirine bağlı modüller.</PageIntro>
      <section className="mx-auto max-w-6xl space-y-6 px-5 pb-16">
        {FEATURES.map((f) => (
          <article key={f.slug} className="rounded-2xl border border-sand-200 bg-white p-6">
            <h2 className="text-xl font-semibold"><Link href={`/ozellikler/${f.slug}`} className="hover:text-brand-700">{f.title}</Link></h2>
            <p className="mt-1 text-neutral-600">{f.intro}</p>
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {f.items.map((i) => <li key={i.title} className="flex gap-2"><span aria-hidden className="text-brand-600">✓</span>{i.title}</li>)}
            </ul>
            <Link href={`/ozellikler/${f.slug}`} className="mt-4 inline-block text-sm font-medium text-brand-700">Ayrıntılar →</Link>
          </article>
        ))}
      </section>
      <TrialCta />
    </>
  );
}
