"use client";

import { Check, Copy, Instagram, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/panel/session";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Spinner, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Channel = "WHATSAPP" | "INSTAGRAM";
type Conn = {
  id: string; channel: Channel; status: "DRAFT" | "CONNECTED" | "ERROR" | "DISABLED"; externalId: string; businessAccountId: string | null;
  displayName: string | null; tokenHint: string | null; verifiedAt: string | null; webhookVerifiedAt: string | null; lastWebhookAt: string | null;
  lastError: string | null; aiAutoReply: boolean; aiDataConsentAt: string | null; webhookUrl: string;
};
type ListRes = { metaMode: "mock" | "live" | "disabled"; aiMode: string; aiAvailable: boolean; connections: Conn[] };
type Tpl = { name: string; label: string; category: string; body: string; status: string; language: string | null };

const PATH: Record<Channel, string> = { WHATSAPP: "whatsapp", INSTAGRAM: "instagram" };
const NAME: Record<Channel, string> = { WHATSAPP: "WhatsApp Business", INSTAGRAM: "Instagram" };
const STATUS: Record<Conn["status"], { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  DRAFT: { label: "Doğrulanmadı", tone: "amber" },
  CONNECTED: { label: "Bağlı", tone: "green" },
  ERROR: { label: "Hata", tone: "red" },
  DISABLED: { label: "Kapalı", tone: "neutral" },
};
const TPL_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  APPROVED: { label: "Onaylı", tone: "green" },
  PENDING: { label: "Onay bekliyor", tone: "amber" },
  REJECTED: { label: "Reddedildi", tone: "red" },
  MISSING: { label: "Eklenmemiş", tone: "neutral" },
};

const STEPS = ["Hazırlık", "Hesap bilgileri", "Doğrulama", "Webhook", "Şablonlar", "Yapay zekâ", "Deneme"] as const;

function stepsFor(ch: Channel) {
  return STEPS.map((s, i) => ({ s, i })).filter(({ s }) => ch === "WHATSAPP" || s !== "Şablonlar");
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" aria-label={`${label} kopyala`} onClick={async () => {
          try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* panoya erişim yok */ }
        }}>{done ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
      </div>
    </Field>
  );
}

export default function ChannelsPage() {
  const { can, has } = useSession();
  const list = useApi<ListRes>("/channels");
  const [open, setOpen] = useState<Channel | null>(null);

  if (!has("WHATSAPP")) {
    return (
      <>
        <PageHeader title="WhatsApp ve Instagram" />
        <Alert tone="amber">Mesajlaşma kanalları Profesyonel ve Akıllı paketlerde bulunur. <Link href="/panel/abonelik" className="underline">Paketinizi yükseltin</Link>.</Alert>
      </>
    );
  }
  if (list.loading && !list.data) return <Spinner />;
  if (list.error) return <Alert>{list.error.message}</Alert>;
  const d = list.data!;
  const conn = (c: Channel) => d.connections.find((x) => x.channel === c);

  return (
    <>
      <PageHeader title="WhatsApp ve Instagram" description="Salonunuzun kendi WhatsApp Business numarasını ve Instagram hesabını bağlayın; mesajlar Mesajlar sayfasına düşer." />
      {d.metaMode !== "live" && (
        <div className="mb-4">
          <Alert tone="amber">
            {d.metaMode === "mock"
              ? <><b>Test modu:</b> Bu ortam Meta'ya hiç bağlanmaz. Doğrulama ve gönderimler taklit edilir; hiçbir müşteriye mesaj gitmez.</>
              : <><b>Meta bağlantısı bu sunucuda henüz açılmadı.</b> Bilgilerinizi girip kaydedebilirsiniz; doğrulama ve mesajlaşma, ProGüzellik tarafından açıldığında çalışır.</>}
          </Alert>
        </div>
      )}
      {!can("OWNER") && <div className="mb-4"><Alert tone="brand">Bağlantıları yalnızca işletme sahibi kurabilir ve değiştirebilir.</Alert></div>}
      <div className="grid gap-4 md:grid-cols-2">
        {(["WHATSAPP", "INSTAGRAM"] as Channel[]).map((ch) => {
          const c = conn(ch);
          const Icon = ch === "WHATSAPP" ? MessageCircle : Instagram;
          return (
            <Card key={ch} data-testid={`kanal-${PATH[ch]}`}>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-3">
                  <Icon className="size-6 text-brand-700" />
                  <div className="flex-1">
                    <p className="font-medium">{NAME[ch]}</p>
                    <p className="text-xs text-neutral-500">{c?.displayName ?? (c ? `Kimlik: ${c.externalId}` : "Bağlı değil")}</p>
                  </div>
                  {c && <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
                </div>
                {c && (
                  <ul className="space-y-1 text-xs text-neutral-600">
                    <li>Webhook: {c.webhookVerifiedAt ? `doğrulandı (${dateTimeTr(c.webhookVerifiedAt)})` : "henüz doğrulanmadı"}</li>
                    <li>Son gelen olay: {c.lastWebhookAt ? dateTimeTr(c.lastWebhookAt) : "—"}</li>
                    <li>Yapay zekâ yanıtı: {c.aiAutoReply ? "açık" : "kapalı"}</li>
                  </ul>
                )}
                {can("OWNER") && (
                  <Button variant={c?.status === "CONNECTED" ? "outline" : undefined} onClick={() => setOpen(open === ch ? null : ch)}>
                    {open === ch ? "Sihirbazı kapat" : c && c.status !== "DISABLED" ? "Kurulumu düzenle" : "Kurulumu başlat"}
                  </Button>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
      {open && <Wizard key={open} channel={open} conn={conn(open)} meta={d} onChange={() => void list.reload()} />}
    </>
  );
}

function Wizard({ channel, conn, meta, onChange }: { channel: Channel; conn?: Conn; meta: ListRes; onChange: () => void }) {
  const toast = useToast();
  const steps = stepsFor(channel);
  const initial = !conn || conn.status === "DISABLED" ? 0 : conn.status === "CONNECTED" ? steps.findIndex((x) => x.s === "Webhook") : 2;
  const [step, setStep] = useState(Math.max(0, initial));
  const [busy, setBusy] = useState(false);
  const path = PATH[channel];
  const current = steps[step].s;
  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message, "red"); } finally { setBusy(false); }
  };

  return (
    <Card className="mt-6" data-testid="sihirbaz">
      <CardHeader title={`${NAME[channel]} kurulum sihirbazı`} description={`Adım ${step + 1} / ${steps.length}: ${current}`} />
      <CardBody className="space-y-5">
        <ol className="flex flex-wrap gap-2 text-xs">
          {steps.map(({ s }, i) => (
            <li key={s}>
              <button type="button" onClick={() => setStep(i)} className={cn("rounded-full border px-3 py-1", i === step ? "border-brand-600 bg-brand-600 text-white" : i < step ? "border-brand-200 bg-brand-50 text-brand-800" : "border-sand-300 text-neutral-500")}>
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        {current === "Hazırlık" && <Prep channel={channel} onNext={next} />}

        {current === "Hesap bilgileri" && (
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const val = (k: string) => ((f.get(k) as string) ?? "").trim() || undefined;
            void run(async () => {
              await api(`/channels/${path}`, { method: "PUT", body: { externalId: val("externalId"), businessAccountId: val("businessAccountId"), accessToken: val("accessToken"), appSecret: val("appSecret") } });
              toast("Bilgiler şifrelenerek kaydedildi");
              onChange();
              next();
            });
          }}>
            <div className="grid gap-4 sm:grid-cols-2">
              {channel === "WHATSAPP" ? (
                <>
                  <Field label="Telefon numarası kimliği (Phone number ID)" hint="WhatsApp > API Kurulumu sayfasında"><Input name="externalId" required inputMode="numeric" defaultValue={conn?.externalId} /></Field>
                  <Field label="WhatsApp Business hesap kimliği (WABA ID)"><Input name="businessAccountId" required inputMode="numeric" defaultValue={conn?.businessAccountId ?? ""} /></Field>
                </>
              ) : (
                <Field label="Instagram profesyonel hesap kimliği (IG ID)" hint="Instagram API kurulumu sayfasında"><Input name="externalId" required inputMode="numeric" defaultValue={conn?.externalId} /></Field>
              )}
              <Field label="Kalıcı erişim anahtarı (access token)" hint={conn?.tokenHint ? `Kayıtlı: ${conn.tokenHint} — değiştirmeyecekseniz boş bırakın` : "Sistem kullanıcısı / uzun süreli anahtar"}>
                <Input name="accessToken" type="password" autoComplete="off" required={!conn?.tokenHint} />
              </Field>
              <Field label="Uygulama gizli anahtarı (App secret)" hint={conn ? "Kayıtlı — değiştirmeyecekseniz boş bırakın" : "Uygulama ayarları > Temel"}>
                <Input name="appSecret" type="password" autoComplete="off" required={!conn?.tokenHint} />
              </Field>
            </div>
            <p className="text-xs text-neutral-500">Anahtarlar sunucuda şifreli saklanır ve bir daha gösterilmez; yalnızca son 4 karakteri görünür.</p>
            <Button disabled={busy}>Kaydet ve devam et</Button>
          </form>
        )}

        {current === "Doğrulama" && (
          <div className="space-y-3 text-sm">
            <p>Girdiğiniz bilgilerle Meta'ya bağlanıp {channel === "WHATSAPP" ? "numaranızın adını" : "hesap adınızı"} okuyacağız.</p>
            {conn?.status === "CONNECTED" && <Alert tone="green">Bağlı: <b>{conn.displayName}</b>{meta.metaMode === "mock" && " (test modu, Meta'ya bağlanılmadı)"}</Alert>}
            {conn?.status === "ERROR" && conn.lastError && <Alert>{conn.lastError}</Alert>}
            <Button disabled={busy || !conn} onClick={() => void run(async () => {
              const r = await api<Conn & { simulated: boolean }>(`/channels/${path}/verify`, { method: "POST" });
              toast(r.simulated ? `Test modunda doğrulandı: ${r.displayName}` : `Bağlandı: ${r.displayName}`);
              onChange();
              next();
            })}>Bağlantıyı doğrula</Button>
          </div>
        )}

        {current === "Webhook" && conn && <WebhookStep channel={channel} conn={conn} onRefresh={onChange} />}
        {current === "Şablonlar" && <TemplatesStep />}
        {current === "Yapay zekâ" && conn && <AiStep channel={channel} conn={conn} meta={meta} onChange={onChange} />}
        {current === "Deneme" && conn && <TestStep channel={channel} conn={conn} meta={meta} />}

        <div className="flex justify-between border-t border-sand-200 pt-4">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>Geri</Button>
          {step < steps.length - 1 && current !== "Hesap bilgileri" && <Button variant="outline" onClick={next}>Sonraki adım</Button>}
        </div>
        {conn && conn.status !== "DISABLED" && (
          <div className="text-right">
            <button type="button" className="text-xs text-red-600 underline" onClick={() => {
              if (!confirm("Bağlantı kapatılsın ve kayıtlı anahtarlar silinsin mi? Sohbet geçmişi korunur.")) return;
              void run(async () => { await api(`/channels/${path}`, { method: "DELETE" }); toast("Bağlantı kapatıldı"); onChange(); });
            }}>Bağlantıyı kapat ve anahtarları sil</button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Prep({ channel, onNext }: { channel: Channel; onNext: () => void }) {
  const [ok, setOk] = useState(false);
  const items = channel === "WHATSAPP"
    ? [
        "Doğrulanmış bir Meta Business (İşletme) hesabı",
        "Başka bir WhatsApp uygulamasında kullanılmayan bir telefon numarası (WhatsApp Business uygulamasındaki numara taşınabilir)",
        "developers.facebook.com'da 'İşletme' türünde bir uygulama ve WhatsApp ürünü",
        "Sistem kullanıcısı için whatsapp_business_messaging ve whatsapp_business_management izinli kalıcı erişim anahtarı",
        "Meta hesabında tanımlı bir ödeme yöntemi (Meta, şablon mesajlarını ücretlendirir)",
      ]
    : [
        "Instagram profesyonel (İşletme veya İçerik üreticisi) hesabı",
        "developers.facebook.com'da Instagram API (Instagram ile giriş) ürünü eklenmiş bir uygulama",
        "instagram_business_basic ve instagram_business_manage_messages izinli erişim anahtarı",
        "Instagram ayarlarında 'Bağlı araçların mesajlara erişimi' açık",
        "Not: Instagram'da müşteri size yazmadan mesaj gönderilemez; yanıtlar müşterinin son mesajından sonraki 24 saat içinde yapılabilir",
      ];
  return (
    <div className="space-y-4 text-sm">
      <p>Başlamadan önce aşağıdakilerin hazır olduğundan emin olun. Bu adımlar Meta'nın kendi panelinde yapılır; ProGüzellik sizin yerinize hesap açamaz.</p>
      <ul className="list-disc space-y-1 pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      <p className="text-xs text-neutral-500">
        Bağlantılar: <a className="underline" href="https://business.facebook.com" target="_blank" rel="noreferrer">business.facebook.com</a> · <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>
      </p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="accent-brand-600" /> Gerekenler hazır</label>
      <Button disabled={!ok} onClick={onNext}>Devam</Button>
    </div>
  );
}

function WebhookStep({ channel, conn, onRefresh }: { channel: Channel; conn: Conn; onRefresh: () => void }) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-4 text-sm">
      <p>Meta uygulamanızın <b>{channel === "WHATSAPP" ? "WhatsApp > Yapılandırma" : "Instagram > Webhook'lar"}</b> bölümüne aşağıdaki adresi ve doğrulama belirtecini girin, ardından <b>messages</b> alanına abone olun.</p>
      <CopyField label="Geri çağırma adresi (Callback URL)" value={conn.webhookUrl} />
      {token ? <CopyField label="Doğrulama belirteci (Verify token)" value={token} /> : (
        <Button variant="outline" onClick={async () => {
          try { setToken((await api<{ verifyToken: string }>(`/channels/${PATH[channel]}/verify-token`)).verifyToken); } catch (e) { toast((e as Error).message, "red"); }
        }}>Doğrulama belirtecini göster</Button>
      )}
      <div className="rounded-xl bg-sand-50 p-3 text-xs">
        <p>Meta doğrulaması: {conn.webhookVerifiedAt ? <Badge tone="green">Doğrulandı · {dateTimeTr(conn.webhookVerifiedAt)}</Badge> : <Badge tone="amber">Bekleniyor</Badge>}</p>
        <p className="mt-1">Son gelen olay: {conn.lastWebhookAt ? dateTimeTr(conn.lastWebhookAt) : "henüz yok"}</p>
      </div>
      <Button variant="outline" onClick={onRefresh}>Durumu yenile</Button>
    </div>
  );
}

function TemplatesStep() {
  const res = useApi<{ simulated: boolean; templates: Tpl[] }>("/channels/whatsapp/templates");
  if (res.loading) return <Spinner />;
  if (res.error) return <Alert>{res.error.message}</Alert>;
  const d = res.data!;
  return (
    <div className="space-y-3 text-sm">
      <p>Hatırlatma ve bildirim mesajları, müşteri size son 24 saatte yazmadıysa yalnızca Meta'nın onayladığı şablonlarla gönderilebilir. Aşağıdaki şablonları <b>WhatsApp Yöneticisi &gt; Mesaj şablonları</b> bölümünde aynı ad, Türkçe dil ve aynı metinle oluşturun.</p>
      {d.simulated && <Alert tone="amber">Test modu: Meta'ya sorulmadı, durumlar gerçek değildir.</Alert>}
      <Table head={["Şablon adı", "Kategori", "Metin", "Durum"]}>
        {d.templates.map((t) => (
          <tr key={t.name}>
            <Td className="font-mono text-xs">{t.name}</Td>
            <Td>{t.category === "MARKETING" ? "Pazarlama" : "Hizmet (Utility)"}</Td>
            <Td className="max-w-md text-xs">{t.body}</Td>
            <Td><Badge tone={TPL_STATUS[t.status]?.tone ?? "neutral"}>{TPL_STATUS[t.status]?.label ?? t.status}</Badge></Td>
          </tr>
        ))}
      </Table>
      <p className="text-xs text-neutral-500">"kampanya_duyuru" pazarlama şablonudur: yalnızca ticari ileti izni olan müşterilere ve İYS kaydı yapıldıktan sonra kullanılabilir.</p>
      <Button variant="outline" onClick={() => void res.reload()}>Durumu yenile</Button>
    </div>
  );
}

function AiStep({ channel, conn, meta, onChange }: { channel: Channel; conn: Conn; meta: ListRes; onChange: () => void }) {
  const toast = useToast();
  const [consent, setConsent] = useState(!!conn.aiDataConsentAt);
  if (!meta.aiAvailable) {
    return <Alert tone="amber">Yapay zekâ yanıtları Akıllı pakette bulunur. Bu pakette gelen mesajlar Mesajlar sayfasına düşer ve personel yanıtlar.</Alert>;
  }
  const save = async (on: boolean) => {
    try {
      await api(`/channels/${PATH[channel]}/ai`, { method: "PATCH", body: { aiAutoReply: on, aiDataConsent: consent } });
      toast(on ? "Yapay zekâ yanıtları açıldı" : "Yapay zekâ yanıtları kapatıldı");
      onChange();
    } catch (e) { toast((e as Error).message, "red"); }
  };
  return (
    <div className="space-y-4 text-sm">
      <p>Açıldığında asistan; hizmet ve fiyat sorularını, boş saatleri ve güncel kampanyaları yalnızca panelinizdeki bilgilere dayanarak yanıtlar, müşteri onaylarsa randevu oluşturur. Emin olmadığı her konuda konuşmayı personele devreder.</p>
      {meta.aiMode === "mock" && <Alert tone="amber">Bu sunucuda gerçek yapay zekâ sağlayıcısı henüz açık değil. Ayar kaydedilir; o zamana kadar mesajlar personele düşer (yerel geliştirmede kural tabanlı test asistanı yanıtlar).</Alert>}
      <label className="flex items-start gap-2 rounded-xl border border-sand-200 p-3">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-brand-600" />
        <span>Müşterilerimin mesaj içeriklerinin, yanıt üretmek amacıyla yurt dışındaki yapay zekâ hizmet sağlayıcısına (Anthropic) aktarılacağını biliyorum; aydınlatma metnimde bu aktarımı belirttim ve gerekli hukuki dayanağı sağladım.</span>
      </label>
      <div className="flex gap-2">
        <Button disabled={!consent || conn.aiAutoReply} onClick={() => void save(true)}>Yapay zekâ yanıtlarını aç</Button>
        <Button variant="outline" disabled={!conn.aiAutoReply} onClick={() => void save(false)}>Kapat</Button>
      </div>
      <p className="text-xs text-neutral-500">Durum: {conn.aiAutoReply ? "açık" : "kapalı"}{conn.aiDataConsentAt && ` · onay: ${dateTimeTr(conn.aiDataConsentAt)}`}</p>
    </div>
  );
}

function TestStep({ channel, conn, meta }: { channel: Channel; conn: Conn; meta: ListRes }) {
  const toast = useToast();
  const [result, setResult] = useState<string | null>(null);
  if (channel === "INSTAGRAM") {
    return (
      <div className="space-y-3 text-sm">
        <p>Instagram'da işletme ilk mesajı gönderemez. Denemek için başka bir Instagram hesabından salon hesabınıza mesaj gönderin; mesaj birkaç saniye içinde <Link href="/panel/mesajlar" className="underline">Mesajlar</Link> sayfasında görünmelidir.</p>
        <p className="text-xs">Son gelen olay: {conn.lastWebhookAt ? dateTimeTr(conn.lastWebhookAt) : "henüz yok"}</p>
      </div>
    );
  }
  return (
    <form className="space-y-3 text-sm" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      void (async () => {
        try {
          const r = await api<{ sent: boolean; simulated: boolean }>("/channels/whatsapp/test-message", { method: "POST", body: { to: f.get("to"), confirm: f.get("confirm") === "on" } });
          setResult(r.sent ? "Deneme mesajı Meta'ya iletildi. Telefonunuza 'Hello World' mesajı gelmeli." : "Test modu: mesaj GÖNDERİLMEDİ, yalnızca taklit edildi.");
        } catch (err) { toast((err as Error).message, "red"); }
      })();
    }}>
      <p>Meta'nın her hesapta hazır gelen <span className="font-mono">hello_world</span> şablonuyla <b>kendi numaranıza</b> bir deneme mesajı gönderin. Bu mesaj Meta tarafından ücretlendirilebilir.</p>
      <Field label="Deneme mesajının gideceği numara (kendi numaranız)"><Input name="to" required placeholder="05xx xxx xx xx" /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" name="confirm" required className="accent-brand-600" /> Bu numaraya deneme mesajı gönderilmesini onaylıyorum</label>
      <Button disabled={conn.status !== "CONNECTED"}>Deneme mesajı gönder</Button>
      {conn.status !== "CONNECTED" && <p className="text-xs text-neutral-500">Önce bağlantıyı doğrulayın.</p>}
      {result && <Alert tone={meta.metaMode === "live" ? "green" : "amber"}>{result}</Alert>}
    </form>
  );
}
