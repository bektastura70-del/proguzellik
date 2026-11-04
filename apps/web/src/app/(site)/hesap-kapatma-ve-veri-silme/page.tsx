import { LegalImprint, LegalPage } from "@/components/legal";
import { LegalMarkdown } from "@/components/legal-markdown";
import { CLOSURE_BODY, CLOSURE_TITLE } from "@/content/legal/hesap-kapatma";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = { title: CLOSURE_TITLE, alternates: { canonical: "/hesap-kapatma-ve-veri-silme" } };

export default function Closure() {
  return (
    <LegalPage title={CLOSURE_TITLE} imprint={<LegalImprint />}>
      <LegalMarkdown source={CLOSURE_BODY} />
    </LegalPage>
  );
}
