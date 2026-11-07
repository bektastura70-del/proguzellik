import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";
import { DISTANCE_SALES_BODY, DISTANCE_SALES_TITLE } from "@/content/legal/mesafeli-satis";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. Metin Claude taslağıdır; Bektaş Tura 07.11.2026'da hukuk incelemesi beklemeden yayına onay verdi. */
export const dynamic = "force-dynamic";
export const metadata = { title: DISTANCE_SALES_TITLE, alternates: { canonical: "/mesafeli-satis-sozlesmesi" } };

export default function DistanceSales() {
  return (
    <LegalPage title={DISTANCE_SALES_TITLE} imprint={<LegalImprint dates={IYZICO_DOCS_DATES} />}>
      <LegalMarkdown source={DISTANCE_SALES_BODY} />
    </LegalPage>
  );
}
