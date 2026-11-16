import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { NativeHomeLink } from "@/components/native-home-link";

// Rehber yalnızca salonların "uygulamada listele" izniyle oluşur: arama motorlarına kapalı.
export const metadata: Metadata = {
  title: "Salon bul",
  robots: { index: false, follow: false },
};

export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-sand-50" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/salonlar" className="min-h-11 content-center" aria-label="Salon rehberi"><Logo className="text-base" /></Link>
          <NativeHomeLink label="Ana ekran" />
        </div>
      </header>
      <main id="icerik" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-2xl px-4 pb-8 text-xs text-neutral-500" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        Rehberde yalnızca Pro Güzellik kullanan ve listelenmeyi kendisi açan salonlar görünür. Bilgileri salonlar verir; konumunuz kullanılmaz.
      </footer>
    </div>
  );
}
