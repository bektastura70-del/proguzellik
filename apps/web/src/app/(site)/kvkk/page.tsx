import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { KVKK_BODY, KVKK_TITLE } from "@/content/legal/kvkk";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: KVKK_TITLE, alternates: { canonical: "/kvkk" } };

export default function Kvkk() {
  return (
    <LegalPage title={KVKK_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={KVKK_BODY} />
    </LegalPage>
  );
}
