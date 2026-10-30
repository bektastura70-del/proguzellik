"use client";

import { use, useState } from "react";
import { INVOICE_STATUS_TR } from "@/components/platform/finance-admin";
import { Alert, Badge, Button, Field, Input, Spinner, Textarea, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, isoDay, tl } from "@/lib/format";

type Party = { legalName?: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null; iban?: string | null; email?: string | null; phone?: string | null };
type Line = { id: string; description: string; quantity: string; unitPrice: string; netAmount: string; vatAmount: string; grossAmount: string };
type Invoice = {
  id: string; draftNo: string; officialNumber: string | null; status: string; issueDate: string | null; createdAt: string;
  seller: Party; buyer: Party; vatRate: string; pricesIncludeVat: boolean; netTotal: string; vatTotal: string; grossTotal: string; note: string | null;
  cancelReason: string | null; isFiscalDocument: boolean; lines: Line[]; tenant: { name: string };
};

function PartyBlock({ title, p }: { title: string; p: Party }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{title}</div>
      <div className="font-semibold">{p.legalName}</div>
      {p.address && <div className="whitespace-pre-line text-sm">{p.address}</div>}
      <div className="text-sm">{[p.taxOffice && `${p.taxOffice} V.D.`, p.taxNumber && `VKN/TCKN: ${p.taxNumber}`].filter(Boolean).join(" · ")}</div>
      {p.iban && <div className="text-sm">IBAN: {p.iban}</div>}
      {p.email && <div className="text-sm">{p.email}</div>}
    </div>
  );
}

/** Fatura görünümü ve işlemleri. Yazdır → "PDF olarak kaydet" ile PDF alınır. */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const inv = useApi<Invoice>(`/platform/invoices/${id}`);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"record" | "cancel" | "edit" | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try { await fn(); toast(ok); setMode(null); inv.reload(); } catch (e) { setErr((e as Error).message); }
  };
  if (inv.error) return <div className="mx-auto max-w-md p-10"><Alert>{inv.error.message}</Alert></div>;
  if (!inv.data) return <div className="p-10"><Spinner /></div>;
  const i = inv.data;
  const draft = i.status === "DRAFT";
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <Badge tone={INVOICE_STATUS_TR[i.status][1]}>{INVOICE_STATUS_TR[i.status][0]}</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => window.print()}>Yazdır / PDF</Button>
        {draft && <Button size="sm" variant="outline" onClick={() => setMode("edit")}>Kalemleri düzenle</Button>}
        {draft && <Button size="sm" onClick={() => act(() => api(`/platform/invoices/${i.id}/issue`, { method: "POST" }), "Fatura düzenlendi")}>e-Fatura/e-Arşiv olarak düzenle</Button>}
        {draft && <Button size="sm" variant="outline" onClick={() => setMode("record")}>Harici faturayı kaydet</Button>}
        {(draft || i.status === "RECORDED") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setMode("cancel")}>İptal et</Button>}
      </div>
      {err && <div className="mb-4 print:hidden"><Alert>{err}</Alert></div>}
      {mode === "record" && (
        <form className="mb-6 grid items-end gap-3 rounded-lg border border-sand-200 p-3 sm:grid-cols-3 print:hidden" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => api(`/platform/invoices/${i.id}/record`, { method: "POST", body: { officialNumber: String(f.get("officialNumber")).toUpperCase(), issueDate: new Date(`${f.get("issueDate")}T12:00:00+03:00`).toISOString() } }), "Fatura kaydedildi"); }}>
          <Field label="Resmî fatura numarası"><Input name="officialNumber" required pattern="[A-Za-z0-9]{3}\d{13}" placeholder="ABC2026000000001" /></Field>
          <Field label="Düzenleme tarihi"><Input name="issueDate" type="date" required defaultValue={isoDay()} /></Field>
          <Button>Kaydet</Button>
          <p className="text-xs text-neutral-500 sm:col-span-3">Yalnızca yetkili bir sistemde gerçekten kesilmiş faturanın numarasını girin. Bu işlem burada fatura kesmez.</p>
        </form>
      )}
      {mode === "cancel" && (
        <form className="mb-6 grid items-end gap-3 rounded-lg border border-red-200 p-3 sm:grid-cols-3 print:hidden" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => api(`/platform/invoices/${i.id}/cancel`, { method: "POST", body: { reason: f.get("reason") } }), "Fatura iptal edildi"); }}>
          <Field label="İptal gerekçesi" className="sm:col-span-2"><Input name="reason" required minLength={3} /></Field>
          <Button variant="danger">İptal et</Button>
        </form>
      )}
      {mode === "edit" && (
        <form
          className="mb-6 space-y-3 rounded-lg border border-sand-200 p-3 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            const lines = String(new FormData(e.currentTarget).get("lines")).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
              const [description, quantity, unitPrice] = l.split("|").map((x) => x.trim());
              return { description, quantity: Number(quantity.replace(",", ".")), unitPrice: Number(unitPrice.replace(",", ".")) };
            });
            void act(() => api(`/platform/invoices/${i.id}`, { method: "PATCH", body: { lines } }), "Taslak güncellendi");
          }}
        >
          <Field label="Kalemler (her satır: açıklama | miktar | birim fiyat)">
            <Textarea name="lines" rows={4} defaultValue={i.lines.map((l) => `${l.description} | ${Number(l.quantity)} | ${Number(l.unitPrice)}`).join("\n")} />
          </Field>
          <Button>Kaydet</Button>
        </form>
      )}

      <article className="rounded-xl border border-sand-200 bg-white p-8 print:border-0 print:p-0">
        {!i.isFiscalDocument && (
          <div className="mb-6 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-900">
            {i.status === "CANCELLED" ? `İPTAL EDİLDİ${i.cancelReason ? ` – ${i.cancelReason}` : ""}` : "TASLAK – Bu belge resmî fatura değildir, mali değeri yoktur."}
          </div>
        )}
        <header className="mb-8 flex flex-wrap justify-between gap-6">
          <PartyBlock title="Satıcı" p={i.seller} />
          <div className="text-right text-sm">
            <div className="text-lg font-semibold">{i.officialNumber ? "FATURA" : "FATURA TASLAĞI"}</div>
            <div>No: <span className="font-mono">{i.officialNumber ?? i.draftNo}</span></div>
            {i.officialNumber && <div className="text-xs text-neutral-500">Taslak: {i.draftNo}</div>}
            <div>Tarih: {dateTr(i.issueDate ?? i.createdAt)}</div>
          </div>
        </header>
        <div className="mb-8"><PartyBlock title="Alıcı" p={i.buyer} /></div>
        <table className="w-full text-sm">
          <thead className="border-b border-sand-200 text-left text-xs uppercase text-neutral-500">
            <tr><th className="py-2">Açıklama</th><th className="py-2 text-right">Miktar</th><th className="py-2 text-right">Birim fiyat</th><th className="py-2 text-right">Matrah</th><th className="py-2 text-right">KDV</th><th className="py-2 text-right">Toplam</th></tr>
          </thead>
          <tbody>
            {i.lines.map((l) => (
              <tr key={l.id} className="border-b border-sand-100">
                <td className="py-2">{l.description}</td><td className="py-2 text-right">{Number(l.quantity)}</td><td className="py-2 text-right">{tl(l.unitPrice)}</td>
                <td className="py-2 text-right">{tl(l.netAmount)}</td><td className="py-2 text-right">{tl(l.vatAmount)}</td><td className="py-2 text-right">{tl(l.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>Matrah</span><span>{tl(i.netTotal)}</span></div>
          <div className="flex justify-between"><span>KDV (%{Number(i.vatRate)})</span><span>{tl(i.vatTotal)}</span></div>
          <div className="flex justify-between border-t border-sand-200 pt-1 font-semibold"><span>Genel toplam</span><span>{tl(i.grossTotal)}</span></div>
          <div className="text-xs text-neutral-500">Birim fiyatlar KDV {i.pricesIncludeVat ? "dahil" : "hariç"}.</div>
        </div>
        {i.note && <p className="mt-8 whitespace-pre-line text-sm text-neutral-600">{i.note}</p>}
      </article>
    </div>
  );
}
