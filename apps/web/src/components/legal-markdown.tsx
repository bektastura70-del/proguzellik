import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Hukuki metinler için küçük, bağımlılıksız markdown okuyucu.
 * Desteklenen: "## başlık", paragraf, "- liste", tablo (| a | b |), **kalın**, [bağlantı](/yol).
 * Metin olduğu gibi gösterilir; HTML yorumlanmaz.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}-${i++}`} className="font-semibold text-ink">{m[1]}</strong>);
    else out.push(<Link key={`${key}-${i++}`} href={m[3]} className="text-brand-700 underline">{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function LegalMarkdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const key = `b${bi}`;
        if (lines[0].startsWith("## ")) return <h2 key={key}>{inline(lines[0].slice(3), key)}</h2>;
        if (lines.every((l) => l.startsWith("- "))) {
          return <ul key={key}>{lines.map((l, li) => <li key={li}>{inline(l.slice(2), `${key}-${li}`)}</li>)}</ul>;
        }
        if (lines.length >= 2 && lines[0].startsWith("|") && /^\|[\s|:-]+\|$/.test(lines[1].trim())) {
          const [head, , ...rows] = lines;
          return (
            <div key={key} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr>{cells(head).map((c, ci) => <th key={ci} className="border-b border-sand-300 px-2 py-2 font-semibold text-ink">{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, ri) => <tr key={ri}>{cells(r).map((c, ci) => <td key={ci} className="border-b border-sand-200 px-2 py-2 align-top">{inline(c, `${key}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={key}>{inline(lines.join(" "), key)}</p>;
      })}
    </>
  );
}
