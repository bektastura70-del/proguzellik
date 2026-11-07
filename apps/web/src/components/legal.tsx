import { LEGAL_BRAND, LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE, LEGAL_UPDATED_DATE, LEGAL_EMAIL, LEGAL_MERSIS, LEGAL_PROVIDER, LEGAL_WEBSITE } from "@/content/legal/meta";
import { getSiteInfo } from "@/lib/site";

/**
 * Hukuki sayfa çerçevesi. `draft` yalnız henüz hukuk onaylı metni gelmemiş sayfalarda (çerez, gizlilik) uyarı gösterir.
 */
export function LegalPage({ title, children, draft = false, imprint }: { title: string; children: React.ReactNode; draft?: boolean; imprint?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      {draft && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Bu metin bir şablondur. Yayına almadan önce bir hukuk danışmanı tarafından gözden geçirilmelidir.
        </div>
      )}
      <article className="prose-sm mt-8 space-y-4 text-[15px] leading-7 text-neutral-700 [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-ink [&_ul]:list-disc [&_ul]:pl-6">
        <h1>{title}</h1>
        {imprint}
        {children}
      </article>
    </div>
  );
}

/**
 * Hizmet sağlayıcı künyesi. Adres, vergi ve telefon Şirket ayarları'ndan gelir; girilmemiş satır gösterilmez.
 * `dates` verilirse ortak künye tarihleri yerine o belgenin yürürlük/güncelleme/sürüm bilgisi gösterilir.
 */
export async function LegalImprint({ dates, hideDates = false }: { dates?: { effective: string; updated: string; version: string }; hideDates?: boolean } = {}) {
  const { company } = await getSiteInfo();
  const tax = [company.taxOffice, company.taxNumber].filter(Boolean).join(" / ");
  const rows: [string, React.ReactNode][] = [
    ["Hizmet Sağlayıcı", LEGAL_PROVIDER],
    ["Marka", LEGAL_BRAND],
    ["Web Sitesi", <a key="w" href={LEGAL_WEBSITE} className="text-brand-700">{LEGAL_WEBSITE}</a>],
    ["İletişim", <a key="e" href={`mailto:${LEGAL_EMAIL}`} className="text-brand-700">{LEGAL_EMAIL}</a>],
  ];
  if (company.phone) rows.push(["Telefon", <a key="t" href={`tel:${company.phone.replace(/\s/g, "")}`} className="text-brand-700">{company.phone}</a>]);
  if (company.address) rows.push(["Şirket Adresi", company.address]);
  if (tax) rows.push(["Vergi Dairesi ve Vergi Numarası", tax]);
  if (LEGAL_MERSIS) rows.push(["MERSİS Numarası", LEGAL_MERSIS]);
  if (!hideDates) {
    const d = dates ?? { effective: LEGAL_EFFECTIVE_DATE, updated: LEGAL_UPDATED_DATE, version: LEGAL_DOC_VERSION };
    rows.push(["Yürürlük Tarihi", d.effective], ["Son Güncelleme Tarihi", d.updated], ["Belge Sürümü", d.version]);
  }
  return (
    <dl className="grid gap-x-4 gap-y-1 rounded-xl border border-sand-200 bg-white p-4 text-sm sm:grid-cols-[max-content_1fr]" data-testid="legal-imprint">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-ink">{k}</dt>
          <dd className="mb-2 whitespace-pre-line sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
