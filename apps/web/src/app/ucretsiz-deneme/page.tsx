import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { API_URL } from "@/lib/server-api";
import { getSiteInfo } from "@/lib/site";
import { PolicyLinks } from "@/components/policy-links";
import { ApplicationForm } from "./application-form";
import { RegisterForm, type PublicPlan } from "./register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "14 Gün Ücretsiz Dene",
  description: "ProGüzellik'i 14 gün ücretsiz deneyin. Kredi kartı gerekmez; hesabınız e-posta doğrulamasından sonra açılır.",
  alternates: { canonical: "/ucretsiz-deneme" },
};

/** Kayıt durumunu ve paketleri API'den okur. API'ye ulaşılamazsa kayıt kapalı sayılır. */
async function load(): Promise<{ open: boolean; applications: boolean; plans: PublicPlan[] }> {
  try {
    const [reg, plans] = await Promise.all([
      fetch(`${API_URL}/auth/registration`, { cache: "no-store" }),
      fetch(`${API_URL}/plans`, { cache: "no-store" }),
    ]);
    const r = reg.ok ? await reg.json() : {};
    return { open: r.enabled === true, applications: r.applications === true, plans: plans.ok ? await plans.json() : [] };
  } catch {
    return { open: false, applications: false, plans: [] };
  }
}

/** Türkiye cep numarasını WhatsApp bağlantısı biçimine çevirir (05xx… → 905xx…); uymazsa null. */
function whatsappNumber(phone: string | null) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (/^05\d{9}$/.test(d)) return `9${d}`;
  if (/^905\d{9}$/.test(d)) return d;
  return null;
}

export default async function TrialPage() {
  const { open, applications, plans } = await load();
  const { company } = open && plans.length > 0 ? { company: null } : await getSiteInfo();
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        {open && plans.length > 0 ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">14 gün ücretsiz deneyin</h1>
            <p className="mb-6 mt-1 text-sm text-neutral-500">Kredi kartı gerekmez. E-posta adresinizi doğruladığınızda hesabınız açılır ve deneme süreniz başlar.</p>
            <Suspense>
              <RegisterForm plans={plans} />
            </Suspense>
          </>
        ) : applications ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">14 gün ücretsiz deneme başvurusu</h1>
            <p className="mb-6 mt-1 text-sm text-neutral-500" data-testid="application-intro">Kredi kartı gerekmez. Başvurunuzu inceleyip onayladığımızda hesabınızı oluşturmanız için size bir davet e-postası göndeririz.</p>
            <Suspense>
              <ApplicationForm plans={plans} />
            </Suspense>
            {company && <DemoContact company={company} title="Doğrudan ulaşmak isterseniz" />}
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Yeni kayıtlar yakında açılacak</h1>
            <p className="mt-2 text-sm text-neutral-500" data-testid="registration-closed">
              ProGüzellik şu anda kendi kendine kayıt almıyor. Salonunuz için demo veya erken erişim isterseniz bize ulaşın; hesabınızı biz açalım.
            </p>
            {company && <DemoContact company={company} />}
          </>
        )}
        <PolicyLinks className="mt-6 text-center" />
        <p className="mt-3 text-center text-sm text-neutral-500">Zaten hesabınız var mı? <Link href="/giris" className="font-medium text-brand-700">Giriş yapın</Link></p>
      </div>
    </main>
  );
}

function DemoContact({ company, title = "Demo talep edin" }: { company: { email: string; phone: string | null }; title?: string }) {
  const subject = encodeURIComponent("Demo talebi");
  const body = encodeURIComponent("Merhaba,\n\nSalon adı:\nŞehir:\nPersonel sayısı:\nSize ulaşabileceğimiz telefon:\n");
  const wa = whatsappNumber(company.phone);
  const btn = "inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium";
  return (
    <div className="mt-6 rounded-2xl border border-sand-200 bg-white p-5" data-testid="demo-contact">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <a className={`${btn} bg-brand-600 text-white hover:bg-brand-700`} href={`mailto:${company.email}?subject=${subject}&body=${body}`}>E-posta ile demo iste</a>
        {wa && <a className={`${btn} border border-sand-300 hover:bg-sand-100`} href={`https://wa.me/${wa}?text=${encodeURIComponent("Merhaba, ProGüzellik için demo talep etmek istiyorum.")}`} target="_blank" rel="noopener noreferrer">WhatsApp ile yazın</a>}
        {company.phone && <a className={`${btn} border border-sand-300 hover:bg-sand-100`} href={`tel:${company.phone.replace(/\s/g, "")}`}>Arayın: {company.phone}</a>}
      </div>
      <p className="mt-3 text-xs text-neutral-500">E-posta: {company.email}</p>
    </div>
  );
}
