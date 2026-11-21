"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Spinner, Stat, Table, Td, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Settings = { usdTry: string; fxBuffer: string; markup: string; creditRatio: string; trialCreditKurus: number; tenantDailyMaxUsd: string; conversationMaxTokens: number; updatedAt: string };
type Row = {
  tenantId: string; name: string; slug: string; plan: string; replies: number; calls: number; tokens: number; costUsd: string; costTl: string | null;
  avgCostUsdPerReply: string | null; debitTl: string; handoffRate: number; topupCount: number; topupNetTl: string; percentLeft: number | null; monthlyLeftTl: string | null; extraLeftTl: string | null;
};
type Overview = { mode: "off" | "shadow" | "enforce"; settings: Settings | null; settingsStale: boolean; last30Days: { costUsd: string; costTl: string | null; replies: number; topupNetTl: string }; today: { costUsd: string; replies: number }; tenants: Row[] };

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
      {d.settings && d.settingsStale && <Alert tone="amber">Dolar kuru 7 günden uzun süredir güncellenmedi. Düşüm hesabı güncel kurla yapılmalı.</Alert>}
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
      <SettingsForm s={d.settings} onSaved={o.reload} />
    </div>
  );
}

function SettingsForm({ s, onSaved }: { s: Settings | null; onSaved: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
                  usdTry: num("usdTry"), fxBuffer: num("fxBuffer"), markup: num("markup"), creditRatio: num("creditRatio"),
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
          <Field label="Dolar kuru (TL)"><Input name="usdTry" inputMode="decimal" defaultValue={s?.usdTry ?? ""} required /></Field>
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
