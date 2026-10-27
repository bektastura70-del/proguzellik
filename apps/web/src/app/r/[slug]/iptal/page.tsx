"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

function Cancel({ slug }: { slug: string }) {
  const q = useSearchParams();
  const [state, setState] = useState<"idle" | "done" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  async function cancel() {
    setState("busy");
    try {
      await api(`/public/salons/${slug}/bookings/${q.get("id")}/cancel`, { method: "POST", body: { token: q.get("t") } });
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }
  return (
    <Card className="mt-8 p-6 text-center">
      {state === "done" ? (
        <p>Randevunuz iptal edildi.</p>
      ) : (
        <>
          <p className="mb-4">Randevunuzu iptal etmek istediğinize emin misiniz?</p>
          {err && <div className="mb-4"><Alert>{err}</Alert></div>}
          <Button variant="danger" onClick={cancel} disabled={state === "busy"}>Evet, iptal et</Button>
        </>
      )}
    </Card>
  );
}

export default function CancelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <Logo />
      <Suspense><Cancel slug={slug} /></Suspense>
    </div>
  );
}
