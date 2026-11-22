import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { IYZICO_DOCS_DATES } from "@/content/legal/meta";
import { AI_TOPUP_TERMS_BODY, AI_TOPUP_TERMS_TITLE } from "@/content/legal/ai-ek-paket";

/** Künye (adres, vergi, telefon) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: AI_TOPUP_TERMS_TITLE, alternates: { canonical: "/yapay-zeka-ek-paket-kosullari" } };

export default function AiTopupTerms() {
  return (
    <LegalPage title={AI_TOPUP_TERMS_TITLE} imprint={<LegalImprint dates={IYZICO_DOCS_DATES} />}>
      <LegalMarkdown source={AI_TOPUP_TERMS_BODY} />
    </LegalPage>
  );
}
