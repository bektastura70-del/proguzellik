import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";

export function TrialCta({ title = "Salonunuzu 7 gün ücretsiz deneyin" }: { title?: string }) {
  return (
    <section className="bg-ink py-14 text-white" aria-labelledby="cta-baslik">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="cta-baslik" className="font-display text-2xl font-semibold sm:text-3xl">{title}</h2>
          <p className="mt-2 text-white/75">Kredi kartı gerekmez. Deneme bitince verileriniz silinmez.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/ucretsiz-deneme" className={buttonVariants({ size: "lg" })}>7 Gün Ücretsiz Dene</Link>
          <Link href="/giris" className={buttonVariants({ size: "lg", variant: "outline", className: "border-white/40 bg-transparent text-white hover:bg-white/10" })}>Giriş Yap</Link>
        </div>
      </div>
    </section>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 md:pt-16">
      {eyebrow && <p className="mb-3 text-sm font-medium text-brand-700">{eyebrow}</p>}
      <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">{title}</h1>
      {children && <div className="mt-4 max-w-2xl text-lg text-neutral-600">{children}</div>}
    </section>
  );
}
