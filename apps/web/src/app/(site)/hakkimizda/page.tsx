import type { Metadata } from "next";
import { LegalImprint } from "@/components/legal";
import { PageIntro, TrialCta } from "@/components/site/cta";

/** Şirket bilgileri Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hakkımızda", description: "ProGüzellik, güzellik salonlarının randevu, müşteri, kasa ve stok işlerini tek panelde toplayan Türkçe bir bulut yazılımdır.", alternates: { canonical: "/hakkimizda" } };

export default function About() {
  return (
    <>
      <PageIntro eyebrow="Hakkımızda" title="Güzellik salonları için sade bir yönetim yazılımı" />
      <section className="mx-auto max-w-3xl space-y-5 px-5 pb-16 text-[17px] leading-8 text-neutral-700">
        <p>ProGüzellik; randevu defteri, müşteri listesi, kasa defteri, paket takibi ve stok sayımı gibi birbirinden ayrı tutulan işleri tek bir panelde birleştirmek için geliştirilen, Türkçe ve bulut tabanlı bir yazılımdır.</p>
        <h2 className="pt-4 font-display text-2xl font-semibold text-ink">İlkelerimiz</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Veriniz sizindir.</strong> İşletmenizin verisi diğer işletmelerden veritabanı düzeyinde ayrılır; deneme ya da abonelik bittiğinde silinmez.</li>
          <li><strong>Gerçekte ne varsa onu anlatırız.</strong> Bir özellik dış bir hesap gerektiriyorsa (ör. WhatsApp Business) bunu açıkça belirtiriz.</li>
          <li><strong>Güvenlik varsayılan olarak açık.</strong> İki adımlı doğrulama, rol bazlı yetkiler ve işlem kayıtları her pakette bulunur.</li>
          <li><strong>KVKK&apos;ya uygun çalışma.</strong> Onay kayıtları, veri dışa aktarma ve anonimleştirme araçları panelde hazırdır.</li>
        </ul>
        <h2 className="pt-4 font-display text-2xl font-semibold text-ink">Şirket bilgileri</h2>
        <LegalImprint hideDates />
      </section>
      <TrialCta />
    </>
  );
}
