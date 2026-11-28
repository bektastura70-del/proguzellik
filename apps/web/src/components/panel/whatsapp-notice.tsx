"use client";

import { MessageCircleWarning, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui";
import { useApi } from "@/lib/api";

type AlertChannels = { email: { enabled: boolean; to: string | null }; whatsapp: { inPlan: boolean; connected: boolean } };
const KEY = "pg_wa_notice_hidden";

/**
 * WhatsApp bağlı değilken sahibe/yöneticiye sade açıklama: müşteriye WhatsApp onayı gitmez,
 * yeni randevular yine e-posta ve panel bildirimiyle gelir; bağlamak için Meta hesabı gerekir.
 */
export function WhatsAppNotice() {
  const ch = useApi<AlertChannels>("/pwa/alert-channels");
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(KEY) === "1"); } catch { setHidden(false); }
  }, []);
  if (!ch.data || ch.data.whatsapp.connected || hidden) return null;
  const email = ch.data.email.enabled ? ch.data.email.to : null;
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/60" data-testid="whatsapp-uyarisi">
      <CardBody className="flex gap-3">
        <MessageCircleWarning className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-2 text-sm text-neutral-700">
          <p className="font-medium text-ink">WhatsApp bağlı değil: müşterilerinize WhatsApp onay ve hatırlatma mesajı gitmiyor.</p>
          <p>
            Yeni online randevular ve müşteri iptalleri size yine gelir: {email ? <>e-postanıza (<b>{email}</b>) ve </> : null}panelde{" "}
            <Link href="/panel/bildirim-merkezi" className="underline">Bildirim merkezi</Link>ne.
            Müşteri randevu formunda e-posta yazarsa onay ve iptal bağlantısı ona e-postayla gider.
          </p>
          <p>
            WhatsApp bağlamak için salonunuza ait bir <b>Facebook (Meta) işletme hesabı</b> ve WhatsApp uygulamasında kullanılmayan bir telefon numarası gerekir.
            Meta hesabınız yoksa WhatsApp olmadan kullanmaya devam edebilirsiniz.
          </p>
          {ch.data.whatsapp.inPlan && <Link href="/panel/kanallar" className="inline-block font-medium text-brand-700 underline">WhatsApp bağlama adımlarını gör</Link>}
        </div>
        <button type="button" aria-label="Bu uyarıyı gizle" className="self-start text-neutral-500 hover:text-ink" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* depolama kapalı */ } setHidden(true); }}>
          <X className="size-4" />
        </button>
      </CardBody>
    </Card>
  );
}
