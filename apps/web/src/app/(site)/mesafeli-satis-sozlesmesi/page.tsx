import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { DISTANCE_SALES_BODY, DISTANCE_SALES_TITLE } from "@/content/legal/mesafeli-satis";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. Metin hukuk onayı bekleyen taslaktır. */
export const dynamic = "force-dynamic";
export const metadata = { title: DISTANCE_SALES_TITLE, alternates: { canonical: "/mesafeli-satis-sozlesmesi" } };

export default function DistanceSales() {
  return (
    <LegalPage title={DISTANCE_SALES_TITLE} draft imprint={<LegalImprint draftDate="07.11.2026" />}>
      <LegalMarkdown source={DISTANCE_SALES_BODY} />
    </LegalPage>
  );
}
