import type { Metadata } from "next";
import { PageIntro } from "@/components/site/cta";
import { getSiteInfo } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "İletişim", description: "ProGüzellik ile iletişime geçin.", alternates: { canonical: "/iletisim" } };

export default async function Contact() {
  const { company } = await getSiteInfo();
  return (
    <>
      <PageIntro eyebrow="İletişim" title="Bize ulaşın">Paketler, ücretli geçiş veya hesabınızla ilgili sorularınız için yazabilirsiniz.</PageIntro>
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-sand-200 bg-white p-5"><dt className="text-sm text-neutral-500">E-posta</dt><dd className="mt-1 font-medium"><a className="text-brand-700" href={`mailto:${company.email}`}>{company.email}</a></dd></div>
          {company.phone && <div className="rounded-2xl border border-sand-200 bg-white p-5"><dt className="text-sm text-neutral-500">Telefon</dt><dd className="mt-1 font-medium"><a href={`tel:${company.phone.replace(/\s/g, "")}`}>{company.phone}</a></dd></div>}
          {(company.legalName || company.address) && <div className="rounded-2xl border border-sand-200 bg-white p-5"><dt className="text-sm text-neutral-500">Adres</dt><dd className="mt-1">{company.legalName && <div className="font-medium">{company.legalName}</div>}{company.address}</dd></div>}
        </dl>
        <p className="mt-6 text-sm text-neutral-500">Kişisel verilerinizle ilgili başvurular için <a className="underline" href="/kvkk">KVKK Aydınlatma Metni</a>&apos;ndeki başvuru yolunu kullanabilirsiniz.</p>
      </section>
    </>
  );
}
