import type { Metadata } from "next";
import { FAQ } from "@/components/site/content";
import { PageIntro, TrialCta } from "@/components/site/cta";

export const metadata: Metadata = { title: "Sık sorulan sorular", description: "ProGüzellik ücretsiz deneme, paketler, veriler ve kullanım hakkında sık sorulan sorular.", alternates: { canonical: "/sss" } };

export default function Faq() {
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageIntro eyebrow="SSS" title="Sık sorulan sorular" />
      <section className="mx-auto max-w-3xl space-y-3 px-5 pb-16">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-xl border border-sand-200 bg-white p-5">
            <summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}</summary>
            <p className="mt-3 text-neutral-600">{f.a}</p>
          </details>
        ))}
      </section>
      <TrialCta />
    </>
  );
}
