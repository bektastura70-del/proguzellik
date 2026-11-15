import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { getPlans, getPurchaseOpen, getSiteInfo } from "@/lib/site";
import { PurchaseForm } from "./purchase-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Paket Satın Al",
  description: "ProGüzellik paketini denemesiz hemen satın alın; ödemeniz alındığında hesabınız açılır.",
  alternates: { canonical: "/satin-al" },
};

export default async function PurchasePage() {
  const [open, plans, site] = await Promise.all([getPurchaseOpen(), getPlans(), getSiteInfo()]);
  const priced = plans.filter((p) => p.monthlyPrice != null && p.vatRate != null);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        {open && priced.length > 0 ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Paket satın al</h1>
            <p className="mb-6 mt-1 text-sm text-neutral-500">
              Bilgilerinizi girin, e-postanızı doğrulayın ve kartla ödeyin. Hesabınız ödemeniz alındığında açılır; ödeme yapılmazsa hesap açılmaz.
            </p>
            <Suspense>
              <PurchaseForm plans={priced} />
            </Suspense>
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Online satın alma şu an kapalı</h1>
            <p className="mt-2 text-sm text-neutral-600" data-testid="purchase-closed">
              Paket almak için <a className="text-brand-700 underline" href={`mailto:${site.company.email}`}>{site.company.email}</a> adresine yazabilir ya da 7 gün ücretsiz denemeyle başlayabilirsiniz.
            </p>
            <p className="mt-4 text-sm"><Link href="/ucretsiz-deneme" className="text-brand-700 underline">7 gün ücretsiz dene</Link> · <Link href="/fiyatlar" className="text-brand-700 underline">Fiyatlar</Link></p>
          </>
        )}
        <p className="mt-6 text-center text-sm text-neutral-500">Hesabınız var mı? <Link href="/giris" className="text-brand-700">Giriş yapın</Link>, paketinizi Abonelik sayfasından alın.</p>
      </div>
    </main>
  );
}
