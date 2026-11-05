"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

/**
 * E-postadaki "hatırlatmaları kapat" bağlantısı. Sayfayı açmak hiçbir şeyi değiştirmez
 * (e-posta tarayıcıları bağlantıyı önceden açabilir); kapatma yalnızca düğmeye basınca yapılır.
 */
function OptOut() {
  const q = useSearchParams();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [salon, setSalon] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function confirm() {
    setState("busy");
    setErr(null);
    try {
      const r = await api<{ ok: boolean; salon: string }>("/public/renewal-reminders/opt-out", { method: "POST", body: { token: q.get("t") ?? "" } });
      setSalon(r.salon);
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }
  return (
    <Card className="mt-8 p-6 text-center">
      {state === "done" ? (
        <p>{salon} yenileme hatırlatmaları sizin için kapatıldı. Randevu bildirimleriniz bundan etkilenmez.</p>
      ) : (
        <>
          <p className="mb-4">Bu salondan gelen yenileme hatırlatmalarını (e-posta ve uygulama bildirimi) kapatmak istiyor musunuz?</p>
          {err && <div className="mb-4"><Alert>{err}</Alert></div>}
          <Button onClick={confirm} disabled={state === "busy" || !q.get("t")}>Hatırlatmaları kapat</Button>
        </>
      )}
    </Card>
  );
}

export default function OptOutPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <Logo />
      <Suspense><OptOut /></Suspense>
    </div>
  );
}
