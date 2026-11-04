import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { LIABILITY_BODY, LIABILITY_TITLE } from "@/content/legal/sorumluluk";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: LIABILITY_TITLE, alternates: { canonical: "/sorumluluk-sinirlari" } };

export default function Liability() {
  return (
    <LegalPage title={LIABILITY_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={LIABILITY_BODY} />
    </LegalPage>
  );
}
