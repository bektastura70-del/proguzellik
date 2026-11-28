"use client";

import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { disablePush, enablePush, isIos, isStandalone, pushState, PushState, syncPush } from "@/lib/web-push-client";

const SCOPE = "/";

type Diag = { ios: boolean; standalone: boolean; permission: string; native: boolean };

function diagnose(): Diag {
  const native = /ProGuzellikApp\/\d/.test(navigator.userAgent);
  return {
    ios: isIos(),
    standalone: isStandalone(),
    permission: "Notification" in window ? Notification.permission : "yok",
    native,
  };
}

const PERM_TR: Record<string, string> = { granted: "verildi", denied: "reddedildi", default: "henüz sorulmadı", yok: "bu tarayıcıda yok" };

/** iPhone'da bildirimin kurulum adımları (sahibin cihazında yapılır). */
export function IosPushSteps({ denied }: { denied?: boolean }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-neutral-700" data-testid="ios-push-adimlari">
      <li>Safari'de <b>proguzellik.com/giris</b> adresini açıp giriş yapın.</li>
      <li>Alttaki <b>Paylaş</b> düğmesi → <b>Ana Ekrana Ekle</b> → <b>Ekle</b>.</li>
      <li>Ana ekrandaki <b>ProGüzellik</b> simgesinden açın (Safari'den değil), <b>yeniden giriş yapın</b> ve menüden <b>Bildirim merkezi</b>'ne gelin. Simge salonunuzun müşteri sayfasını açıyorsa onu silip bu adımlarla yeniden ekleyin.</li>
      <li><b>Bildirimleri aç</b> düğmesine dokunun, çıkan soruda <b>İzin Ver</b> deyin.</li>
      <li><b>Deneme gönder</b> ile telefona bildirim geldiğini kontrol edin.</li>
      {denied && <li>Daha önce "İzin Verme" dediyseniz: iPhone <b>Ayarlar → Bildirimler → ProGüzellik → Bildirimlere İzin Ver</b>. Listede yoksa simgeyi silip 1–3. adımları tekrarlayın.</li>}
      <li className="text-neutral-500">Ses için: Ayarlar → Bildirimler → ProGüzellik → <b>Sesler</b> açık olsun. Odak / Rahatsız Etme modu açıksa bildirim sessiz gelir.</li>
      <li className="text-neutral-500">iOS 16.4 veya üzeri gerekir (Ayarlar → Genel → Hakkında → iOS Sürümü).</li>
    </ol>
  );
}

/**
 * Bu cihazda anlık bildirim (Web Push) aç/kapat + tanı. Tüm işletmelerde görünür (salon uygulaması pilotundan bağımsız).
 * İzin yalnızca düğmeye basınca istenir (iOS bunu zorunlu tutar).
 */
export function StaffPushCard() {
  const status = useApi<{ available: boolean; devices: number; vapidPublicKey: string | null }>("/pwa/push");
  const [state, setState] = useState<PushState | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);

  const available = !!status.data?.available;
  useEffect(() => {
    setDiag(diagnose());
    void pushState(SCOPE).then((s) => {
      setState(s);
      if (s === "on" && available) void syncPush(SCOPE, (sub) => api("/pwa/push/subscriptions", { method: "POST", body: sub }).then(() => status.reload()));
    });
    // Yalnız erişilebilirlik değişince yeniden eşitlenir.
  }, [available]);

  if (!status.data) return null;

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      if (!status.data?.vapidPublicKey) throw new Error("Bildirim anahtarı yapılandırılmamış (sistem yöneticisi)");
      const s = await enablePush({ scope: SCOPE, script: "/sw.js", vapidKey: status.data.vapidPublicKey, save: (sub) => api("/pwa/push/subscriptions", { method: "POST", body: sub }) });
      setState(s);
      setDiag(diagnose());
      if (s === "denied") setMsg({ tone: "amber", text: "Bildirim izni reddedildi. Aşağıdaki adımlarla izni açabilirsiniz." });
      if (s === "on") setMsg({ tone: "green", text: "Bu cihazda bildirimler açıldı. Deneme gönder ile kontrol edebilirsiniz." });
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
        ? { tone: "green", text: "Deneme bildirimi gönderildi; birkaç saniye içinde bu cihazda görünmeli. Gelmezse uygulamayı kapatıp (ana ekrana dönüp) tekrar deneyin." }
        : { tone: "amber", text: "Deneme ortamı: bildirim kaydedildi ancak gerçek gönderim kapalı olduğu için cihaza ulaşmaz." });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    }
  }

  const iosNeedsSteps = diag?.ios && state !== "on";
  return (
    <Card data-testid="telefon-bildirimi">
      <CardHeader title="Telefona anlık bildirim" description="Yeni online randevu, iptal ve değişiklikler bu cihazın bildirim ekranına sesli düşer. Bildirimde müşteri adı görünmez." />
      <CardBody className="space-y-3 text-sm">
        {!available && <p className="text-neutral-600">Telefon bildirimi şu an sistem genelinde kapalı. Bildirimleri bu sayfada ve e-postada görebilirsiniz.</p>}
        {available && state === "on" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><BellRing className="size-4" aria-hidden /> Bu cihazda açık</span>
            <Button size="sm" variant="secondary" onClick={() => void test()}>Deneme gönder</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void turnOff()}><BellOff className="size-4" aria-hidden /> Kapat</Button>
          </div>
        )}
        {available && state === "off" && (
          <Button size="sm" disabled={busy} onClick={() => void turnOn()}><BellRing className="size-4" aria-hidden /> {busy ? "Açılıyor…" : "Bildirimleri aç"}</Button>
        )}
        {available && state === "denied" && <p className="font-medium text-amber-700">Bu cihazda bildirim izni kapalı (reddedilmiş).</p>}
        {available && state === "ios-install" && (
          <p className="flex gap-2 font-medium text-amber-700"><Smartphone className="size-4 shrink-0" aria-hidden /> iPhone'da bildirim yalnızca ana ekrana eklenen uygulamadan açılabilir; şu an Safari'den bakıyorsunuz.</p>
        )}
        {available && state === "unsupported" && (
          <p className="text-neutral-600">
            {diag?.native
              ? "Pro Güzellik uygulamasında anlık bildirim henüz yok. Bildirimlerinizi bu sayfada görebilirsiniz."
              : diag?.ios
                ? "Bu iPhone'da web bildirimi desteklenmiyor: iOS 16.4 veya üzeri gerekir."
                : "Bu tarayıcı anlık bildirimleri desteklemiyor."}
          </p>
        )}
        {available && iosNeedsSteps && !diag?.native && (
          <details open={state !== "off"} className="rounded-lg bg-sand-50 p-3">
            <summary className="cursor-pointer font-medium">iPhone'da kurulum adımları</summary>
            <div className="mt-2"><IosPushSteps denied={state === "denied"} /></div>
          </details>
        )}
        {available && diag && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-neutral-500" data-testid="push-tani">
            <dt>Cihaz</dt><dd>{diag.native ? "Mağaza uygulaması" : diag.ios ? (diag.standalone ? "iPhone, ana ekran uygulaması" : "iPhone, Safari") : diag.standalone ? "Yüklü uygulama" : "Tarayıcı"}</dd>
            <dt>İzin</dt><dd>{PERM_TR[diag.permission] ?? diag.permission}</dd>
            <dt>Bu cihaz</dt><dd>{state === "on" ? "abone" : "abone değil"}</dd>
            <dt>Hesabınız</dt><dd>bildirimi açık {status.data.devices} cihaz</dd>
          </dl>
        )}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </CardBody>
    </Card>
  );
}
