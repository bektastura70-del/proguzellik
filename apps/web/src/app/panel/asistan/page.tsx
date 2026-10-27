"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Card, CardBody, PageHeader, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

const SUGGESTIONS = ["Bu ay nasıl gidiyoruz?", "Gelmeme oranını nasıl düşürebilirim?", "Hangi hizmeti paket olarak sunmalıyım?", "Hangi ürünleri sipariş etmeliyim?"];

export default function AssistantPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ q: string; a: string; provider: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    if (question.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ answer: string; provider: string }>("/assistant/ask", { method: "POST", body: { question } });
      setItems((x) => [{ q: question, a: r.answer, provider: r.provider }, ...x]);
      setQ("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="İşletme asistanı" description="Son 30 günün toplu verilerine bakarak öneri verir. Müşteri kişisel verileri paylaşılmaz." />
      <Card>
        <CardBody>
          <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="space-y-3">
            <Textarea value={q} onChange={(e) => setQ(e.target.value)} placeholder="Salonunuzla ilgili bir soru sorun…" maxLength={1000} />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy}>{busy ? <Spinner className="size-4 border-white/40 border-t-white" /> : <Sparkles />} Sor</Button>
              {SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => ask(s)} className="rounded-full border border-sand-300 px-3 py-1 text-xs hover:bg-sand-100">{s}</button>)}
            </div>
          </form>
        </CardBody>
      </Card>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      <div className="mt-6 space-y-4">
        {items.map((it, i) => (
          <Card key={i}>
            <CardBody>
              <p className="text-sm font-medium text-brand-700">{it.q}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{it.a}</p>
              <p className="mt-3 text-xs text-neutral-400">{it.provider === "mock" ? "Yerel kural tabanlı mod" : "Claude"}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
