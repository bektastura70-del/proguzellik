/**
 * Hukuki metnin altına eklenen teknik bilgi notu. Politika metninin parçası değildir;
 * sistemin belirtilen tarihteki gerçek durumunu gösterir ve sistem değiştikçe güncellenmelidir.
 */
export function LegalNote({ title, asOf, children }: { title: string; asOf: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm" data-testid="legal-note">
      <h2 className="!mt-0">{title}</h2>
      <p className="text-neutral-500">Bu bölüm politika metninin parçası değildir; sistemin {asOf} itibarıyla teknik durumunu gösterir.</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function NoteTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <>
      {/* Telefonda her satır bir kart olarak gösterilir (dar ekranda tablo okunmuyor). */}
      <div className="space-y-3 sm:hidden">
        {rows.map((r, ri) => (
          <dl key={ri} className="rounded-lg border border-sand-200 bg-white p-3">
            {r.map((c, ci) => (
              <div key={ci} className={ci ? "mt-1.5" : ""}>
                <dt className="text-xs font-medium text-neutral-500">{head[ci]}</dt>
                <dd className={ci ? "" : "font-semibold text-ink"}>{c}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead><tr>{head.map((h) => <th key={h} className="border-b border-sand-300 px-2 py-2 font-semibold text-ink">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-sand-200 px-2 py-2 align-top">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
