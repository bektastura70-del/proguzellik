import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { DELIVERY_BODY, DELIVERY_TITLE } from "@/content/legal/teslimat-iade";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. Metin hukuk onayı bekleyen taslaktır. */
export const dynamic = "force-dynamic";
export const metadata = { title: DELIVERY_TITLE, alternates: { canonical: "/teslimat-ve-iade-sartlari" } };

export default function DeliveryReturns() {
  return (
    <LegalPage title={DELIVERY_TITLE} draft imprint={<LegalImprint draftDate="07.11.2026" />}>
      <LegalMarkdown source={DELIVERY_BODY} />
    </LegalPage>
  );
}
