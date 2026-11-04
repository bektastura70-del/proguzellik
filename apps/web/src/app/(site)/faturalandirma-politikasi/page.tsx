import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { BILLING_BODY, BILLING_TITLE } from "@/content/legal/faturalandirma";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: BILLING_TITLE, alternates: { canonical: "/faturalandirma-politikasi" } };

export default function Billing() {
  return (
    <LegalPage title={BILLING_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={BILLING_BODY} />
    </LegalPage>
  );
}
