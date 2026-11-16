"use client";

import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Button, Card, CardBody, CardHeader, PageHeader, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { loadSdk } from "@/lib/meta-sdk";

type Ig = { appId: string; configId: string; graphVersion: string };
type ListRes = { metaMode: "mock" | "live" | "disabled"; instagramConnect: Ig | null };
type Result = { status: string; displayName: string | null; lastError: string | null; simulated?: boolean };

/**
 * "Instagram'ı bağla": Meta'nın Facebook Login for Business penceresi (Instagram API with Unified Login).
 * Salon kendi işletme portföyünü ve Instagram profesyonel hesabını seçer; tarayıcıya yalnızca kısa ömürlü bir
 * kod gelir ve hemen sunucuya gönderilir. Hesap kimliği ve anahtar sunucuda Meta'dan alınır.
 */
export default function InstagramConnectPage() {
  const { can } = useSession();
  const list = useApi<ListRes>("/channels");
  const [state, setState] = useState<"idle" | "open" | "saving" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const finish = async (code: string) => {
    setState("saving");
    try {
      const r = await api<Result>("/channels/instagram/connect", { method: "POST", body: { code } });
      if (r.status === "CONNECTED") {
        setResult(`Bağlandı: ${r.displayName ?? "Instagram hesabı"}${r.simulated ? " (test modu)" : ""}`);
        setState("done");
      } else {
        setErr(r.lastError ?? "Instagram hesabı bağlanamadı");
        setState("idle");
      }
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  };

  if (list.loading && !list.data) return <Spinner />;
  if (list.error) return <Alert>{list.error.message}</Alert>;
  const ig = list.data!.instagramConnect;
  const mock = list.data!.metaMode === "mock";
  const back = <a className="underline" href="/panel/kanallar">WhatsApp ve Instagram sayfasına dönün</a>;
  if (!can("OWNER")) return <Alert>Instagram hesabını yalnız işletme sahibi bağlayabilir. {back}.</Alert>;
  if (!ig) return <Alert tone="amber">Bu özellik henüz açık değil. {back}.</Alert>;

  const start = async () => {
    setErr(null);
    setState("open");
    try {
      const fb = await loadSdk(ig);
      // FB.login geri çağrısı async olamaz (SDK kuralı).
      fb.login((r) => {
        const c = r.authResponse?.code;
        if (!c) { setState((s) => (s === "open" ? "idle" : s)); return; }
        void finish(c);
      }, { config_id: ig.configId, response_type: "code", override_default_response_type: true });
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  };

  return (
    <>
      <PageHeader title="Instagram'ı bağla" description="Salonunuzun Instagram profesyonel hesabını bağlayın; gelen DM'ler Mesajlar sayfasına düşer." />
      <Card>
        <CardHeader title="Meta ile bağlan" />
        <CardBody className="space-y-4 text-sm">
          {state === "done" ? (
            <>
              <Alert tone="green">{result}</Alert>
              <p>Instagram'dan gelen mesajlar artık Mesajlar sayfasına düşecek. Sıradaki adımlar: yapay zekâ ayarı ve deneme mesajı.</p>
              <Button onClick={() => window.location.assign("/panel/kanallar?kurulum=instagram")}>Kuruluma devam et</Button>
            </>
          ) : (
            <>
              <p>Başlamadan önce:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Salonun Instagram hesabı <b>profesyonel</b> (İşletme veya İçerik üreticisi) olmalı.</li>
                <li>Instagram uygulamasında <b>Ayarlar &gt; Mesajlar ve hikâye yanıtları &gt; Mesaj kontrolleri &gt; Bağlı araçlar</b> bölümünde <b>"Mesajlara erişime izin ver"</b> açık olmalı.</li>
              </ul>
              <p>Açılan Meta penceresinde:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Facebook veya Instagram hesabınızla giriş yapın.</li>
                <li>İşletme portföyünüzü seçin (yoksa pencerede oluşturabilirsiniz).</li>
                <li>Yalnızca <b>salonunuzun Instagram hesabını</b> seçin.</li>
                <li>ProGüzellik'e verilen izinleri onaylayıp <b>Bitir</b>'e basın.</li>
              </ol>
              <p className="text-xs text-neutral-500">Instagram'da işletme ilk mesajı gönderemez; müşterinin son mesajından sonraki 24 saat içinde yanıt verilebilir.</p>
              {mock && <Alert tone="amber">Bu ortamda Meta bağlantısı test modunda; hesap seçimi ve abonelik taklit edilir.</Alert>}
              {err && <Alert>{err}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button disabled={state !== "idle"} onClick={() => void start()}>{state === "saving" ? "Bağlanıyor…" : state === "open" ? "Meta penceresi açık…" : "Instagram'ı bağla"}</Button>
                {mock && (
                  <Button variant="outline" disabled={state !== "idle"} onClick={() => void finish(`yerel-deneme-${Date.now()}`)}>Test modunda bağla (Meta'sız)</Button>
                )}
                <Button variant="outline" onClick={() => window.location.assign("/panel/kanallar")}>Vazgeç</Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
