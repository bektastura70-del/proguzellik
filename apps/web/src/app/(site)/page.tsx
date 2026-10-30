import { CalendarCheck2, HandCoins, MessageCircle, PackageCheck, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button-variants";
import { tl } from "@/lib/format";
import { API_URL } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type Plan = { code: string; name: string; maxStaff: number; monthlyPrice: string; features: string[] };

const FEATURE_TR: Record<string, string> = {
  CRM: "Müşteri kartı ve geçmişi",
  APPOINTMENTS: "Randevu takvimi",
  ONLINE_BOOKING: "Online rezervasyon sayfası",
  FINANCE: "Kasa, tahsilat ve primler",
  PACKAGES: "Paket ve seans takibi",
  STOCK: "Stok ve sarf malzemeleri",
  REPORTS: "Gelişmiş raporlar",
  WHATSAPP: "WhatsApp hatırlatmaları",
  AI_ASSISTANT: "Yapay zekâ işletme asistanı",
};

async function plans(): Promise<Plan[]> {
  try {
    const r = await fetch(`${API_URL}/plans`, { cache: "no-store" });
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

const highlights = [
  { icon: CalendarCheck2, title: "Çakışmayan takvim", text: "Personel bazlı çalışma saatleri, izinler ve otomatik çakışma kontrolü." },
  { icon: MessageCircle, title: "WhatsApp hatırlatma", text: "Onay, 24 saat önce hatırlatma ve iptal mesajları kendiliğinden gider." },
  { icon: PackageCheck, title: "Paket & seans", text: "Lazer, cilt bakımı gibi seanslı paketleri satın, kalan seansı anında görün." },
  { icon: HandCoins, title: "Kasa ve primler", text: "Tahsilat, kısmi iade, gider ve personel primleri tek ekranda." },
  { icon: ShieldCheck, title: "KVKK uyumlu altyapı", text: "Açık rıza kaydı, veri dışa aktarma ve anonimleştirme hazır." },
  { icon: Sparkles, title: "Akıllı asistan", text: "İşletmenizin verilerine bakarak somut öneriler sunar." },
];

export default async function Home() {
  const list = await plans();
  return (
    <div className="bg-sand-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/giris" className={buttonVariants({ variant: "ghost" })}>Giriş</Link>
          <Link href="/kayit" className={buttonVariants()}>14 gün ücretsiz dene</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 md:grid-cols-2 md:pt-16">
        <div>
          <p className="mb-4 inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800">Güzellik salonları için tasarlandı</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            Salonunuz dolu, <span className="text-brand-600">kafanız rahat.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-neutral-600">
            Randevu, müşteri, kasa, paket ve stok yönetimi tek bir sade panelde. Telefondan da bilgisayardan da çalışır.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/kayit" className={buttonVariants({ size: "lg" })}>Ücretsiz başla</Link>
            <a href="#paketler" className={buttonVariants({ size: "lg", variant: "outline" })}>Paketleri incele</a>
          </div>
          <p className="mt-3 text-sm text-neutral-500">Kredi kartı gerekmez · 14 gün tüm özellikler</p>
        </div>
        <div className="relative">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-brand-200/60 to-sand-200 blur-2xl" aria-hidden />
          <div className="relative rounded-[1.75rem] border border-sand-200 bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between text-sm">
              <span className="font-semibold">Bugün</span>
              <span className="text-neutral-500">8 randevu · 2 boş saat</span>
            </div>
            {[
              ["09:30", "Cilt bakımı", "Elif", "bg-brand-100 text-brand-800"],
              ["11:00", "Lazer epilasyon · 3/6", "Merve", "bg-emerald-50 text-emerald-800"],
              ["13:15", "Kalıcı oje", "Selin", "bg-amber-50 text-amber-900"],
              ["15:00", "Kaş laminasyonu", "Elif", "bg-sky-50 text-sky-800"],
            ].map(([t, s, p, c]) => (
              <div key={t} className="mb-2 flex items-center gap-3 rounded-xl border border-sand-100 p-3">
                <span className="w-12 text-sm font-semibold">{t}</span>
                <span className={`flex-1 rounded-lg px-3 py-2 text-sm ${c}`}>{s}</span>
                <span className="text-xs text-neutral-500">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((h) => (
            <div key={h.title} className="rounded-2xl border border-sand-200 p-6">
              <h.icon className="size-6 text-brand-600" />
              <h3 className="mt-4 font-semibold">{h.title}</h3>
              <p className="mt-1 text-sm text-neutral-600">{h.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="paketler" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center font-display text-3xl font-semibold">Paketler</h2>
        <p className="mt-2 text-center text-neutral-600">Personel sayınıza göre seçin, istediğiniz zaman değiştirin.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {list.map((p) => (
            <div key={p.code} className={`rounded-2xl border p-6 ${p.code === "PROFESSIONAL" ? "border-brand-400 bg-white shadow-lg" : "border-sand-200 bg-white"}`}>
              {p.code === "PROFESSIONAL" && <span className="mb-3 inline-block rounded-full bg-brand-600 px-3 py-1 text-xs text-white">En çok tercih edilen</span>}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-neutral-500">En fazla {p.maxStaff} personel</p>
              <p className="mt-4 text-3xl font-semibold">{tl(p.monthlyPrice)}<span className="text-base font-normal text-neutral-500"> / ay</span></p>
              <ul className="mt-5 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><span className="text-brand-600">✓</span>{FEATURE_TR[f] ?? f}</li>
                ))}
              </ul>
              <Link href={`/kayit?paket=${p.code}`} className={buttonVariants({ className: "mt-6 w-full", variant: p.code === "PROFESSIONAL" ? "default" : "outline" })}>
                14 gün ücretsiz dene
              </Link>
            </div>
          ))}
          {list.length === 0 && <p className="col-span-3 text-center text-sm text-neutral-500">Paket bilgisi şu an yüklenemedi.</p>}
        </div>
        <p className="mt-6 text-center text-xs text-neutral-500">Fiyatlar örnek değerlerdir; KDV dahil değildir.</p>
      </section>

      <footer className="border-t border-sand-200 py-8 text-sm text-neutral-500">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5">
          <span>© {new Date().getFullYear()} ProGüzellik</span>
          <nav className="flex gap-4">
            <Link href="/kvkk">KVKK Aydınlatma Metni</Link>
            <Link href="/gizlilik">Gizlilik</Link>
            <Link href="/cerez-politikasi">Çerez Politikası</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
