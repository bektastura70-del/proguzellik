import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { LegalNote, NoteTable } from "@/components/legal-note";
import { PRIVACY_BODY, PRIVACY_TITLE } from "@/content/legal/gizlilik";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: PRIVACY_TITLE, alternates: { canonical: "/gizlilik-politikasi" } };

/**
 * Sağlayıcıların gerçek durumu (04.11.2026, canlı sunucuda doğrulandı): META/AI/WhatsApp "mock" (kapalı),
 * sunucu dışı yedekte KVKK_ONAY yok (gerçek veri yüklenmiyor). Bunlardan biri açılırsa bu tablo güncellenmelidir.
 */
export default function GizlilikPolitikasi() {
  return (
    <LegalPage title={PRIVACY_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={PRIVACY_BODY} />
      <LegalNote title="Hizmet sağlayıcılarının güncel durumu" asOf="04.11.2026">
        <NoteTable
          head={["Sağlayıcı", "Durum", "Kullanım"]}
          rows={[
            ["Hostinger", "Kullanımda", "Uygulama sunucusu ve veritabanı (Frankfurt, Almanya); kurumsal e-posta gönderimi."],
            ["Google Drive", "Gerçek veri aktarımı kapalı", "Şifreli sunucu dışı yedekleme altyapısı kurulu; gerçek müşteri verisi yüklenmiyor."],
            ["Meta Platforms (WhatsApp, Instagram)", "Etkin değil", "Mesajlaşma entegrasyonu hiçbir işletme için açık değil."],
            ["Anthropic", "Etkin değil", "Yapay zekâ özellikleri hiçbir işletme için açık değil."],
          ]}
        />
      </LegalNote>
    </LegalPage>
  );
}
