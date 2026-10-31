"use client";

import { Bot, Instagram, MessageCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Conv = {
  id: string; channel: "WHATSAPP" | "INSTAGRAM"; externalUserId: string; displayName: string | null; mode: "AI" | "HUMAN"; handoffReason: string | null;
  unread: number; lastMessageAt: string; windowOpen: boolean; customer: { id: string; firstName: string; lastName: string } | null;
  lastMessage: { text: string; author: string; createdAt: string } | null;
};
type Msg = { id: string; direction: "IN" | "OUT"; author: "CUSTOMER" | "AI" | "STAFF" | "SYSTEM"; text: string; status: string; error: string | null; simulated: boolean; createdAt: string };
type Detail = Omit<Conv, "lastMessage" | "customer"> & {
  connection: { channel: string; displayName: string | null; aiAutoReply: boolean; status: string };
  customer: { id: string; firstName: string; lastName: string; phone: string | null; marketingConsent: boolean } | null;
  messages: Msg[];
};

const AUTHOR: Record<Msg["author"], string> = { CUSTOMER: "Müşteri", AI: "Yapay zekâ", STAFF: "Personel", SYSTEM: "Sistem" };
const who = (c: { displayName: string | null; customer: { firstName: string; lastName: string } | null; externalUserId: string; channel: string }) =>
  c.customer ? `${c.customer.firstName} ${c.customer.lastName}` : c.displayName ?? (c.channel === "WHATSAPP" ? `+${c.externalUserId}` : "Instagram kullanıcısı");

export default function InboxPage() {
  const { has } = useSession();
  const [filter, setFilter] = useState<"" | "HUMAN">("");
  const list = useApi<Conv[]>(`/conversations${filter ? `?mode=${filter}` : ""}`, [filter]);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => void list.reload(), 10_000);
    return () => clearInterval(t);
  }, [list.reload]);

  if (!has("WHATSAPP")) return <Alert tone="amber">Mesajlar Profesyonel ve Akıllı paketlerde bulunur.</Alert>;
  return (
    <>
      <PageHeader
        title="Mesajlar"
        description="WhatsApp ve Instagram'dan gelen mesajlar. Yapay zekâ emin olmadığında konuşmayı size devreder."
        action={<>
          <Button variant={filter === "" ? "default" : "outline"} size="sm" onClick={() => setFilter("")}>Tümü</Button>
          <Button variant={filter === "HUMAN" ? "default" : "outline"} size="sm" onClick={() => setFilter("HUMAN")}>Personel bekleyenler</Button>
        </>}
      />
      {list.loading && !list.data ? <Spinner /> : !list.data?.length ? (
        <Empty title="Henüz mesaj yok">
          Hesaplarınızı <Link href="/panel/kanallar" className="underline">WhatsApp &amp; Instagram</Link> sayfasından bağlayın; müşterilerin yazdıkları burada görünür.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto p-2">
            {list.data.map((c) => (
              <button key={c.id} type="button" onClick={() => setSel(c.id)} className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-sand-100", sel === c.id && "bg-brand-50")}>
                {c.channel === "WHATSAPP" ? <MessageCircle className="mt-1 size-4 shrink-0 text-emerald-600" /> : <Instagram className="mt-1 size-4 shrink-0 text-pink-600" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{who(c)}</span>
                    {c.unread > 0 && <Badge tone="brand">{c.unread}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">{c.lastMessage?.text ?? "—"}</span>
                  <span className="mt-1 flex gap-1">
                    {c.mode === "HUMAN" ? <Badge tone="amber">Personel</Badge> : <Badge tone="blue">Yapay zekâ</Badge>}
                    {!c.windowOpen && <Badge tone="neutral">24 saat doldu</Badge>}
                  </span>
                </span>
              </button>
            ))}
          </Card>
          {sel ? <Thread key={sel} id={sel} onChange={() => void list.reload()} /> : <Card className="grid place-items-center p-10 text-sm text-neutral-500">Bir konuşma seçin</Card>}
        </div>
      )}
    </>
  );
}

function Thread({ id, onChange }: { id: string; onChange: () => void }) {
  const toast = useToast();
  const d = useApi<Detail>(`/conversations/${id}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => void d.reload(), 8_000);
    return () => clearInterval(t);
  }, [d.reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [d.data?.messages.length]);

  if (!d.data) return <Card className="p-6"><Spinner /></Card>;
  const c = d.data;
  const setMode = async (mode: "AI" | "HUMAN") => {
    try { await api(`/conversations/${id}/mode`, { method: "PATCH", body: { mode } }); void d.reload(); onChange(); } catch (e) { toast((e as Error).message, "red"); }
  };

  return (
    <Card className="flex max-h-[70vh] flex-col" data-testid="konusma">
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-4 py-3">
        <div className="flex-1">
          <p className="font-medium">{who(c)}</p>
          <p className="text-xs text-neutral-500">{c.connection.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} · {c.connection.displayName}{c.customer && <> · <Link className="underline" href={`/panel/musteriler/${c.customer.id}`}>müşteri kartı</Link></>}</p>
        </div>
        {c.mode === "AI"
          ? <Button size="sm" variant="outline" onClick={() => void setMode("HUMAN")}><UserRound /> Konuşmayı devral</Button>
          : <Button size="sm" variant="outline" disabled={!c.connection.aiAutoReply} onClick={() => void setMode("AI")}><Bot /> Yapay zekâya bırak</Button>}
      </div>
      {c.mode === "HUMAN" && c.handoffReason && <div className="px-4 pt-3"><Alert tone="amber">Personel bekliyor: {c.handoffReason}</Alert></div>}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {c.messages.map((m) => (
          <div key={m.id} className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.direction === "IN" ? "bg-sand-100" : m.author === "SYSTEM" ? "mx-auto bg-neutral-50 text-xs text-neutral-600" : "ml-auto bg-brand-50")}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              {AUTHOR[m.author]} · {dateTimeTr(m.createdAt)}
              {m.direction === "OUT" && m.author !== "SYSTEM" && <> · {m.simulated ? "test modu — gönderilmedi" : m.status === "SKIPPED" ? "gönderilmedi" : m.status === "FAILED" ? "gönderilemedi" : m.status === "READ" ? "okundu" : m.status === "DELIVERED" ? "iletildi" : "gönderildi"}</>}
              {m.error && <span className="block text-red-600">{m.error}</span>}
            </p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="space-y-2 border-t border-sand-200 p-3" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          await api(`/conversations/${id}/messages`, { method: "POST", body: { text } });
          setText(""); void d.reload(); onChange();
        } catch (err) { toast((err as Error).message, "red"); } finally { setBusy(false); }
      }}>
        {!c.windowOpen && <Alert tone="amber">Müşterinin son mesajının üzerinden 24 saat geçti. Meta kuralları gereği serbest mesaj gönderilemez; müşteri yeniden yazınca yanıt verebilirsiniz.</Alert>}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder="Yanıtınızı yazın… (gönderince yapay zekâ bu konuşmada susar)" disabled={!c.windowOpen} />
        <div className="text-right"><Button disabled={busy || !c.windowOpen || !text.trim()}>Gönder</Button></div>
      </form>
    </Card>
  );
}
