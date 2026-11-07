"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button-variants";

export const NAV = [
  { href: "/ozellikler", label: "Özellikler" },
  { href: "/fiyatlar", label: "Fiyatlar" },
  { href: "/sss", label: "SSS" },
  { href: "/hakkimizda", label: "Hakkımızda" },
  { href: "/iletisim", label: "İletişim" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-30 border-b border-sand-200/70 bg-sand-50/90 backdrop-blur">
      <a href="#icerik" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">İçeriğe geç</a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-5">
        <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
        <nav aria-label="Ana menü" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm ${active(n.href) ? "font-medium text-brand-700" : "text-neutral-700 hover:bg-sand-100"}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/giris" className={buttonVariants({ variant: "outline", size: "sm", className: "hidden sm:inline-flex" })}>Giriş Yap</Link>
          <Link href="/ucretsiz-deneme" className={buttonVariants({ size: "sm", className: "hidden min-[360px]:inline-flex" })}><span className="sm:hidden">Ücretsiz Dene</span><span className="hidden sm:inline">14 Gün Ücretsiz Dene</span></Link>
          <button type="button" className="rounded-lg p-2 lg:hidden" aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Menüyü kapat" : "Menüyü aç"} onClick={() => setOpen(!open)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="site-menu" aria-label="Mobil menü" className="border-t border-sand-200 bg-white px-5 py-3 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2.5 text-neutral-800 hover:bg-sand-100">{n.label}</Link>
          ))}
          <Link href="/giris" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-2 py-2.5 font-medium text-brand-700">Giriş Yap</Link>
          <Link href="/ucretsiz-deneme" onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2.5 font-medium text-brand-700">14 Gün Ücretsiz Dene</Link>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-sand-200 bg-white py-10 text-sm text-neutral-600">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs">Güzellik salonları için randevu, müşteri, kasa, paket ve stok yönetimi.</p>
        </div>
        <nav aria-label="Ürün">
          <h2 className="mb-2 font-semibold text-ink">Ürün</h2>
          <ul className="space-y-1.5">
            <li><Link href="/ozellikler/randevu-musteri">Randevu ve müşteri</Link></li>
            <li><Link href="/ozellikler/personel-prim">Personel ve prim</Link></li>
            <li><Link href="/ozellikler/stok-finans">Stok ve finans</Link></li>
            <li><Link href="/ozellikler/raporlar">Raporlar</Link></li>
            <li><Link href="/fiyatlar">Fiyatlar</Link></li>
          </ul>
        </nav>
        <nav aria-label="Kurumsal">
          <h2 className="mb-2 font-semibold text-ink">Kurumsal</h2>
          <ul className="space-y-1.5">
            <li><Link href="/hakkimizda">Hakkımızda</Link></li>
            <li><Link href="/iletisim">İletişim</Link></li>
            <li><Link href="/sss">Sık sorulan sorular</Link></li>
            <li><Link href="/giris">Giriş Yap</Link></li>
          </ul>
        </nav>
        <nav aria-label="Yasal">
          <h2 className="mb-2 font-semibold text-ink">Yasal</h2>
          <ul className="space-y-1.5">
            <li><Link href="/kvkk">KVKK Aydınlatma Metni</Link></li>
            <li><Link href="/gizlilik-politikasi">Gizlilik Politikası</Link></li>
            <li><Link href="/cerez-politikasi">Çerez Politikası</Link></li>
            <li><Link href="/kullanim-kosullari">Kullanım Koşulları</Link></li>
            <li><Link href="/faturalandirma-politikasi">Faturalandırma Politikası</Link></li>
            <li><Link href="/hesap-kapatma-ve-veri-silme">Hesap Kapatma ve Veri Silme</Link></li>
            <li><Link href="/sorumluluk-sinirlari">Sorumluluk Sınırları</Link></li>
            <li><Link href="/mesafeli-satis-sozlesmesi">Mesafeli Satış Sözleşmesi</Link></li>
            <li><Link href="/teslimat-ve-iade-sartlari">Teslimat ve İade Şartları</Link></li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto mt-8 flex max-w-6xl flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-neutral-500">© {new Date().getFullYear()} ProGüzellik</p>
        {/* iyzico'nun resmi logo paketindeki footer bandı (docs.iyzico.com/ek-bilgiler/iyzico-logo-paketi); değiştirmeden kullanılır. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odeme/iyzico-ile-ode-logo-bandi.svg" width={429} height={32} alt="iyzico ile Öde, Mastercard, Visa, American Express ve Troy" className="h-6 w-auto max-w-full object-contain object-left sm:h-7" data-testid="payment-logos" />
      </div>
    </footer>
  );
}
