
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Bu metin bir şablondur. Yayına almadan önce veri sorumlusu bilgileri doldurulmalı ve bir hukuk danışmanı tarafından gözden geçirilmelidir.
      </div>
      <article className="prose-sm mt-8 space-y-4 text-[15px] leading-7 text-neutral-700 [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:pl-6">
        <h1>{title}</h1>
        {children}
      </article>
    </div>
  );
}
