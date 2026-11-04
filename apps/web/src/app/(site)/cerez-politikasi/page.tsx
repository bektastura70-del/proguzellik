import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { LegalNote, NoteTable } from "@/components/legal-note";
import { COOKIE_BODY, COOKIE_TITLE } from "@/content/legal/cerez";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: COOKIE_TITLE, alternates: { canonical: "/cerez-politikasi" } };

/**
 * Çerez tablosu koddan çıkarılmıştır (lib/server-api.ts, components/panel/session.tsx, public/sw.js) ve
 * 04.11.2026'da canlı sitede doğrulanmıştır. Yeni çerez, depolama alanı veya dış script eklenirse güncelleyin;
 * açık rıza gerektiren bir araç eklenmeden önce onay mekanizması kurulmalıdır (e2e: site.spec "çerez envanteri").
 */
export default function Cerez() {
  return (
    <LegalPage title={COOKIE_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={COOKIE_BODY} />
      <LegalNote title="Güncel çerez tablosu" asOf="04.11.2026">
        <p>Herkese açık sayfalar çerez oluşturmaz. Aşağıdaki iki çerez yalnızca kullanıcı panele giriş yaptığında oluşturulur. Analitik, reklam veya üçüncü taraf çerezi ve dış kaynaklı script kullanılmamaktadır; bu nedenle şu anda çerez onay bandı gösterilmez.</p>
        <NoteTable
          head={["Ad", "Sağlayıcı", "Amaç", "Süre", "Tür"]}
          rows={[
            ["pg_token", "Pro Güzellik (birinci taraf)", "Giriş yapan kullanıcının oturumunu sürdürmek. Tarayıcıdaki scriptler okuyamaz (HttpOnly), yalnızca şifreli bağlantıyla gönderilir (Secure).", "8 saat veya çıkış yapılana kadar", "Kesinlikle gerekli"],
            ["pg_tenant", "Pro Güzellik (birinci taraf)", "Panelde hangi işletmenin seçili olduğunu hatırlamak; yalnızca işletme kimlik numarasını içerir.", "8 saat veya çıkış yapılana kadar", "Kesinlikle gerekli"],
            ["Uygulama önbelleği (proguzellik-v1)", "Pro Güzellik (birinci taraf)", "Çevrimdışı sayfa, simge ve uygulama dosyalarını cihazda tutarak hızlı açılış sağlamak. Kişisel veri içermez; API yanıtları önbelleğe alınmaz.", "Tarayıcı verileri silinene veya yeni sürüm yüklenene kadar", "Kesinlikle gerekli (benzer teknoloji)"],
          ]}
        />
        <p>Yerel depolama (localStorage) ve oturum depolama (sessionStorage) kullanılmamaktadır.</p>
      </LegalNote>
    </LegalPage>
  );
}
