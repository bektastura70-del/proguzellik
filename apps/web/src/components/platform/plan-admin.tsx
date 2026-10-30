"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, Textarea, statusTone, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, STATUS_TR, tl } from "@/lib/format";

type PriceShort = { id: string; version: number; monthlyPrice: string; yearlyPrice: string; vatRate: string; effectiveFrom: string; renewalPolicy: RenewalPolicy; renewalsFrom: string | null };
type RenewalPolicy = "KEEP_EXISTING" | "APPLY_ON_RENEWAL";
export type Plan = {
  code: string; name: string; description: string | null; maxStaff: number; maxCustomers: number | null; maxMonthlyAppointments: number | null;
  features: string[]; isActive: boolean; isPublic: boolean; sortOrder: number; tenantCount: number;
  currentPrice: PriceShort | null; upcomingPrice: PriceShort | null; draftCount: number;
};
type PriceRow = {
  id: string; version: number | null; status: "DRAFT" | "APPROVED" | "CANCELLED"; monthlyPrice: string; yearlyPrice: string; vatRate: string;
  effectiveFrom: string; renewalPolicy: RenewalPolicy; renewalsFrom: string | null; note: string | null;
  createdAt: string; createdBy: string | null; approvedAt: string | null; approvedBy: string | null;
  cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null; lockedSubscriptions: number;
};
type PriceHistory = { plan: { code: string; name: string }; currentId: string | null; items: PriceRow[] };

/** Her pakette bulunan temel özellikler (API'deki PLAN_CORE_FEATURES ile aynı). */
export const CORE_FEATURES = ["CRM", "APPOINTMENTS", "FINANCE", "PACKAGES"];
/** Paket özellikleri (API'deki PLAN_FEATURES ile aynı). */
export const FEATURE_TR: Record<string, string> = {
  CRM: "Müşteri yönetimi",
  APPOINTMENTS: "Randevu takvimi",
  ONLINE_BOOKING: "Online randevu",
  FINANCE: "Kasa ve finans",
  PACKAGES: "Paket ve seans takibi",
  STOCK: "Stok",
  REPORTS: "Raporlar",
  WHATSAPP: "WhatsApp bildirimleri",
  AI_ASSISTANT: "Akıllı asistan",
};
const POLICY_TR: Record<RenewalPolicy, string> = {
  KEEP_EXISTING: "Mevcut abonelikler eski fiyatla devam eder",
  APPLY_ON_RENEWAL: "Mevcut abonelikler yenilemede geçer",
};
const dt = (iso: string) => dateTr(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const pct = (v: string) => `%${Number(v).toLocaleString("tr-TR")}`;
const limitText = (n: number | null) => (n == null ? "Sınırsız" : n.toLocaleString("tr-TR"));

export const usePlatformPlans = () => useApi<Plan[]>("/platform/plans");

/** Paket seçenekleri: aktif paketler + (pasif olsa bile) mevcut seçim. Gizli paketler SaaS sahibince atanabilir. */
export function PlanOptions({ plans, current }: { plans: Plan[] | null | undefined; current?: string }) {
  return (
    <>
      {(plans ?? []).filter((p) => p.isActive || p.code === current).map((p) => (
        <option key={p.code} value={p.code}>{p.name}{p.isActive ? "" : " (pasif)"}{p.isPublic ? "" : " (gizli)"} · {p.maxStaff} personel</option>
      ))}
    </>
  );
}

function PriceCell({ p }: { p: Plan }) {
  return (
    <>
      {p.currentPrice ? (
        <>
          <div className="font-medium">{tl(p.currentPrice.monthlyPrice)} <span className="text-xs font-normal text-neutral-500">/ ay</span></div>
          <div className="text-xs text-neutral-500">{Number(p.currentPrice.yearlyPrice) > 0 ? `${tl(p.currentPrice.yearlyPrice)} / yıl · ` : ""}KDV hariç, {pct(p.currentPrice.vatRate)} KDV</div>
        </>
      ) : (
        <Badge tone="amber">Onaylı fiyat yok</Badge>
      )}
      {p.upcomingPrice && <div className="mt-1 text-xs text-brand-700">{dateTr(p.upcomingPrice.effectiveFrom, { day: "numeric", month: "short", year: "numeric" })} itibarıyla {tl(p.upcomingPrice.monthlyPrice)} / ay</div>}
      {p.draftCount > 0 && <div className="mt-1 text-xs text-amber-700">{p.draftCount} taslak onay bekliyor</div>}
    </>
  );
}

export function PlansCard() {
  const plans = usePlatformPlans();
  const [edit, setEdit] = useState<Plan | "new" | null>(null);
  const [prices, setPrices] = useState<Plan | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader
        title="Paketler ve fiyatlar"
        description="Fiyatlar KDV hariçtir ve sürüm olarak yönetilir: taslak girilir, parola + 2FA ile onaylanır. Onaylı fiyatı olmayan paket sitede fiyatsız görünür. Fiyat değişikliği mevcut abonelikleri geriye dönük etkilemez."
        action={<Button size="sm" onClick={() => setEdit("new")}>Yeni paket</Button>}
      />
      <Table head={["Paket", "Sınırlar", "Güncel fiyat", "Özellikler", "Durum", ""]}>
        {plans.data?.map((p) => (
          <tr key={p.code} data-plan={p.code}>
            <Td className="max-w-[14rem]">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-neutral-500">{p.code} · {p.tenantCount} işletme</div>
              {p.description && <div className="mt-1 text-xs text-neutral-600">{p.description}</div>}
            </Td>
            <Td className="text-xs">
              <div>{p.maxStaff} personel</div>
              <div>{limitText(p.maxCustomers)} müşteri</div>
              <div>{limitText(p.maxMonthlyAppointments)} randevu / ay</div>
            </Td>
            <Td><PriceCell p={p} /></Td>
            <Td className="max-w-xs text-xs text-neutral-600">{p.features.map((f) => FEATURE_TR[f] ?? f).join(", ") || "—"}</Td>
            <Td>
              <div className="flex flex-col items-start gap-1">
                {p.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Pasif</Badge>}
                {p.isPublic ? <Badge tone="blue">Satışta</Badge> : <Badge>Gizli</Badge>}
              </div>
            </Td>
            <Td>
              <div className="flex flex-col gap-1">
                <Button size="sm" variant="outline" onClick={() => setPrices(p)}>Fiyatlar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Düzenle</Button>
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      {edit && <PlanDialog edit={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); plans.reload(); }} />}
      {prices && <PriceDialog plan={prices} onClose={() => { setPrices(null); plans.reload(); }} />}
    </Card>
  );
}

function PlanDialog({ edit, onClose, onSaved }: { edit: Plan | "new"; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = edit === "new";
  const limit = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
  return (
    <Dialog open onClose={onClose} title={isNew ? "Yeni paket" : `${edit.name} paketi`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const body = {
            name: f.get("name"),
            description: String(f.get("description") ?? "").trim() || null,
            maxStaff: Number(f.get("maxStaff")),
            maxCustomers: limit(f.get("maxCustomers")),
            maxMonthlyAppointments: limit(f.get("maxMonthlyAppointments")),
            sortOrder: Number(f.get("sortOrder")),
            features: f.getAll("features"),
            isActive: f.get("isActive") === "on",
            isPublic: f.get("isPublic") === "on",
          };
          try {
            if (isNew) await api("/platform/plans", { method: "POST", body: { ...body, code: f.get("code") } });
            else await api(`/platform/plans/${edit.code}`, { method: "PATCH", body });
            toast(isNew ? "Paket oluşturuldu. Fiyat için Fiyatlar bölümünden taslak girip onaylayın." : "Paket güncellendi");
            onSaved();
          } catch (err) { toast((err as Error).message, "red"); }
        }}
      >
        {isNew && <Field label="Paket kodu" hint="Büyük harf, rakam ve alt çizgi; sonradan değiştirilemez (ör. KURUMSAL)"><Input name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,31}" /></Field>}
        <Field label="Paket adı"><Input name="name" required minLength={2} maxLength={60} defaultValue={isNew ? "" : edit.name} /></Field>
        <Field label="Açıklama" hint="Tanıtım sitesinde paket kartında görünür (en fazla 500 karakter)"><Textarea name="description" maxLength={500} rows={2} defaultValue={isNew ? "" : edit.description ?? ""} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Personel sınırı"><Input name="maxStaff" type="number" min={1} max={500} required defaultValue={isNew ? 5 : edit.maxStaff} /></Field>
          <Field label="Sıra"><Input name="sortOrder" type="number" min={0} max={1000} defaultValue={isNew ? 100 : edit.sortOrder} /></Field>
          <Field label="Müşteri sınırı" hint="Boş = sınırsız"><Input name="maxCustomers" type="number" min={1} defaultValue={isNew || edit.maxCustomers == null ? "" : edit.maxCustomers} /></Field>
          <Field label="Aylık randevu sınırı" hint="Boş = sınırsız"><Input name="maxMonthlyAppointments" type="number" min={1} defaultValue={isNew || edit.maxMonthlyAppointments == null ? "" : edit.maxMonthlyAppointments} /></Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Özellikler</legend>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(FEATURE_TR).map(([k, v]) => CORE_FEATURES.includes(k) ? (
              <label key={k} className="flex items-center gap-2 text-neutral-500"><input type="checkbox" name="features" value={k} checked disabled readOnly />{v} <span className="text-xs">(her pakette)</span></label>
            ) : (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" name="features" value={k} defaultChecked={!isNew && edit.features.includes(k)} />{v}</label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={isNew || edit.isActive} />Aktif (pasif paket hiçbir işletmeye yeni atanamaz)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked={!isNew && edit.isPublic} />Satışta (tanıtım sitesinde ve kayıtta görünür; kapalıysa gizli, yalnız siz atayabilirsiniz)</label>
        {!isNew && !edit.currentPrice && <Alert tone="amber">Bu paketin onaylı fiyatı yok: satışta olsa bile sitede &quot;Fiyat yakında&quot; görünür ve satın alınamaz.</Alert>}
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}

const PRICE_STATUS: Record<PriceRow["status"], { label: string; tone: "amber" | "green" | "neutral" }> = {
  DRAFT: { label: "Taslak", tone: "amber" },
  APPROVED: { label: "Onaylı", tone: "green" },
  CANCELLED: { label: "İptal", tone: "neutral" },
};

/** Fiyat geçmişi, yeni taslak, onay (parola + 2FA) ve iptal. */
function PriceDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const toast = useToast();
  const history = useApi<PriceHistory>(`/platform/plans/${plan.code}/prices`);
  const [policy, setPolicy] = useState<RenewalPolicy>("KEEP_EXISTING");
  const [approving, setApproving] = useState<PriceRow | null>(null);
  const [cancelling, setCancelling] = useState<PriceRow | null>(null);
  const now = Date.now();
  const toIso = (local: FormDataEntryValue | null) => (local && String(local) ? new Date(String(local)).toISOString() : undefined);
  return (
    <Dialog open onClose={onClose} title={`${plan.name} · fiyat yönetimi`} wide>
      <section aria-label="Fiyat geçmişi">
        <h3 className="mb-2 text-sm font-semibold">Fiyat geçmişi</h3>
        {!history.data ? <Spinner /> : history.data.items.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz fiyat girilmedi. Bu paket sitede fiyatsız görünür.</p>
        ) : (
          <ul className="space-y-2">
            {history.data.items.map((v) => {
              const current = v.id === history.data!.currentId;
              const future = v.status === "APPROVED" && new Date(v.effectiveFrom).getTime() > now;
              return (
                <li key={v.id} className="rounded-xl border border-sand-200 p-3 text-sm" data-price-status={v.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRICE_STATUS[v.status].tone}>{PRICE_STATUS[v.status].label}{v.version ? ` · s${v.version}` : ""}</Badge>
                    {current && <Badge tone="blue">Yürürlükte</Badge>}
                    {future && <Badge tone="brand">Planlandı</Badge>}
                    <span className="font-medium">{tl(v.monthlyPrice)} / ay</span>
                    {Number(v.yearlyPrice) > 0 && <span>· {tl(v.yearlyPrice)} / yıl</span>}
                    <span className="text-neutral-500">· KDV hariç, {pct(v.vatRate)} KDV</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-600">
                    Yeni satış: {dt(v.effectiveFrom)}{v.status === "DRAFT" ? " (onay anından önce olamaz)" : ""} · {POLICY_TR[v.renewalPolicy]}{v.renewalsFrom ? ` (${dt(v.renewalsFrom)} sonrası başlayan dönemden itibaren)` : ""}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Hazırlayan: {v.createdBy ?? "—"} · {dt(v.createdAt)}
                    {v.approvedAt && <> · Onaylayan: {v.approvedBy ?? "—"} · {dt(v.approvedAt)}</>}
                    {v.cancelledAt && <> · İptal: {v.cancelledBy ?? "—"} · {dt(v.cancelledAt)}{v.cancelReason ? ` (${v.cancelReason})` : ""}</>}
                    {v.lockedSubscriptions > 0 && <> · {v.lockedSubscriptions} abonelik bu fiyata kilitli</>}
                  </div>
                  {v.note && <div className="mt-1 text-xs italic text-neutral-600">{v.note}</div>}
                  {(v.status === "DRAFT" || (future && v.lockedSubscriptions === 0)) && (
                    <div className="mt-2 flex gap-2">
                      {v.status === "DRAFT" && <Button size="sm" onClick={() => setApproving(v)}>Onayla</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(v)}>İptal et</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form
        className="mt-6 space-y-3 border-t border-sand-200 pt-4"
        aria-label="Yeni fiyat taslağı"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            await api(`/platform/plans/${plan.code}/prices`, {
              method: "POST",
              body: {
                monthlyPrice: Number(f.get("monthlyPrice")),
                yearlyPrice: Number(f.get("yearlyPrice") || 0),
                vatRate: f.get("vatRate") === "" ? undefined : Number(f.get("vatRate")),
                effectiveFrom: toIso(f.get("effectiveFrom")),
                renewalPolicy: policy,
                renewalsFrom: policy === "APPLY_ON_RENEWAL" ? toIso(f.get("renewalsFrom")) : undefined,
                note: String(f.get("note") ?? "").trim() || undefined,
              },
            });
            toast("Fiyat taslağı kaydedildi. Yayına girmesi için onaylayın.");
            form.reset();
            setPolicy("KEEP_EXISTING");
            history.reload();
          } catch (err) { toast((err as Error).message, "red"); }
        }}
      >
        <h3 className="text-sm font-semibold">Yeni fiyat taslağı</h3>
        <p className="text-xs text-neutral-500">Tutarlar KDV hariçtir. Taslak onaylanana kadar hiçbir yerde kullanılmaz; onaylanan fiyat değiştirilemez.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Aylık (₺, KDV hariç)"><Input name="monthlyPrice" type="number" min={0.01} step="0.01" required /></Field>
          <Field label="Yıllık (₺, KDV hariç)" hint="0 = yıllık seçenek yok"><Input name="yearlyPrice" type="number" min={0} step="0.01" defaultValue={0} /></Field>
          <Field label="KDV oranı (%)" hint="Mali müşavirinizle teyit edin"><Input name="vatRate" type="number" min={0} max={100} step="0.01" required /></Field>
        </div>
        <Field label="Yeni satışlarda geçerli olacağı tarih" hint="Boş = onay anı. Geçmiş tarih onay anına çekilir."><Input name="effectiveFrom" type="datetime-local" /></Field>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium">Mevcut aboneliklere etkisi</legend>
          <label className="flex items-start gap-2"><input type="radio" name="renewalPolicy" checked={policy === "KEEP_EXISTING"} onChange={() => setPolicy("KEEP_EXISTING")} />Mevcut abonelikler kilitli fiyatlarıyla devam etsin (yeni fiyat yalnız yeni aboneliklere)</label>
          <label className="flex items-start gap-2"><input type="radio" name="renewalPolicy" checked={policy === "APPLY_ON_RENEWAL"} onChange={() => setPolicy("APPLY_ON_RENEWAL")} />Mevcut abonelikler, aşağıdaki tarihte ya da sonrasında başlayan ilk yenileme döneminden itibaren yeni fiyata geçsin</label>
        </fieldset>
        {policy === "APPLY_ON_RENEWAL" && <Field label="Mevcut aboneliklere uygulama tarihi" hint="Boş = yeni satış tarihiyle aynı. Devam eden dönemler hiçbir zaman değişmez."><Input name="renewalsFrom" type="datetime-local" /></Field>}
        <Field label="Not (isteğe bağlı)"><Input name="note" maxLength={300} /></Field>
        <Button className="w-full" variant="outline">Taslak olarak kaydet</Button>
      </form>

      {approving && (
        <Dialog open onClose={() => setApproving(null)} title="Fiyatı onayla">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api(`/platform/plans/${plan.code}/prices/${approving.id}/approve`, { method: "POST", body: { password: f.get("password"), code: f.get("code") } });
                toast("Fiyat onaylandı");
                setApproving(null);
                history.reload();
              } catch (err) { toast((err as Error).message, "red"); }
            }}
          >
            <Alert tone="amber">
              {plan.name}: {tl(approving.monthlyPrice)} / ay{Number(approving.yearlyPrice) > 0 ? `, ${tl(approving.yearlyPrice)} / yıl` : ""} (KDV hariç, {pct(approving.vatRate)} KDV).
              {" "}{POLICY_TR[approving.renewalPolicy]}. Onaydan sonra bu fiyat değiştirilemez{plan.isPublic && plan.isActive ? " ve tanıtım sitesinde yayımlanır" : ""}.
            </Alert>
            <Field label="Parolanız"><Input name="password" type="password" autoComplete="current-password" required /></Field>
            <Field label="2FA doğrulama kodu"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required /></Field>
            <Button className="w-full">Onayla ve yayımla</Button>
          </form>
        </Dialog>
      )}
      {cancelling && (
        <Dialog open onClose={() => setCancelling(null)} title="Fiyat sürümünü iptal et">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await api(`/platform/plans/${plan.code}/prices/${cancelling.id}/cancel`, { method: "POST", body: { reason: f.get("reason") } });
                toast("Fiyat sürümü iptal edildi");
                setCancelling(null);
                history.reload();
              } catch (err) { toast((err as Error).message, "red"); }
            }}
          >
            <Field label="Gerekçe"><Input name="reason" required minLength={3} maxLength={300} /></Field>
            <Button className="w-full" variant="outline">İptal et</Button>
          </form>
        </Dialog>
      )}
    </Dialog>
  );
}

type SubRow = {
  id: string; status: string; source: "PROVIDER" | "MANUAL"; isComplimentary: boolean; billingCycle: string;
  currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean;
  plan: { code: string; name: string }; tenant: { id: string; name: string; status: string };
};
type SubList = { summary: { tenants: Record<string, number>; subscriptions: Record<string, number>; trialsEndingIn7Days: { id: string; name: string; trialEndsAt: string }[]; subscriptionsEndingIn7Days: number }; items: SubRow[] };
const SUB_STATUS_TR: Record<string, string> = { ACTIVE: "Aktif", PAST_DUE: "Ödeme bekliyor", CANCELLED: "İptal / süresi doldu" };
const day = (iso: string) => dateTr(iso, { day: "numeric", month: "short", year: "numeric" });

/** Abonelik izleme: aktif, deneme, süresi dolan ve askıdaki işletmeler. */
export function SubscriptionsCard({ onOpenTenant }: { onOpenTenant: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [expiring, setExpiring] = useState("");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(expiring ? { expiringDays: expiring } : {}), ...(q ? { q } : {}) });
  const list = useApi<SubList>(`/platform/subscriptions?${qs}`);
  const s = list.data?.summary;
  return (
    <>
      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Deneme" value={s.tenants.TRIAL ?? 0} hint={`${s.trialsEndingIn7Days.length} tanesi 7 gün içinde bitiyor`} />
          <Stat label="Aktif işletme" value={s.tenants.ACTIVE ?? 0} />
          <Stat label="Ödeme bekleyen / süresi dolan" value={s.tenants.PAST_DUE ?? 0} />
          <Stat label="Askıda" value={s.tenants.SUSPENDED ?? 0} />
          <Stat label="7 günde biten abonelik" value={s.subscriptionsEndingIn7Days} />
        </div>
      )}
      {s && s.trialsEndingIn7Days.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Denemesi yakında bitenler" />
          <Table head={["İşletme", "Deneme bitişi", ""]}>
            {s.trialsEndingIn7Days.map((t) => (
              <tr key={t.id}><Td>{t.name}</Td><Td>{day(t.trialEndsAt)}</Td><Td><Button size="sm" variant="ghost" onClick={() => onOpenTenant(t.id)}>Yönet</Button></Td></tr>
            ))}
          </Table>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader
          title="Abonelikler"
          action={
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Abonelik ara" placeholder="İşletme ara" className="h-9 w-44" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select aria-label="Abonelik durumu" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tüm durumlar</option>
                {Object.entries(SUB_STATUS_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="Abonelik kaynağı" className="h-9 w-40" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Tüm kaynaklar</option>
                <option value="PROVIDER">Ödemeli</option>
                <option value="MANUAL">Manuel</option>
              </Select>
              <Select aria-label="Bitiş" className="h-9 w-40" value={expiring} onChange={(e) => setExpiring(e.target.value)}>
                <option value="">Tüm bitişler</option>
                <option value="7">7 gün içinde</option>
                <option value="30">30 gün içinde</option>
              </Select>
            </div>
          }
        />
        {!list.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["İşletme", "Paket", "Kaynak", "Durum", "Dönem", ""]} empty="Abonelik yok">
            {list.data.items.map((x) => (
              <tr key={x.id}>
                <Td><div className="font-medium">{x.tenant.name}</div><Badge tone={statusTone(x.tenant.status)}>{STATUS_TR[x.tenant.status]}</Badge></Td>
                <Td>{x.plan.name} · {x.billingCycle === "YEARLY" ? "Yıllık" : x.billingCycle === "MONTHLY" ? "Aylık" : "Özel"}</Td>
                <Td>{x.source === "MANUAL" ? <Badge tone="amber">{x.isComplimentary ? "Manuel · ücretsiz" : "Manuel"}</Badge> : <Badge tone="blue">Ödemeli</Badge>}</Td>
                <Td><Badge tone={statusTone(x.status)}>{SUB_STATUS_TR[x.status]}</Badge>{x.cancelAtPeriodEnd && <div className="text-xs text-neutral-500">Dönem sonunda bitecek</div>}</Td>
                <Td className="text-xs">{day(x.currentPeriodStart)} – {day(x.currentPeriodEnd)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onOpenTenant(x.tenant.id)}>Yönet</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
