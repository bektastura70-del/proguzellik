import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FEATURES } from "@/components/site/content";
import { PageIntro, TrialCta } from "@/components/site/cta";

export const dynamicParams = false;
export const generateStaticParams = () => FEATURES.map((f) => ({ slug: f.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = FEATURES.find((x) => x.slug === slug);
  return f ? { title: f.title, description: f.metaDescription, alternates: { canonical: `/ozellikler/${f.slug}` } } : {};
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = FEATURES.find((x) => x.slug === slug);
  if (!f) notFound();
  return (
    <>
      <nav aria-label="Konum" className="mx-auto max-w-6xl px-5 pt-6 text-sm text-neutral-500"><Link href="/ozellikler" className="hover:text-brand-700">Özellikler</Link> / <span aria-current="page">{f.title}</span></nav>
      <PageIntro title={f.title}>{f.intro}</PageIntro>
      <section className="mx-auto grid max-w-6xl gap-5 px-5 pb-12 sm:grid-cols-2 lg:grid-cols-3">
        {f.items.map((i) => (
          <div key={i.title} className="rounded-2xl border border-sand-200 bg-white p-5">
            <h2 className="font-semibold">{i.title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{i.text}</p>
          </div>
        ))}
      </section>
      {f.note && <p className="mx-auto max-w-6xl px-5 pb-12 text-sm text-neutral-500">Not: {f.note}</p>}
      <nav aria-label="Diğer özellikler" className="mx-auto flex max-w-6xl flex-wrap gap-2 px-5 pb-14">
        {FEATURES.filter((x) => x.slug !== f.slug).map((x) => <Link key={x.slug} href={`/ozellikler/${x.slug}`} className="rounded-full border border-sand-200 bg-white px-4 py-2 text-sm hover:border-brand-300">{x.title}</Link>)}
      </nav>
      <TrialCta />
    </>
  );
}
