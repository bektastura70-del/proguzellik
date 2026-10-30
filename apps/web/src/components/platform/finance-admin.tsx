"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Select, Spinner, Stat, Table, Td, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, isoDay, tl } from "@/lib/format";

const TYPE_TR: Record<string, string> = { ACCRUAL: "Tahakkuk", ACCRUAL_CANCEL: "Tahakkuk iptali", PAYMENT: "Tahsilat", REFUND: "İade" };
const METHOD_TR: Record<string, string> = { BANK_TRANSFER: "Havale/EFT", CARD: "Kart", CASH: "Nakit", OTHER: "Diğer" };
const STATE_TR: Record<string, [string, "green" | "amber" | "red" | "neutral" | "blue"]> = {
  OPEN: ["Açık", "blue"], PARTIAL: ["Kısmi tahsil", "amber"], PAID: ["Tahsil edildi", "green"], OVERDUE: ["Vadesi geçti", "red"], CANCELLED: ["İptal", "neutral"],
};
export const INVOICE_STATUS_TR: Record<string, [string, "green" | "amber" | "red" | "neutral" | "blue"]> = {
  DRAFT: ["Taslak (mali değeri yok)", "amber"], RECORDED: ["Kayıtlı (harici sistemde kesildi)", "blue"], ISSUED: ["e-Fatura/e-Arşiv düzenlendi", "green"], CANCELLED: ["İptal", "neutral"],
};
const day = (iso: string | null) => (iso ? dateTr(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");
const rid = () => crypto.randomUUID();
const endOfDay = (d: string) => new Date(`${d}T23:59:00+03:00`).toISOString();

/** CSV dosyasını oturum çereziyle indirir. */
export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`/api/p${path}`);
  if (!res.ok) throw new Error("CSV indirilemedi");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type AccountRow = { tenant: { id: string; name: string; status: string }; accrued: string; collected: string; refunded: string; balance: string; overdue: string };
type Accounts = { rows: AccountRow[]; totals: { netAccrued: string; collected: string; refunded: string; netCollected: string; receivable: string; payable: string } };

export function FinanceOverview({ tenants }: { tenants: { id: string; name: string }[] }) {
  const accounts = useApi<Accounts>("/platform/finance/accounts");
  const [ledger, setLedger] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const t = accounts.data?.totals;
  return (
    <>
      <Alert tone="brand">Bu bölüm yalnızca SaaS sahibinin muhasebesidir; güzellik merkezlerinin kendi kasa ve gelir/gider kayıtlarıyla karışmaz. Manuel ücretsiz abonelikler burada gelir olarak görünmez.</Alert>
      {t && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tahakkuk (net)" value={tl(t.netAccrued)} />
          <Stat label="Tahsil edilen (net)" value={tl(t.netCollected)} hint={`İade: ${tl(t.refunded)}`} />
          <Stat label="Bekleyen alacak" value={tl(t.receivable)} />
          <Stat label="Fazla tahsilat (borç)" value={tl(t.payable)} />
        </div>
      )}
      <Card className="mt-6">
        <CardHeader
          title="Cari hesaplar"
          description="Bakiye pozitifse işletmenin borcu (alacağımız), negatifse fazla tahsilat (borcumuz)."
          action={
            <div className="flex gap-2">
              <Select aria-label="Cari hesap aç" className="h-9 w-52" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">İşletme seçin…</option>
                {tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Button size="sm" className="h-9" disabled={!pick} onClick={() => setLedger(pick)}>Cari hesabı aç</Button>
            </div>
          }
        />
        {!accounts.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["İşletme", "Tahakkuk", "Tahsilat", "İade", "Bakiye", "Vadesi geçen", ""]} empty="Henüz cari kayıt yok">
            {accounts.data.rows.map((r) => (
              <tr key={r.tenant.id}>
                <Td className="font-medium">{r.tenant.name}</Td>
                <Td>{tl(r.accrued)}</Td>
                <Td>{tl(r.collected)}</Td>
                <Td>{tl(r.refunded)}</Td>
                <Td className={Number(r.balance) > 0 ? "font-medium text-red-700" : Number(r.balance) < 0 ? "font-medium text-amber-700" : ""}>{tl(r.balance)}</Td>
                <Td>{Number(r.overdue) > 0 ? <Badge tone="red">{tl(r.overdue)}</Badge> : "—"}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setLedger(r.tenant.id)}>Cari</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <RevenueReport />
      <InvoicesCard />
      {ledger && <LedgerDialog tenantId={ledger} onClose={() => { setLedger(null); accounts.reload(); }} />}
    </>
  );
}

type LedgerEntry = { id: string; type: string; amount: string; description: string; occurredAt: string; dueDate: string | null; method: string | null; reference: string | null; relatedEntryId: string | null; runningBalance: string; paid: string; refunded: string; open: string | null; state: string | null; invoice: { id: string; draftNo: string; officialNumber: string | null; status: string } | null };
type Ledger = { tenant: { id: string; name: string }; entries: LedgerEntry[]; totals: Record<string, string> };
type BillingProfile = { legalName: string; taxNumber: string | null; taxOffice: string | null; address: string | null; email: string | null } | null;
type Action = { kind: "ACCRUAL" } | { kind: "PAYMENT"; accrual?: LedgerEntry } | { kind: "REFUND"; payment: LedgerEntry } | { kind: "ACCRUAL_CANCEL"; accrual: LedgerEntry };

export function LedgerDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const toast = useToast();
  const l = useApi<Ledger>(`/platform/finance/tenants/${tenantId}/ledger`);
  const profile = useApi<BillingProfile>(`/platform/tenants/${tenantId}/billing-profile`);
  const [action, setAction] = useState<Action | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [requestId, setRequestId] = useState(rid);

  const submitEntry = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      await api("/platform/finance/entries", { method: "POST", body: { tenantId, requestId, ...body } });
      toast("Kayıt eklendi");
      setAction(null);
      setRequestId(rid());
      l.reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const draftFrom = async (accrualId: string) => {
    setErr(null);
    try {
      const inv = await api<{ id: string }>("/platform/invoices", { method: "POST", body: { tenantId, accrualId } });
      toast("Fatura taslağı oluşturuldu");
      window.open(`/yonetim/fatura/${inv.id}`, "_blank");
      l.reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Dialog open onClose={onClose} title={l.data ? `${l.data.tenant.name} · cari hesap` : "Cari hesap"} wide>
      {!l.data ? <Spinner /> : (
        <div className="space-y-5">
          {err && <Alert>{err}</Alert>}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-neutral-500">Tahakkuk (net)</div><b>{tl(l.data.totals.netAccrued)}</b></div>
            <div><div className="text-neutral-500">Tahsilat</div><b>{tl(l.data.totals.collected)}</b></div>
            <div><div className="text-neutral-500">İade</div><b>{tl(l.data.totals.refunded)}</b></div>
            <div><div className="text-neutral-500">Bakiye</div><b>{tl(l.data.totals.balance)}</b></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAction({ kind: "ACCRUAL" })}>Tahakkuk ekle</Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ kind: "PAYMENT" })}>Avans tahsilat</Button>
            <Button size="sm" variant="ghost" onClick={() => downloadCsv(`/platform/finance/tenants/${tenantId}/ledger.csv`, `cari-${l.data!.tenant.name}.csv`).catch((e) => toast((e as Error).message, "red"))}>CSV indir</Button>
          </div>

          {action && (
            <form
              className="space-y-3 rounded-lg border border-sand-200 bg-sand-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const base: Record<string, unknown> = { type: action.kind, amount: Number(f.get("amount")), description: f.get("description") };
                const due = f.get("dueDate") as string | null;
                if (due) base.dueDate = endOfDay(due);
                const method = f.get("method");
                if (method) base.method = method;
                const ref = f.get("reference") as string | null;
                if (ref) base.reference = ref;
                if (action.kind === "PAYMENT" && action.accrual) base.relatedEntryId = action.accrual.id;
                if (action.kind === "REFUND") base.relatedEntryId = action.payment.id;
                if (action.kind === "ACCRUAL_CANCEL") base.relatedEntryId = action.accrual.id;
                void submitEntry(base);
              }}
            >
              <h4 className="text-sm font-semibold">{TYPE_TR[action.kind]}{action.kind === "PAYMENT" && action.accrual ? ` · ${action.accrual.description}` : ""}</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tutar (₺)">
                  <Input name="amount" type="number" min="0.01" step="0.01" required defaultValue={action.kind === "PAYMENT" && action.accrual ? Number(action.accrual.open) : action.kind === "ACCRUAL_CANCEL" ? Number(action.accrual.open) : action.kind === "REFUND" ? Number(action.payment.amount) - Number(action.payment.refunded) : undefined} />
                </Field>
                <Field label="Açıklama" className="sm:col-span-2"><Input name="description" required minLength={3} maxLength={300} defaultValue={action.kind === "PAYMENT" && action.accrual ? `${action.accrual.description} tahsilatı` : ""} /></Field>
                {action.kind === "ACCRUAL" && <Field label="Vade"><Input name="dueDate" type="date" defaultValue={isoDay(new Date(Date.now() + 7 * 86_400_000))} /></Field>}
                {(action.kind === "PAYMENT" || action.kind === "REFUND") && (
                  <>
                    <Field label="Yöntem"><Select name="method" defaultValue="BANK_TRANSFER">{Object.entries(METHOD_TR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                    <Field label="Referans (dekont no)"><Input name="reference" maxLength={100} /></Field>
                  </>
                )}
              </div>
              <p className="text-xs text-neutral-500">Kayıtlar silinemez ve değiştirilemez; hata ters kayıtla (iptal/iade) düzeltilir.</p>
              <div className="flex gap-2"><Button>Kaydet</Button><Button type="button" variant="ghost" onClick={() => { setAction(null); setErr(null); }}>Vazgeç</Button></div>
            </form>
          )}

          <Table head={["Tarih", "Tür", "Açıklama", "Tutar", "Durum", "Bakiye", ""]} empty="Kayıt yok">
            {l.data.entries.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{day(e.occurredAt)}</Td>
                <Td>{TYPE_TR[e.type]}{e.method && <div className="text-xs text-neutral-500">{METHOD_TR[e.method]}{e.reference ? ` · ${e.reference}` : ""}</div>}</Td>
                <Td>{e.description}{e.dueDate && <div className="text-xs text-neutral-500">Vade: {day(e.dueDate)}</div>}{e.invoice && <div className="text-xs"><Link className="text-brand-700" href={`/yonetim/fatura/${e.invoice.id}`} target="_blank">{e.invoice.officialNumber ?? e.invoice.draftNo}</Link></div>}</Td>
                <Td className={`whitespace-nowrap ${e.type === "PAYMENT" || e.type === "ACCRUAL_CANCEL" ? "text-green-700" : ""}`}>{e.type === "PAYMENT" || e.type === "ACCRUAL_CANCEL" ? "−" : "+"}{tl(e.amount)}</Td>
                <Td>{e.state ? <Badge tone={STATE_TR[e.state][1]}>{STATE_TR[e.state][0]}</Badge> : e.type === "PAYMENT" && Number(e.refunded) > 0 ? <Badge tone="amber">{tl(e.refunded)} iade</Badge> : null}{e.open && Number(e.open) > 0 && <div className="text-xs text-neutral-500">Kalan {tl(e.open)}</div>}</Td>
                <Td className="whitespace-nowrap">{tl(e.runningBalance)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {e.type === "ACCRUAL" && e.open && Number(e.open) > 0 && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "PAYMENT", accrual: e })}>Tahsilat</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "ACCRUAL_CANCEL", accrual: e })}>İptal</Button>
                      <Button size="sm" variant="ghost" onClick={() => api<{ to: string }>(`/platform/finance/entries/${e.id}/remind`, { method: "POST" }).then((r) => toast(`Ödeme hatırlatması gönderildi: ${r.to}`), (err) => toast((err as Error).message, "red"))}>Hatırlat</Button>
                    </>
                  )}
                  {e.type === "ACCRUAL" && (!e.invoice || e.invoice.status === "CANCELLED") && <Button size="sm" variant="ghost" onClick={() => draftFrom(e.id)}>Fatura taslağı</Button>}
                  {e.type === "PAYMENT" && Number(e.amount) > Number(e.refunded) && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "REFUND", payment: e })}>İade</Button>}
                </Td>
              </tr>
            ))}
          </Table>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Fatura bilgileri</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditingProfile((v) => !v)}>{editingProfile ? "Kapat" : "Düzenle"}</Button>
            </div>
            {!editingProfile ? (
              profile.data ? <p className="text-sm text-neutral-600">{profile.data.legalName}{profile.data.taxNumber ? ` · ${profile.data.taxNumber}` : ""}{profile.data.taxOffice ? ` · ${profile.data.taxOffice}` : ""}<br />{profile.data.address}</p> : <p className="text-sm text-amber-700">Fatura bilgisi girilmedi; taslak oluşturmak için gerekli.</p>
            ) : (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await api(`/platform/tenants/${tenantId}/billing-profile`, { method: "PUT", body: Object.fromEntries(["legalName", "taxNumber", "taxOffice", "address", "email"].map((k) => [k, f.get(k)])) });
                    toast("Fatura bilgileri kaydedildi");
                    setEditingProfile(false);
                    profile.reload();
                  } catch (er) { setErr((er as Error).message); }
                }}
              >
                <Field label="Unvan" className="sm:col-span-2"><Input name="legalName" required minLength={2} defaultValue={profile.data?.legalName ?? ""} /></Field>
                <Field label="VKN / TCKN"><Input name="taxNumber" inputMode="numeric" pattern="\d{10}|\d{11}" defaultValue={profile.data?.taxNumber ?? ""} /></Field>
                <Field label="Vergi dairesi"><Input name="taxOffice" defaultValue={profile.data?.taxOffice ?? ""} /></Field>
                <Field label="Adres" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={profile.data?.address ?? ""} /></Field>
                <Field label="Fatura e-postası"><Input name="email" type="email" defaultValue={profile.data?.email ?? ""} /></Field>
                <div className="flex items-end"><Button>Kaydet</Button></div>
              </form>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

type Report = { year: number; rows: { period: string; accrued: string; collected: string; refunded: string; netCollected: string; onlineCollected: string; pendingAtEnd: string; complimentaryGrants: number }[]; totals: { accrued: string; collected: string; refunded: string; netCollected: string; onlineCollected: string; pending: string; complimentaryGrants: number } };
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const periodLabel = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p);

export function ReportTable({ r }: { r: Report }) {
  return (
    <Table head={["Dönem", "Tahakkuk", "Tahsil edilen", "İade", "Net tahsilat", "Online", "Dönem sonu bekleyen", "Ücretsiz tanımlama"]}>
      {r.rows.map((x) => (
        <tr key={x.period}><Td>{periodLabel(x.period)}</Td><Td>{tl(x.accrued)}</Td><Td>{tl(x.collected)}</Td><Td>{tl(x.refunded)}</Td><Td className="font-medium">{tl(x.netCollected)}</Td><Td>{tl(x.onlineCollected)}</Td><Td>{tl(x.pendingAtEnd)}</Td><Td>{x.complimentaryGrants || "—"}</Td></tr>
      ))}
      <tr className="bg-sand-50 font-semibold"><Td>Toplam</Td><Td>{tl(r.totals.accrued)}</Td><Td>{tl(r.totals.collected)}</Td><Td>{tl(r.totals.refunded)}</Td><Td>{tl(r.totals.netCollected)}</Td><Td>{tl(r.totals.onlineCollected)}</Td><Td>{tl(r.totals.pending)}</Td><Td>{r.totals.complimentaryGrants || "—"}</Td></tr>
    </Table>
  );
}

function RevenueReport() {
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [gran, setGran] = useState<"month" | "year">("month");
  const r = useApi<Report>(`/platform/finance/report?year=${year}&granularity=${gran}`);
  return (
    <Card className="mt-6">
      <CardHeader
        title="Gelir raporu"
        description="Tahsil edilen ve bekleyen tutarlar ayrı gösterilir. Ücretsiz tanımlamalar gelire dahil değildir; yalnızca adet olarak listelenir."
        action={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Rapor yılı" className="h-9 w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}</Select>
            <Select aria-label="Rapor dönemi" className="h-9 w-28" value={gran} onChange={(e) => setGran(e.target.value as "month" | "year")}><option value="month">Aylık</option><option value="year">Yıllık</option></Select>
            <Button size="sm" variant="outline" className="h-9" onClick={() => downloadCsv(`/platform/finance/report.csv?year=${year}&granularity=${gran}`, `gelir-raporu-${year}.csv`).catch((e) => toast((e as Error).message, "red"))}>CSV</Button>
            <Link className="inline-flex h-9 items-center rounded-lg border border-sand-200 px-3 text-sm" href={`/yonetim/rapor?yil=${year}&donem=${gran}`} target="_blank">Yazdır / PDF</Link>
          </div>
        }
      />
      {!r.data ? <div className="p-6"><Spinner /></div> : <ReportTable r={r.data} />}
    </Card>
  );
}

type InvoiceRow = { id: string; draftNo: string; officialNumber: string | null; status: string; grossTotal: string; createdAt: string; tenant: { name: string } };
function InvoicesCard() {
  const [status, setStatus] = useState("");
  const list = useApi<InvoiceRow[]>(`/platform/invoices${status ? `?status=${status}` : ""}`);
  return (
    <Card className="mt-6">
      <CardHeader
        title="Faturalar"
        description="Taslaklar mali belge değildir. Resmî e-Fatura/e-Arşiv yalnızca yetkili entegratör bağlandığında düzenlenir; başka sistemde kesilen faturanın numarası kaydedilebilir."
        action={<Select aria-label="Fatura durumu" className="h-9 w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tüm faturalar</option>{Object.entries(INVOICE_STATUS_TR).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select>}
      />
      <Table head={["No", "İşletme", "Tutar", "Durum", "Oluşturma", ""]} empty="Fatura yok">
        {list.data?.map((i) => (
          <tr key={i.id}>
            <Td className="font-mono text-xs">{i.officialNumber ?? i.draftNo}</Td>
            <Td>{i.tenant.name}</Td>
            <Td>{tl(i.grossTotal)}</Td>
            <Td><Badge tone={INVOICE_STATUS_TR[i.status][1]}>{INVOICE_STATUS_TR[i.status][0]}</Badge></Td>
            <Td>{day(i.createdAt)}</Td>
            <Td><Link className="text-sm text-brand-700" href={`/yonetim/fatura/${i.id}`} target="_blank">Aç</Link></Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

type CompanyResp = {
  company: { legalName: string | null; address: string | null; taxNumber: string | null; taxOffice: string | null; iban: string | null; email: string | null; phone: string | null; website: string | null; vatRate: string | null; pricesIncludeVat: boolean | null; paymentTermDays: number; invoiceNote: string | null };
  email: { mode: string; smtpConfigured: boolean; from: string; deliveryEnabled: boolean };
  einvoice: { provider: string; configured: boolean };
};

export function CompanySettingsCard() {
  const toast = useToast();
  const c = useApi<CompanyResp>("/platform/company");
  const [err, setErr] = useState<string | null>(null);
  if (!c.data) return <div className="mt-6"><Spinner /></div>;
  const co = c.data.company;
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Şirket ve fatura ayarları" description="Bilgiler girilene kadar boş kalır; faturalarda yalnızca burada girilen bilgiler kullanılır." />
        <CardBody>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              const f = new FormData(e.currentTarget);
              const text = (k: string) => (f.get(k) as string) ?? "";
              const vat = text("vatRate");
              const inc = text("pricesIncludeVat");
              try {
                await api("/platform/company", {
                  method: "PUT",
                  body: {
                    legalName: text("legalName"), address: text("address"), taxNumber: text("taxNumber"), taxOffice: text("taxOffice"), iban: text("iban"),
                    email: text("email"), phone: text("phone"), website: text("website"), invoiceNote: text("invoiceNote"),
                    vatRate: vat === "" ? null : Number(vat), pricesIncludeVat: inc === "" ? null : inc === "1", paymentTermDays: Number(text("paymentTermDays")),
                  },
                });
                toast("Şirket ayarları kaydedildi");
                c.reload();
              } catch (er) { setErr((er as Error).message); }
            }}
          >
            {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
            <Field label="Şirket unvanı" className="sm:col-span-2"><Input name="legalName" maxLength={200} defaultValue={co.legalName ?? ""} /></Field>
            <Field label="Adres" className="sm:col-span-2"><Textarea name="address" rows={2} maxLength={500} defaultValue={co.address ?? ""} /></Field>
            <Field label="VKN"><Input name="taxNumber" inputMode="numeric" pattern="\d{10}" defaultValue={co.taxNumber ?? ""} /></Field>
            <Field label="Vergi dairesi"><Input name="taxOffice" maxLength={100} defaultValue={co.taxOffice ?? ""} /></Field>
            <Field label="IBAN" className="sm:col-span-2"><Input name="iban" placeholder="TR.." defaultValue={co.iban ?? ""} /></Field>
            <Field label="Kurumsal e-posta"><Input name="email" type="email" placeholder="info@proguzellik.com" defaultValue={co.email ?? ""} /></Field>
            <Field label="Telefon"><Input name="phone" type="tel" maxLength={30} defaultValue={co.phone ?? ""} /></Field>
            <Field label="Web sitesi"><Input name="website" maxLength={200} defaultValue={co.website ?? ""} /></Field>
            <Field label="Ödeme vadesi (gün)"><Input name="paymentTermDays" type="number" min={0} max={365} defaultValue={co.paymentTermDays} /></Field>
            <Field label="KDV oranı (%)" hint="Mali müşavirinizle teyit ederek girin; varsayılan oran yoktur."><Input name="vatRate" type="number" min={0} max={100} step="0.01" defaultValue={co.vatRate ?? ""} /></Field>
            <Field label="Paket fiyatları">
              <Select name="pricesIncludeVat" defaultValue={co.pricesIncludeVat === null ? "" : co.pricesIncludeVat ? "1" : "0"}>
                <option value="">Belirtilmedi</option>
                <option value="1">KDV dahil</option>
                <option value="0">KDV hariç</option>
              </Select>
            </Field>
            <Field label="Fatura notu" className="sm:col-span-2"><Textarea name="invoiceNote" rows={2} maxLength={500} defaultValue={co.invoiceNote ?? ""} /></Field>
            <div className="sm:col-span-2"><Button>Kaydet</Button></div>
          </form>
        </CardBody>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="E-posta (SMTP)" />
          <CardBody className="space-y-2 text-sm">
            {c.data.email.smtpConfigured ? <Alert tone="green">SMTP yapılandırıldı. Gönderen: {c.data.email.from}</Alert> : <Alert tone="amber">SMTP yapılandırılmadı. Canlı ortamda davet, doğrulama ve sıfırlama e-postaları gönderilmez.</Alert>}
            <p className="text-neutral-600">SMTP bilgileri güvenlik için yalnızca sunucu ortam değişkenlerinden (<code>EMAIL_MODE=smtp</code>, <code>SMTP_URL</code>, <code>EMAIL_FROM</code>) okunur; bu panelde saklanmaz ve gösterilmez.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="e-Fatura / e-Arşiv" />
          <CardBody className="space-y-2 text-sm">
            {c.data.einvoice.configured ? <Alert tone="green">Entegratör: {c.data.einvoice.provider}</Alert> : <Alert tone="amber">Yetkili entegratör bağlı değil. Resmî fatura kesilmez; taslak ve kayıt işlevleri çalışır.</Alert>}
            <p className="text-neutral-600">Entegrasyon için seçtiğiniz GİB özel entegratörünün API bilgileri gerekir.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
