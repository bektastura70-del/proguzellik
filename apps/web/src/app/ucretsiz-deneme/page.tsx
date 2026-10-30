import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { API_URL } from "@/lib/server-api";
import { RegisterForm, type PublicPlan } from "./register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "14 Gün Ücretsiz Dene",
  description: "ProGüzellik'i 14 gün ücretsiz deneyin. Kredi kartı gerekmez; hesabınız e-posta doğrulamasından sonra açılır.",
  alternates: { canonical: "/ucretsiz-deneme" },
};

/** Kayıt durumunu ve paketleri API'den okur. API'ye ulaşılamazsa kayıt kapalı sayılır. */
async function load(): Promise<{ open: boolean; plans: PublicPlan[] }> {
  try {
    const [reg, plans] = await Promise.all([
      fetch(`${API_URL}/auth/registration`, { cache: "no-store" }),
      fetch(`${API_URL}/plans`, { cache: "no-store" }),
    ]);
    const open = reg.ok && (await reg.json()).enabled === true;
    return { open, plans: plans.ok ? await plans.json() : [] };
  } catch {
    return { open: false, plans: [] };
  }
}

export default async function TrialPage() {
  const { open, plans } = await load();
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
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Yeni kayıtlar yakında açılacak</h1>
            <p className="mt-2 text-sm text-neutral-500" data-testid="registration-closed">
              ProGüzellik şu anda yeni işletme kaydı almıyor. Hesabınız varsa giriş yapabilirsiniz.
            </p>
          </>
        )}
        <p className="mt-6 text-center text-sm text-neutral-500">Zaten hesabınız var mı? <Link href="/giris" className="font-medium text-brand-700">Giriş yapın</Link></p>
      </div>
    </main>
  );
}
