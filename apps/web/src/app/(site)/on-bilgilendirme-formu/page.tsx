import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";
import { PRE_INFO_BODY, PRE_INFO_TITLE } from "@/content/legal/on-bilgilendirme";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: PRE_INFO_TITLE, alternates: { canonical: "/on-bilgilendirme-formu" } };

export default function PreInfo() {
  return (
    <LegalPage title={PRE_INFO_TITLE} imprint={<LegalImprint dates={IYZICO_DOCS_DATES} />}>
      <LegalMarkdown source={PRE_INFO_BODY} />
    </LegalPage>
  );
}
