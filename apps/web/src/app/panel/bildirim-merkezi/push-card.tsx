"use client";

import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { disablePush, enablePush, pushState, PushState, syncPush } from "@/lib/web-push-client";

const SCOPE = "/";

/** Bu cihazda anlık bildirim (Web Push) aç/kapat. İzin yalnızca düğmeye basınca istenir. */
export function StaffPushCard() {
  const status = useApi<{ available: boolean; devices: number; vapidPublicKey: string | null }>("/pwa/push");
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);

  const available = !!status.data?.available;
  useEffect(() => {
    void pushState(SCOPE).then((s) => {
      setState(s);
      if (s === "on" && available) void syncPush(SCOPE, (sub) => api("/pwa/push/subscriptions", { method: "POST", body: sub }));
    });
  }, [available]);

  if (!status.data?.available) return null;

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      if (!status.data?.vapidPublicKey) throw new Error("Bildirim anahtarı yapılandırılmamış (sistem yöneticisi)");
      const s = await enablePush({ scope: SCOPE, script: "/sw.js", vapidKey: status.data.vapidPublicKey, save: (sub) => api("/pwa/push/subscriptions", { method: "POST", body: sub }) });
      setState(s);
      if (s === "denied") setMsg({ tone: "amber", text: "Bildirim izni reddedildi. Tarayıcı ayarlarından bu site için bildirimlere izin verebilirsiniz." });
      await status.reload();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    setBusy(true);
    await disablePush(SCOPE, (endpoint) => api("/pwa/push/subscriptions", { method: "DELETE", body: { endpoint } }));
    setState(await pushState(SCOPE));
    await status.reload();
    setBusy(false);
  }
  async function test() {
    setMsg(null);
    try {
      const r = await api<{ mode: string }>("/pwa/push/test", { method: "POST" });
      setMsg(r.mode === "live"
        ? { tone: "green", text: "Deneme bildirimi gönderildi; birkaç saniye içinde bu cihazda görünmeli." }
        : { tone: "amber", text: "Deneme ortamı: bildirim kaydedildi ancak gerçek gönderim kapalı olduğu için cihaza ulaşmaz." });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    }
  }

  return (
    <Card>
      <CardHeader title="Bu cihazda anlık bildirim" description="Yeni randevu, iptal ve değişikliklerden telefonunuza bildirim gelir. Bildirimde müşteri adı görünmez." />
      <CardBody className="space-y-3 text-sm">
        {state === "on" && (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><BellRing className="size-4" aria-hidden /> Açık</span>
            <Button size="sm" variant="secondary" onClick={() => void test()}>Deneme gönder</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void turnOff()}><BellOff className="size-4" aria-hidden /> Kapat</Button>
          </div>
        )}
        {state === "off" && <Button size="sm" disabled={busy} onClick={() => void turnOn()}><BellRing className="size-4" aria-hidden /> {busy ? "Açılıyor…" : "Bildirimleri aç"}</Button>}
        {state === "denied" && <p className="text-neutral-600">Bu tarayıcıda bildirim izni kapalı. Tarayıcının site ayarlarından izin verip sayfayı yenileyin.</p>}
        {state === "ios-install" && (
          <p className="flex gap-2 text-neutral-600"><Smartphone className="size-4 shrink-0" aria-hidden /> iPhone'da bildirim için önce paneli Safari'de Paylaş → <b>Ana Ekrana Ekle</b> ile ekleyin, sonra ana ekrandaki simgeden açın (iOS 16.4 ve üzeri).</p>
        )}
        {state === "unsupported" && <p className="text-neutral-600">Bu tarayıcı anlık bildirimleri desteklemiyor.</p>}
        {status.data.devices > 0 && <p className="text-xs text-neutral-500">Hesabınızda bildirimi açık {status.data.devices} cihaz var.</p>}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </CardBody>
    </Card>
  );
}
