import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button-variants";

export const metadata: Metadata = { title: "Ödeme sonucu", robots: { index: false } };

/** iyzico dönüşünden sonra: sonuç yalnız sabit kodla gelir (adres çubuğundaki metin gösterilmez). */
export default async function PurchaseResult({ searchParams }: { searchParams: Promise<{ odeme?: string }> }) {
  const r = (await searchParams).odeme;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md" data-testid={`purchase-result-${r ?? "yok"}`}>
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        {r === "basarili" ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Ödemeniz alındı</h1>
            <p className="mt-2 text-sm text-neutral-600">İşletme hesabınız açıldı ve aboneliğiniz başladı. Satın alırken belirlediğiniz e-posta ve parolayla giriş yapabilirsiniz. Bilgileri e-postanıza da gönderdik.</p>
            <Link href="/giris" className={buttonVariants({ className: "mt-6 w-full", size: "lg" })}>Giriş yap</Link>
          </>
        ) : r === "bekliyor" ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Ödemeniz doğrulanıyor</h1>
            <p className="mt-2 text-sm text-neutral-600">Bankanızdan onay bekleniyor. Ödeme tamamlandığında hesabınız açılır ve e-posta alırsınız. Birkaç dakika sonra giriş yapmayı deneyebilirsiniz; tekrar ödeme yapmayın.</p>
            <Link href="/giris" className={buttonVariants({ className: "mt-6 w-full", variant: "outline" })}>Giriş sayfası</Link>
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Ödeme alınamadı</h1>
            <p className="mt-2 text-sm text-neutral-600">Hesabınız açılmadı ve kartınızdan ücret alınmadı. Yeniden denemek için e-postanızdaki bağlantıyı (geçerlilik süresi içinde) tekrar açın. Kartınızdan ücret çekildiğini görüyorsanız info@proguzellik.com adresine yazın; iade edilir.</p>
            <Link href="/fiyatlar" className={buttonVariants({ className: "mt-6 w-full", variant: "outline" })}>Fiyatlar sayfasına dön</Link>
          </>
        )}
      </div>
    </main>
  );
}
