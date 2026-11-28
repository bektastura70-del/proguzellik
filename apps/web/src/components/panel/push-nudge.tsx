"use client";

import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isStandalone, pushState } from "@/lib/web-push-client";
import { useSession } from "./session";

const KEY = "pg_push_nudge";
const SNOOZE_MS = 7 * 24 * 3600_000;

/**
 * Ana ekrana eklenmiş panelde (iPhone/Android) telefon bildirimi açık değilse sahip, yönetici ve resepsiyona
 * bir kez hatırlatır. İzin burada istenmez; Bildirim merkezi'ndeki düğmeye yönlendirir. 7 gün ertelenebilir.
 */
export function PushNudge() {
  const { pwa, can } = useSession();
  const path = usePathname();
  const [show, setShow] = useState(false);
  const desk = can("OWNER", "MANAGER", "RECEPTION");

  useEffect(() => {
    if (!pwa?.pushAvailable || !desk || !isStandalone()) return;
    try {
      const at = Number(localStorage.getItem(KEY) ?? 0);
      if (at && Date.now() - at < SNOOZE_MS) return;
    } catch {
      /* gizli kip */
    }
    void pushState("/").then((s) => setShow(s === "off" || s === "denied")).catch(() => undefined);
  }, [pwa?.pushAvailable, desk]);

  if (!show || path?.startsWith("/panel/bildirim-merkezi")) return null;
  const snooze = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* gizli kip */ }
    setShow(false);
  };
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm" data-testid="push-hatirlatma">
      <BellRing className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
      <div className="flex-1">
        <b>Yeni randevular telefonunuza bildirim olarak gelsin.</b> Bu cihazda telefon bildirimi henüz açık değil.{" "}
        <Link href="/panel/bildirim-merkezi" className="font-medium text-brand-700 underline">Bildirimleri aç</Link>
      </div>
      <button type="button" aria-label="Daha sonra" onClick={snooze} className="text-neutral-500 hover:text-neutral-800"><X className="size-4" /></button>
    </div>
  );
}
