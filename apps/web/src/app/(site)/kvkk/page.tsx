import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { LegalNote, NoteTable } from "@/components/legal-note";
import { KVKK_BODY, KVKK_TITLE } from "@/content/legal/kvkk";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: KVKK_TITLE, alternates: { canonical: "/kvkk" } };

/**
 * Deneme başvurusu notu: politika metni değildir; kodun gerçek davranışını anlatır
 * (api/src/platform/trial-application.service.ts: APPLICATION_VERIFY_HOURS=48, REJECTED_RETENTION_DAYS=30, günlük görev).
 * Bu değerler veya toplanan alanlar değişirse bu not da güncellenmelidir.
 */
export default function Kvkk() {
  return (
    <LegalPage title={KVKK_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={KVKK_BODY} />
      <LegalNote title="Ücretsiz deneme başvuruları" asOf="05.11.2026">
        <p>
          Kendi kendine kayıt kapalıyken ücretsiz deneme sayfasındaki başvuru formu kullanılabilir. Bu formda parola alınmaz.
          Başvuru, e-posta adresi doğrulanınca Pro Güzellik ekibinin değerlendirmesine sunulur. Onaylanırsa işletme hesabı açılır
          ve yetkiliye hesabını oluşturması için davet e-postası gönderilir.
        </p>
        <NoteTable
          head={["Toplanan bilgi", "Ayrıntı"]}
          rows={[
            ["Zorunlu alanlar", "Salon adı, yetkili adı soyadı, e-posta adresi, telefon numarası."],
            ["İsteğe bağlı alanlar", "Şehir, personel sayısı, ilgilenilen paket, başvuru notu."],
            ["Onay kayıtları", "KVKK Aydınlatma Metni ve Kullanım Koşulları onayı (metin sürümüyle), ticari elektronik ileti tercihi."],
            ["Teknik kayıtlar", "Başvurunun yapıldığı IP adresi ve tarayıcı bilgisi; başvuru, doğrulama ve karar adımlarının güvenlik kayıtları."],
          ]}
        />
        <NoteTable
          head={["Başvurunun durumu", "Saklama"]}
          rows={[
            ["E-postası doğrulanmayan başvuru", "Doğrulama bağlantısı 48 saat geçerlidir; süresi dolan başvurular günlük otomatik görevle silinir."],
            ["Reddedilen başvuru", "Karar tarihinden 30 gün sonra günlük otomatik görevle silinir."],
            ["Onaylanan başvuru", "Silinmez; açılan işletme hesabının kayıtlarıyla ilişkili olarak saklanır. Hesap açıldığında başvurudaki onay tercihleri kullanıcı hesabına aktarılır."],
          ]}
        />
        <p>
          Başvuru bilgileri Bölüm 4'teki Hostinger altyapısında (sunucu ve e-posta gönderimi) işlenir. Doğrulanan başvurunun salon adı,
          bildirim e-postasıyla Pro Güzellik kurumsal e-posta adresine iletilir. Başvuru bilgilerine yalnızca Pro Güzellik platform yöneticileri erişebilir;
          abone işletmeler erişemez.
        </p>
      </LegalNote>
    </LegalPage>
  );
}
