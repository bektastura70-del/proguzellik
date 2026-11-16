"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Button, Card, CardBody, CardHeader, PageHeader, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { loadSdk } from "@/lib/meta-sdk";

type Es = { appId: string; configId: string; graphVersion: string };
type ListRes = { metaMode: "mock" | "live" | "disabled"; embeddedSignup: Es | null };
type SessionInfo = { phone_number_id?: string; waba_id?: string };

/**
 * "WhatsApp'ı bağla": Meta'nın Embedded Signup penceresi. Salon kendi işletme hesabını ve numarasını seçer;
 * Meta tarayıcıya kısa ömürlü bir kod verir, kod hemen sunucuya gönderilir (anahtar tarayıcıda hiç oluşmaz).
 */
export default function WhatsAppConnectPage() {
  const { can } = useSession();
  const list = useApi<ListRes>("/channels");
  const [state, setState] = useState<"idle" | "open" | "saving" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const info = useRef<SessionInfo | null>(null);
  const code = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fail = (m: string) => {
    if (timer.current) clearTimeout(timer.current);
    code.current = null;
    setErr(m);
    setState("idle");
  };

  const finish = async () => {
    if (!code.current || !info.current?.phone_number_id || !info.current.waba_id) return;
    if (timer.current) clearTimeout(timer.current);
    const body = { code: code.current, phoneNumberId: info.current.phone_number_id, wabaId: info.current.waba_id };
    code.current = null;
    setState("saving");
    try {
      const r = await api<{ status: string; displayName: string | null; lastError: string | null; simulated?: boolean }>("/channels/whatsapp/embedded-signup", { method: "POST", body });
      if (r.status === "CONNECTED") {
        setResult(`Bağlandı: ${r.displayName ?? body.phoneNumberId}${r.simulated ? " (test modu)" : ""}`);
        setState("done");
      } else {
        setErr(r.lastError ?? "Numara bağlanamadı");
        setState("idle");
      }
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!ev.origin.endsWith("facebook.com")) return;
      let d: { type?: string; event?: string; data?: SessionInfo & { current_step?: string; error_message?: string } };
      try { d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (d.event === "FINISH") {
        info.current = d.data ?? null;
        void finish();
      } else if (d.event === "FINISH_ONLY_WABA") {
        fail("Hesap oluşturuldu ama numara eklenmedi. Lütfen tekrar deneyip bir telefon numarası seçin.");
      } else if (d.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || d.event === "FINISH_GRANT_ONLY_API_ACCESS") {
        fail("Bu bağlantı türü henüz desteklenmiyor. Lütfen WhatsApp Business uygulamasında kullanılmayan bir numarayı seçin.");
      } else if (d.event === "CANCEL") {
        if (timer.current) clearTimeout(timer.current);
        setState("idle");
      } else if (d.event === "ERROR") {
        fail(d.data?.error_message ?? "Meta bir hata bildirdi");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // finish yalnız ref'lere dayanır
  }, []);

  if (list.loading && !list.data) return <Spinner />;
  if (list.error) return <Alert>{list.error.message}</Alert>;
  const es = list.data!.embeddedSignup;
  const back = <a className="underline" href="/panel/kanallar">WhatsApp ve Instagram sayfasına dönün</a>;
  if (!can("OWNER")) return <Alert>WhatsApp numarasını yalnız işletme sahibi bağlayabilir. {back}.</Alert>;
  if (!es) return <Alert tone="amber">Bu özellik henüz açık değil. {back}.</Alert>;

  const start = async () => {
    setErr(null);
    setState("open");
    try {
      const fb = await loadSdk(es);
      // FB.login geri çağrısı async olamaz (SDK kuralı).
      fb.login((r) => {
        const c = r.authResponse?.code;
        if (!c) { setState((s) => (s === "open" ? "idle" : s)); return; }
        code.current = c;
        void finish();
        // Kod geldi ama numara bilgisi gelmediyse bekleme sonsuza kadar sürmesin (kod zaten 30 sn geçerli).
        timer.current = setTimeout(() => { if (code.current) fail("Meta numara bilgisini göndermedi. Lütfen tekrar deneyin."); }, 20_000);
      }, { config_id: es.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  };

  return (
    <>
      <PageHeader title="WhatsApp'ı bağla" description="Salonunuzun kendi WhatsApp Business numarasını birkaç adımda ProGüzellik'e bağlayın." />
      <Card>
        <CardHeader title="Meta ile bağlan" />
        <CardBody className="space-y-4 text-sm">
          {state === "done" ? (
            <>
              <Alert tone="green">{result}</Alert>
              <p>Gelen mesajlar artık Mesajlar sayfasına düşecek. Sıradaki adımlar: şablonlar, yapay zekâ ayarı ve deneme mesajı.</p>
              <Button onClick={() => window.location.assign("/panel/kanallar?kurulum=whatsapp")}>Kuruluma devam et</Button>
            </>
          ) : (
            <>
              <p>Açılan Meta penceresinde:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Facebook hesabınızla giriş yapın.</li>
                <li>İşletme portföyünüzü seçin veya oluşturun.</li>
                <li>WhatsApp Business hesabınızı ve salonun telefon numarasını seçin; numara yeniyse SMS ile doğrulayın.</li>
                <li>ProGüzellik'e verilen izinleri onaylayıp <b>Bitir</b>'e basın.</li>
              </ol>
              <p className="text-xs text-neutral-500">Numara başka bir WhatsApp uygulamasında kullanılıyorsa önce oradan silinmelidir. Mesaj ücretleri Meta tarafından doğrudan salonunuzun hesabına yansır; bağladıktan sonra WhatsApp Yöneticisi'nde bir ödeme yöntemi ekleyin.</p>
              {list.data!.metaMode !== "live" && <Alert tone="amber">Bu ortamda Meta bağlantısı test modunda; numara kaydı ve abonelik taklit edilir.</Alert>}
              {err && <Alert>{err}</Alert>}
              <div className="flex gap-2">
                <Button disabled={state !== "idle"} onClick={() => void start()}>{state === "saving" ? "Bağlanıyor…" : state === "open" ? "Meta penceresi açık…" : "WhatsApp'ı bağla"}</Button>
                <Button variant="outline" onClick={() => window.location.assign("/panel/kanallar")}>Vazgeç</Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
