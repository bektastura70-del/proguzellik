import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { LegalNote, NoteTable } from "@/components/legal-note";
import { PRIVACY_BODY, PRIVACY_TITLE } from "@/content/legal/gizlilik";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: PRIVACY_TITLE, alternates: { canonical: "/gizlilik-politikasi" } };

/**
 * Sağlayıcıların gerçek durumu (20.11.2026): iyzico canlı (tüm satın almalar), WhatsApp canlı (META_MODE=live, işletme bağlarsa),
 * Instagram bağlama canlıda kapalı (META_IG_CONFIG_ID yok), yapay zekâ OpenAI (AI_MODE=openai, işletme açarsa),
 * sunucu dışı yedekte KVKK_ONAY yok (gerçek veri yüklenmiyor). Bunlardan biri değişirse bu tablo güncellenmelidir.
 */
export default function GizlilikPolitikasi() {
  return (
    <LegalPage title={PRIVACY_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={PRIVACY_BODY} />
      <LegalNote title="Hizmet sağlayıcılarının güncel durumu" asOf="20.11.2026">
        <NoteTable
          head={["Sağlayıcı", "Durum", "Kullanım"]}
          rows={[
            ["Hostinger", "Kullanımda", "Uygulama sunucusu ve veritabanı (Frankfurt, Almanya); kurumsal e-posta gönderimi."],
            ["Google Drive", "Gerçek veri aktarımı kapalı", "Şifreli sunucu dışı yedekleme altyapısı kurulu; gerçek müşteri verisi yüklenmiyor."],
            ["iyzico", "Kullanımda", "Abonelik ödemeleri ve yenileme tahsilatı; kart bilgisi yalnız iyzico'da."],
            ["Meta Platforms (WhatsApp)", "İşletme bağlarsa kullanımda", "İşletmenin kendi WhatsApp Business numarasıyla müşterileriyle yazışması."],
            ["Meta Platforms (Instagram)", "Etkin değil", "Instagram bağlantısı henüz açık değil."],
            ["OpenAI", "İşletme açarsa kullanımda", "Gelen mesajlara yapay zekâ ile yanıt ve randevu önerisi; yalnız özelliği açan işletmelerde."],
          ]}
        />
      </LegalNote>
    </LegalPage>
  );
}
