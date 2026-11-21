"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Spinner, Stat, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Settings = { usdTry: string; fxAuto: boolean; fxRateDate: string | null; fxBuffer: string; markup: string; creditRatio: string; trialCreditKurus: number; tenantDailyMaxUsd: string; conversationMaxTokens: number; updatedAt: string };
type Row = {
  tenantId: string; name: string; slug: string; plan: string; replies: number; calls: number; tokens: number; costUsd: string; costTl: string | null;
  avgCostUsdPerReply: string | null; debitTl: string; handoffRate: number; topupCount: number; topupNetTl: string; percentLeft: number | null; monthlyLeftTl: string | null; extraLeftTl: string | null;
};
type Fx = { auto: boolean; stale: boolean; tcmb: { rate: string; date: string; fetchedAt: string; bulletinNo: string | null } | null };
type Overview = { mode: "off" | "shadow" | "enforce"; settings: Settings | null; settingsStale: boolean; fx: Fx; last30Days: { costUsd: string; costTl: string | null; replies: number; topupNetTl: string }; today: { costUsd: string; replies: number }; tenants: Row[] };

const MODE_TR = { off: "Kapalı (yalnız kayıt)", shadow: "Gölge (düşer, kesmez)", enforce: "Uygulanıyor" } as const;

/** SaaS sahibi: gerçek yapay zekâ maliyeti (yalnız burada görünür) ve fiyatlandırma ayarları. */
export function AiAdminCard() {
  const o = useApi<Overview>("/platform/ai");
  if (!o.data) return o.error ? <Alert>{o.error.message}</Alert> : <Spinner />;
  const d = o.data;
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Kota modu: <Badge tone={d.mode === "enforce" ? "green" : "amber"}>{MODE_TR[d.mode]}</Badge>
        <span className="text-xs text-neutral-500">(sunucu ortamındaki AI_QUOTA_MODE)</span>
      </div>
      {!d.settings && <Alert tone="amber">Fiyatlandırma ayarları girilmedi. Kur ve çarpan girilmeden hak düşümü yapılamaz.</Alert>}
      {d.settings && d.settingsStale && <Alert tone="amber">Elle girilen dolar kuru 7 günden uzun süredir güncellenmedi. Düşüm hesabı güncel kurla yapılmalı.</Alert>}
      {d.fx.auto && d.fx.stale && <Alert tone="amber">TCMB kuru 3 günden uzun süredir okunamadı; son geçerli kur kullanılıyor. Şimdi güncelle ile deneyin ya da kuru elle girin.</Alert>}
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Son 30 gün gerçek maliyet" value={`$${d.last30Days.costUsd}`} hint={d.last30Days.costTl ? `≈ ${d.last30Days.costTl} TL` : undefined} />
        <Stat label="Son 30 gün yanıt" value={d.last30Days.replies.toLocaleString("tr-TR")} />
        <Stat label="Son 30 gün ek paket (KDV hariç)" value={`${d.last30Days.topupNetTl} TL`} />
        <Stat label="Bugün" value={`$${d.today.costUsd}`} hint={`${d.today.replies} yanıt`} />
      </div>
      <Card>
        <CardHeader title="İşletme bazında kullanım (son 30 gün)" description="Salonlar bu sayıları görmez; panelde yalnız yaklaşık yüzde görünür." />
        <Table head={["İşletme", "Yanıt", "Maliyet", "Yanıt başı", "Düşülen değer", "Devir %", "Ek paket", "Kalan %", "Kalan aylık / ek"]} empty="Kullanım yok">
          {d.tenants.map((t) => (
            <tr key={t.tenantId}>
              <Td><div className="font-medium">{t.name}</div><div className="text-xs text-neutral-500">{t.slug} · {t.plan}</div></Td>
              <Td>{t.replies}</Td>
              <Td>${t.costUsd}{t.costTl && <div className="text-xs text-neutral-500">≈ {t.costTl} TL</div>}</Td>
              <Td>{t.avgCostUsdPerReply ? `$${t.avgCostUsdPerReply}` : "—"}</Td>
              <Td>{t.debitTl} TL</Td>
              <Td>%{t.handoffRate}</Td>
              <Td>{t.topupCount ? `${t.topupCount} · ${t.topupNetTl} TL` : "—"}</Td>
              <Td>{t.percentLeft == null ? "—" : `%${t.percentLeft}`}</Td>
              <Td>{t.monthlyLeftTl == null ? "—" : `${t.monthlyLeftTl} / ${t.extraLeftTl} TL`}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <PurchasesCard onChanged={o.reload} />
      <FxCard fx={d.fx} s={d.settings} onChanged={o.reload} />
      <SettingsForm s={d.settings} fx={d.fx} onSaved={o.reload} />
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
const fmtTime = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });

/** TCMB döviz satış kuru: son bülten, son okuma, elle yenileme. */
function FxCard({ fx, s, onChanged }: { fx: Fx; s: Settings | null; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Dolar kuru (TCMB döviz satış)" description="Saatte bir TCMB'nin günlük bülteninden okunur. Hafta sonu, tatil ya da hata durumunda son geçerli kur kullanılır." />
      <CardBody className="space-y-2 text-sm">
        {fx.tcmb ? (
          <p>
            TCMB USD döviz satış: <b>{fx.tcmb.rate.replace(".", ",")} TL</b> ({fmtDate(fx.tcmb.date)} bülteni{fx.tcmb.bulletinNo ? `, ${fx.tcmb.bulletinNo}` : ""}) · son okuma {fmtTime(fx.tcmb.fetchedAt)}
          </p>
        ) : (
          <p className="text-neutral-500">Henüz TCMB kuru okunmadı.</p>
        )}
        {s && (
          <p className="text-neutral-600">
            Hesapta kullanılan kur: <b>{s.usdTry.replace(".", ",")} TL</b> · {s.fxAuto ? `otomatik${s.fxRateDate ? ` (${fmtDate(s.fxRateDate)} bülteni)` : ""}` : "elle girildi"}
          </p>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ ok: boolean; error?: string; rate?: string; applied?: boolean }>("/platform/ai/fx/refresh", { method: "POST" });
              toast(r.ok ? `TCMB kuru okundu: ${r.rate}${r.applied ? " (uygulandı)" : ""}` : `Kur okunamadı: ${r.error}`);
              onChanged();
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Şimdi güncelle
        </Button>
      </CardBody>
    </Card>
  );
}

function SettingsForm({ s, fx, onSaved }: { s: Settings | null; fx: Fx; onSaved: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(s?.fxAuto ?? true);
  return (
    <Card>
      <CardHeader title="Fiyatlandırma ayarları" description="Düşüm = gerçek maliyet × kur × kur tamponu × çarpan. Çarpan 1'den küçük olamaz (zarar etmeme sınırı)." />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const num = (k: string) => Number(String(f.get(k)).replace(",", "."));
            setErr(null);
            setBusy(true);
            try {
              await api("/platform/ai/settings", {
                method: "PUT",
                body: {
                  usdTry: num("usdTry"), fxAuto: auto, fxBuffer: num("fxBuffer"), markup: num("markup"), creditRatio: num("creditRatio"),
                  trialCreditKurus: Math.round(num("trialTl") * 100), tenantDailyMaxUsd: num("tenantDailyMaxUsd"), conversationMaxTokens: Math.round(num("conversationMaxTokens")),
                },
              });
              toast("Ayarlar kaydedildi");
              onSaved();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {err && <div className="sm:col-span-2 lg:col-span-4"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Dolar kurunu TCMB döviz satış kurundan otomatik güncelle
            </label>
          </div>
          <Field label="Dolar kuru (TL)" hint={auto ? "Otomatikte TCMB kuru kullanılır; bu değer yalnız henüz kur okunmadıysa geçerli" : "Elle girilen kur"}>
            <Input name="usdTry" inputMode="decimal" defaultValue={s?.usdTry ?? fx.tcmb?.rate ?? ""} readOnly={auto && !!fx.tcmb} required />
          </Field>
          <Field label="Kur tamponu" hint="1,10 = %10 pay"><Input name="fxBuffer" inputMode="decimal" defaultValue={s?.fxBuffer ?? "1.10"} required /></Field>
          <Field label="Çarpan" hint="3 = gerçek maliyetin 3 katı düşülür"><Input name="markup" inputMode="decimal" defaultValue={s?.markup ?? "3"} required /></Field>
          <Field label="Ek paket oranı" hint="0,5 = ödenen KDV hariç tutarın yarısı"><Input name="creditRatio" inputMode="decimal" defaultValue={s?.creditRatio ?? "0.5"} required /></Field>
          <Field label="Deneme hakkı (TL değer)"><Input name="trialTl" inputMode="decimal" defaultValue={s ? String(s.trialCreditKurus / 100) : "25"} required /></Field>
          <Field label="Salon günlük maliyet sınırı ($)"><Input name="tenantDailyMaxUsd" inputMode="decimal" defaultValue={s?.tenantDailyMaxUsd ?? "2"} required /></Field>
          <Field label="Konuşma başı token sınırı (24 saat)"><Input name="conversationMaxTokens" inputMode="numeric" defaultValue={s?.conversationMaxTokens ?? 150000} required /></Field>
          <div className="flex items-end"><Button disabled={busy} className="w-full">Kaydet</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

type Purchase = {
  id: string; tenant: { name: string; slug: string }; createdAt: string; status: string; sandbox: boolean;
  netAmount: string; grossAmount: string; refundedAmount: string; creditTl: string; unusedCreditTl: string; suggestedRefund: string; needsRefund: boolean; error: string | null;
};
const P_STATUS: Record<string, string> = { COMPLETED: "Yüklendi", REFUNDED: "İade edildi", PENDING: "Bekliyor", FAILED: "Başarısız" };

/** Ek paket alımları ve iyzico üzerinden iade (iade oranında değer cüzdandan geri alınır). */
function PurchasesCard({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const list = useApi<Purchase[]>("/platform/ai/purchases");
  if (!list.data) return list.error ? <Alert>{list.error.message}</Alert> : <Spinner />;
  return (
    <Card>
      <CardHeader title="Ek paket alımları" description="Önerilen iade, alımın kullanılmamış payı oranındadır (KDV dahil). İade iyzico'da gerçek para iadesi yapar." />
      <Table head={["Tarih", "İşletme", "Ödenen", "Değer / kullanılmamış", "Durum", ""]} empty="Alım yok">
        {list.data.map((p) => (
          <tr key={p.id}>
            <Td>{new Date(p.createdAt).toLocaleString("tr-TR")}</Td>
            <Td>{p.tenant.name}<div className="text-xs text-neutral-500">{p.tenant.slug}</div></Td>
            <Td>{p.grossAmount} TL{Number(p.refundedAmount) > 0 && <div className="text-xs text-neutral-500">İade: {p.refundedAmount} TL</div>}</Td>
            <Td>{p.creditTl} / {p.unusedCreditTl} TL</Td>
            <Td>{P_STATUS[p.status] ?? p.status}{p.sandbox && <Badge tone="amber">test</Badge>}{p.needsRefund && <div><Badge tone="red">Ücret alındı, iade gerekli</Badge></div>}{p.error && <div className="text-xs text-red-600">{p.error}</div>}</Td>
            <Td>
              {(p.status === "COMPLETED" || p.needsRefund) && (
                <Button size="sm" variant="outline" onClick={async () => {
                  const v = prompt(`İade tutarı (TL, KDV dahil). Önerilen: ${p.suggestedRefund}`, p.suggestedRefund);
                  if (!v) return;
                  const amount = Number(v.replace(",", "."));
                  if (!(amount > 0)) return toast("Geçerli bir tutar girin", "red");
                  if (!confirm(`${p.tenant.name} için ${amount.toFixed(2)} TL iyzico'da iade edilecek${p.needsRefund ? "" : " ve iade oranında kullanım hakkı geri alınacak"}. Onaylıyor musunuz?`)) return;
                  try {
                    await api(`/platform/ai/purchases/${p.id}/refund`, { method: "POST", body: { amount } });
                    toast("İade yapıldı");
                    list.reload();
                    onChanged();
                  } catch (e) {
                    toast((e as Error).message, "red");
                  }
                }}>İade et</Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
