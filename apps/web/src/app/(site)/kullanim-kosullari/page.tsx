import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { TERMS_BODY, TERMS_TITLE } from "@/content/legal/kullanim-kosullari";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: TERMS_TITLE, alternates: { canonical: "/kullanim-kosullari" } };

export default function Terms() {
  return (
    <LegalPage title={TERMS_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={TERMS_BODY} />
      <h2>İlgili belgeler</h2>
      <ul>
        <li><a className="text-brand-700 underline" href="/faturalandirma-politikasi">Faturalandırma ve Ödeme Belgeleri Politikası</a></li>
        <li><a className="text-brand-700 underline" href="/hesap-kapatma-ve-veri-silme">Hesap Kapatma, Veri Teslimi ve Veri Silme Politikası</a></li>
        <li><a className="text-brand-700 underline" href="/sorumluluk-sinirlari">Sorumluluk Sınırları ve Hizmet Güvenceleri</a></li>
        <li><a className="text-brand-700 underline" href="/kvkk">KVKK Aydınlatma Metni ve Veri Aktarım Politikası</a></li>
      </ul>
    </LegalPage>
  );
}
