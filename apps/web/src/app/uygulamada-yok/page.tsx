import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Uygulamada kullanılamaz", robots: { index: false, follow: false } };

/** Mağaza uygulamasında açılmayan sayfalar (satın alma, fiyatlar, deneme kaydı) için bilgi. Satın alma bağlantısı içermez. */
export default function NotInAppPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <Logo />
        <h1 className="mt-8 font-display text-2xl font-semibold">Bu bölüm uygulamada yok</h1>
        <p className="mt-2 text-sm text-neutral-600">Abonelik, paket ve ödeme işlemleri Pro Güzellik uygulamasında yapılmaz. Panelinizi, randevularınızı ve müşterilerinizi uygulamadan kullanmaya devam edebilirsiniz.</p>
        <Link href="/panel" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-5 font-semibold text-white">Panele dön</Link>
      </div>
    </div>
  );
}
