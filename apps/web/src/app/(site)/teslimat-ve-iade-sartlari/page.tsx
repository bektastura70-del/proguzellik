import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";
import { DELIVERY_BODY, DELIVERY_TITLE } from "@/content/legal/teslimat-iade";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. Metin Claude taslağıdır; Bektaş Tura 07.11.2026'da hukuk incelemesi beklemeden yayına onay verdi. */
export const dynamic = "force-dynamic";
export const metadata = { title: DELIVERY_TITLE, alternates: { canonical: "/teslimat-ve-iade-sartlari" } };

export default function DeliveryReturns() {
  return (
    <LegalPage title={DELIVERY_TITLE} imprint={<LegalImprint dates={IYZICO_DOCS_DATES} />}>
      <LegalMarkdown source={DELIVERY_BODY} />
    </LegalPage>
  );
}
