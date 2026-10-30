"use client";

import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Select, Table, Td, Textarea, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { PlanOptions, usePlatformPlans } from "./plan-admin";
import { dateTr, tl } from "@/lib/format";

const SUB_STATUS_TR: Record<string, string> = { ACTIVE: "Aktif", PAST_DUE: "Süresi doldu / ödeme bekliyor", CANCELLED: "İptal" };
const ACTION_TR: Record<string, string> = { CREATED: "Oluşturuldu", EXTENDED: "Süre uzatıldı", RENEWED: "Yenilendi", PLAN_CHANGED: "Paket değişti", CANCELLED: "İptal" };
const day = (iso: string | null) => (iso ? dateTr(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");

type Grant = { id: string; action: string; planCode: string; previousPlanCode: string | null; periodEnd: string | null; agreedAmount: string; isComplimentary: boolean; note: string; createdAt: string };
type Payment = { id: string; amount: string; status: string; provider: string; description: string | null; createdAt: string };
export type AdminSubscription = {
  id: string;
  planCode: string;
  billingCycle: string;
  status: string;
  source: "PROVIDER" | "MANUAL";
  isComplimentary: boolean;
  provider: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  grants: Grant[];
  payments: Payment[];
};

type Mode = null | "create" | "extend" | "renew" | "plan" | "cancel";

export function SourceBadge({ s }: { s: Pick<AdminSubscription, "source" | "isComplimentary"> }) {
  if (s.source === "PROVIDER") return <Badge tone="brand">Ödeme sağlayıcısı</Badge>;
  return <Badge tone={s.isComplimentary ? "green" : "blue"}>{s.isComplimentary ? "Manuel · ücretsiz" : "Manuel · ücretli"}</Badge>;
}

/** Ücretsiz/ücretli seçimi ve anlaşılan tutar (manuel tutar bir tahsilat değildir, yalnızca kayda geçer). */
function PriceFields() {
  const [free, setFree] = useState(true);
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="complimentary" checked={free} onChange={(e) => setFree(e.target.checked)} /> Ücretsiz (hediye) abonelik
      </label>
      {!free && (
        <Field label="Anlaşılan tutar (₺)" hint="Havale/sözleşme ile alınan tutar kayda geçer; bu ekran tahsilat yapmaz.">
          <Input name="agreedAmount" type="number" min={1} step="0.01" required />
        </Field>
      )}
    </>
  );
}

const priceBody = (f: FormData) => {
  const complimentary = f.get("complimentary") === "on";
  return { complimentary, ...(complimentary ? {} : { agreedAmount: Number(f.get("agreedAmount")) }) };
};
const optionalDays = (f: FormData, key = "durationDays") => (f.get(key) ? { [key]: Number(f.get(key)) } : {});

/** İşletme detayındaki abonelik bölümü: manuel oluşturma, uzatma, yenileme, paket atama, iptal ve geçmiş. */
export function SubscriptionAdmin({ tenantId, subscriptions, onChanged }: { tenantId: string; subscriptions: AdminSubscription[]; onChanged: (msg: string) => void }) {
  const plans = usePlatformPlans();
  const planName = (code: string) => plans.data?.find((p) => p.code === code)?.name ?? code;
  const [mode, setMode] = useState<Mode>(null);
  // Her form açılışında yeni istek kimliği; hata sonrası tekrar gönderimde aynı kimlik kullanılır (çift işlem olmaz).
  const [requestId, setRequestId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = subscriptions.find((s) => s.status === "ACTIVE" || s.status === "PAST_DUE");
  const grants = subscriptions.flatMap((s) => s.grants).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const payments = subscriptions.flatMap((s) => s.payments).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const open = (m: Mode) => {
    setErr(null);
    setRequestId(crypto.randomUUID());
    setMode(m);
  };
  const submit = (path: string, msg: string, body: (f: FormData) => Record<string, unknown>) => async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setErr(null);
    setBusy(true);
    try {
      await api(path, { method: "POST", body: { ...body(f), note: f.get("note"), requestId } });
      setMode(null);
      onChanged(msg);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const noteField = <Field label="Açıklama (denetim kaydına yazılır)"><Textarea name="note" required minLength={3} maxLength={500} rows={2} /></Field>;
  const actions = (label: string, danger = false) => (
    <div className="flex gap-2">
      <Button variant={danger ? "danger" : "default"} disabled={busy}>{busy ? "Kaydediliyor…" : label}</Button>
      <Button type="button" variant="ghost" onClick={() => setMode(null)}>Vazgeç</Button>
    </div>
  );
  const manual = current?.source === "MANUAL";

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Abonelik</h3>
      {current ? (
        <div className="space-y-1 rounded-xl border border-sand-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{planName(current.planCode)}</b>
            <SourceBadge s={current} />
            <Badge tone={statusTone(current.status)}>{SUB_STATUS_TR[current.status]}</Badge>
          </div>
          <div className="text-neutral-600">
            Dönem: {day(current.currentPeriodStart)} – {day(current.currentPeriodEnd)}
            {current.cancelAtPeriodEnd && " · dönem sonunda iptal edilecek"}
            {manual && !current.cancelAtPeriodEnd && " · otomatik yenilenmez"}
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Açık abonelik yok. Online ödeme kapalıyken işletme yalnızca manuel abonelikle aktif olur.</p>
      )}

      {mode === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!current && <Button size="sm" onClick={() => open("create")}>Manuel abonelik oluştur</Button>}
          {manual && (
            <>
              <Button size="sm" variant="outline" onClick={() => open("extend")}>Süre uzat</Button>
              <Button size="sm" variant="outline" onClick={() => open("renew")}>Yenile</Button>
              <Button size="sm" variant="outline" onClick={() => open("plan")}>Paket ata</Button>
            </>
          )}
          {current && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => open("cancel")}>İptal et</Button>}
        </div>
      )}
      {current && !manual && mode === null && <p className="mt-1 text-xs text-neutral-500">Ödeme sağlayıcısıyla alınan abonelik elle uzatılamaz veya değiştirilemez; yalnızca iptal edilebilir.</p>}

      {mode && (
        <div className="mt-3 rounded-xl border border-sand-200 p-3">
          {err && <div className="mb-3"><Alert>{err}</Alert></div>}
          {mode === "create" && (
            <form className="space-y-3" onSubmit={submit(`/platform/tenants/${tenantId}/subscriptions`, "Manuel abonelik oluşturuldu", (f) => ({ planCode: f.get("planCode"), billingCycle: f.get("billingCycle"), ...optionalDays(f), ...priceBody(f) }))}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Paket"><Select name="planCode" defaultValue="PROFESSIONAL"><PlanOptions plans={plans.data} /></Select></Field>
                <Field label="Dönem"><Select name="billingCycle" defaultValue="MONTHLY"><option value="MONTHLY">Aylık</option><option value="YEARLY">Yıllık</option></Select></Field>
                <Field label="Özel süre (gün)" hint="Boşsa dönem kadar."><Input name="durationDays" type="number" min={1} max={730} /></Field>
              </div>
              <PriceFields />
              {noteField}
              {actions("Oluştur")}
            </form>
          )}
          {mode === "extend" && (
            <form className="space-y-3" onSubmit={submit(`/platform/subscriptions/${current!.id}/extend`, "Süre uzatıldı", (f) => ({ days: Number(f.get("days")) }))}>
              <Field label="Eklenecek gün" hint="Bitiş tarihine eklenir; süre dolmuşsa bugünden başlar. Ücretsiz süre olarak kaydedilir."><Input name="days" type="number" min={1} max={366} required /></Field>
              {noteField}
              {actions("Uzat")}
            </form>
          )}
          {mode === "renew" && (
            <form className="space-y-3" onSubmit={submit(`/platform/subscriptions/${current!.id}/renew`, "Abonelik yenilendi", (f) => ({ ...optionalDays(f), ...priceBody(f) }))}>
              <Field label="Özel süre (gün)" hint="Boşsa aboneliğin dönemi kadar. Süre bitmediyse mevcut bitişten başlar."><Input name="durationDays" type="number" min={1} max={730} /></Field>
              <PriceFields />
              {noteField}
              {actions("Yenile")}
            </form>
          )}
          {mode === "plan" && (
            <form className="space-y-3" onSubmit={submit(`/platform/subscriptions/${current!.id}/plan`, "Paket değiştirildi", (f) => ({ planCode: f.get("planCode") }))}>
              <Field label="Yeni paket">
                <Select name="planCode" defaultValue={current!.planCode}><PlanOptions plans={plans.data} current={current!.planCode} /></Select>
              </Field>
              {noteField}
              {actions("Paketi ata")}
            </form>
          )}
          {mode === "cancel" && (
            <form className="space-y-3" onSubmit={submit(`/platform/subscriptions/${current!.id}/cancel`, "Abonelik iptal edildi", (f) => ({ mode: f.get("mode") }))}>
              <Field label="İptal zamanı">
                <Select name="mode" defaultValue="period_end"><option value="period_end">Dönem sonunda</option><option value="immediate">Hemen (işletme kapanır)</option></Select>
              </Field>
              <p className="text-xs text-neutral-500">Para iadesi bu işlemle yapılmaz.</p>
              {noteField}
              {actions("İptal et", true)}
            </form>
          )}
        </div>
      )}

      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-neutral-500">Manuel işlem defteri (tahsilat değildir)</h4>
      <Table head={["Tarih", "İşlem", "Paket", "Bitiş", "Tutar", "Açıklama"]} empty="Manuel işlem yok">
        {grants.map((g) => (
          <tr key={g.id}>
            <Td>{day(g.createdAt)}</Td>
            <Td>{ACTION_TR[g.action] ?? g.action}</Td>
            <Td>{g.previousPlanCode ? `${planName(g.previousPlanCode)} → ${planName(g.planCode)}` : planName(g.planCode)}</Td>
            <Td>{day(g.periodEnd)}</Td>
            <Td>{g.isComplimentary || Number(g.agreedAmount) === 0 ? "Ücretsiz" : tl(g.agreedAmount)}</Td>
            <Td>{g.note}</Td>
          </tr>
        ))}
      </Table>

      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-neutral-500">Tahsilatlar (ödeme sağlayıcısı)</h4>
      <Table head={["Tarih", "Açıklama", "Tutar", "Durum", "Sağlayıcı"]} empty="Tahsilat yok">
        {payments.map((p) => (
          <tr key={p.id}>
            <Td>{day(p.createdAt)}</Td>
            <Td>{p.description}</Td>
            <Td>{tl(p.amount)}</Td>
            <Td>{p.status === "PAID" ? "Ödendi" : p.status === "FAILED" ? "Başarısız" : p.status}</Td>
            <Td>{p.provider === "mock" ? "Test" : p.provider}</Td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
