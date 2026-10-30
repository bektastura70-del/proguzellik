import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, PlatformAdmin } from "../../common/decorators";
import { ZodPipe } from "../../common/zod.pipe";
import { inviteDeliveryEnabled, loadEnv } from "../../config/env";
import { PlatformFinanceService, toCsv } from "./finance.service";
import { PlatformInvoiceService } from "./invoice.service";

const opt = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const companySchema = z.object({
  legalName: opt(200),
  address: opt(500),
  taxNumber: z.string().trim().regex(/^(\d{10})?$/, "VKN 10 haneli olmalı").transform((v) => v || null).nullable().optional(),
  taxOffice: opt(100),
  iban: z.string().trim().toUpperCase().transform((v) => v.replace(/\s+/g, "")).refine((v) => v === "" || /^TR\d{24}$/.test(v), "IBAN TR ile başlayan 26 karakter olmalı").transform((v) => v || null).nullable().optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Geçerli e-posta girin").max(200)]).transform((v) => v || null).nullable().optional(),
  phone: opt(30),
  website: opt(200),
  vatRate: z.number().min(0).max(100).multipleOf(0.01).nullable().optional(),
  pricesIncludeVat: z.boolean().nullable().optional(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  invoiceNote: opt(500),
});
const billingSchema = z.object({
  legalName: z.string().trim().min(2, "Unvan girin").max(200),
  taxNumber: z.string().trim().regex(/^(\d{10}|\d{11})?$/, "VKN 10 ya da TCKN 11 haneli olmalı").transform((v) => v || null).nullable().optional(),
  taxOffice: opt(100),
  address: opt(500),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).transform((v) => v || null).nullable().optional(),
});
const iso = z.string().datetime({ offset: true });
const entrySchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum(["ACCRUAL", "ACCRUAL_CANCEL", "PAYMENT", "REFUND"]),
  amount: z.number().positive("Tutar sıfırdan büyük olmalı").max(10_000_000).multipleOf(0.01, "En fazla 2 ondalık"),
  description: z.string().trim().min(3, "Açıklama girin").max(300),
  occurredAt: iso.optional(),
  dueDate: iso.optional(),
  periodStart: iso.optional(),
  periodEnd: iso.optional(),
  subscriptionId: z.string().uuid().optional(),
  relatedEntryId: z.string().uuid().optional(),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "OTHER"]).optional(),
  reference: z.string().trim().max(100).optional(),
  requestId: z.string().uuid("Geçersiz istek kimliği"),
});
const reportSchema = z.object({ year: z.coerce.number().int().min(2020).max(2100), granularity: z.enum(["month", "year"]).default("month") });
const line = z.object({ description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(100_000).multipleOf(0.001), unitPrice: z.number().min(0).max(10_000_000).multipleOf(0.01) });
const draftSchema = z.object({ tenantId: z.string().uuid(), accrualId: z.string().uuid().optional(), lines: z.array(line).max(50).optional(), note: z.string().trim().max(500).optional() });
const draftUpdate = z.object({ lines: z.array(line).min(1).max(50), note: z.string().trim().max(500).nullable().optional() });
const recordSchema = z.object({ officialNumber: z.string().trim().regex(/^[A-Z0-9]{3}\d{13}$/, "Fatura numarası 16 karakter olmalı (ör. ABC2026000000001)"), issueDate: iso });
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe girin").max(300) });
const invoiceList = z.object({ tenantId: z.string().uuid().optional(), status: z.enum(["DRAFT", "RECORDED", "ISSUED", "CANCELLED"]).optional() });

const TYPE_TR: Record<string, string> = { ACCRUAL: "Tahakkuk", ACCRUAL_CANCEL: "Tahakkuk iptali", PAYMENT: "Tahsilat", REFUND: "İade" };
const METHOD_TR: Record<string, string> = { BANK_TRANSFER: "Havale/EFT", CARD: "Kart", CASH: "Nakit", OTHER: "Diğer" };
const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "");
const num = (v: string) => v.replace(".", ",");

/** SaaS sahibi muhasebesi. İşletmelerin kendi kasa/finans kayıtlarıyla karışmaz. */
@Controller("platform")
@PlatformAdmin()
export class PlatformFinanceController {
  constructor(
    private readonly finance: PlatformFinanceService,
    private readonly invoices: PlatformInvoiceService,
  ) {}

  @Get("company")
  async company() {
    const env = loadEnv();
    const smtpConfigured = env.EMAIL_MODE === "smtp" && !!env.SMTP_URL;
    return {
      company: await this.finance.company(),
      // SMTP kimlik bilgileri veritabanında tutulmaz ve dışarı verilmez; yalnızca durum gösterilir.
      email: { mode: env.EMAIL_MODE, smtpConfigured, from: env.EMAIL_FROM, deliveryEnabled: inviteDeliveryEnabled(env) },
      einvoice: this.invoices.einvoiceStatus,
    };
  }

  @Put("company")
  updateCompany(@CurrentUser() u: AuthUser, @Body(new ZodPipe(companySchema)) b: z.infer<typeof companySchema>, @Req() req: Request) {
    return this.finance.updateCompany(u.id, b, req.ip);
  }

  @Get("tenants/:id/billing-profile")
  billingProfile(@Param("id", ParseUUIDPipe) id: string) {
    return this.finance.billingProfile(id).then((p) => p ?? null);
  }

  @Put("tenants/:id/billing-profile")
  updateBillingProfile(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(billingSchema)) b: z.infer<typeof billingSchema>, @Req() req: Request) {
    return this.finance.updateBillingProfile(id, u.id, b, req.ip);
  }

  @Get("finance/accounts")
  accounts() {
    return this.finance.accounts();
  }

  @Get("finance/tenants/:id/ledger")
  ledger(@Param("id", ParseUUIDPipe) id: string) {
    return this.finance.ledger(id);
  }

  @Get("finance/tenants/:id/ledger.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async ledgerCsv(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const l = await this.finance.ledger(id);
    req.res!.setHeader("Content-Disposition", `attachment; filename="cari-${id.slice(0, 8)}.csv"`);
    return toCsv(
      ["Tarih", "Tür", "Açıklama", "Tutar", "Yöntem", "Referans", "Vade", "Durum", "Kalan", "Bakiye"],
      l.entries.map((e) => [day(e.occurredAt), TYPE_TR[e.type], e.description, num(e.amount), e.method ? METHOD_TR[e.method] : "", e.reference, day(e.dueDate), e.state ?? "", e.open ? num(e.open) : "", num(e.runningBalance)]),
    );
  }

  @Post("finance/entries")
  async addEntry(@CurrentUser() u: AuthUser, @Body(new ZodPipe(entrySchema)) b: z.infer<typeof entrySchema>, @Req() req: Request) {
    const r = await this.finance.addEntry(u.id, b, req.ip);
    req.res!.status(r.replayed ? 200 : 201);
    return { ...r.entry, amount: r.entry.amount.toFixed(2), replayed: r.replayed };
  }

  @Get("finance/report")
  report(@Query(new ZodPipe(reportSchema)) q: z.infer<typeof reportSchema>) {
    return this.finance.report(q.year, q.granularity);
  }

  @Get("finance/report.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async reportCsv(@Query(new ZodPipe(reportSchema)) q: z.infer<typeof reportSchema>, @Req() req: Request) {
    const r = await this.finance.report(q.year, q.granularity);
    req.res!.setHeader("Content-Disposition", `attachment; filename="gelir-raporu-${q.year}.csv"`);
    return toCsv(
      ["Dönem", "Tahakkuk", "Tahsilat", "İade", "Net tahsilat", "Online tahsilat", "Dönem sonu bekleyen", "Ücretsiz tanımlama (adet)"],
      [...r.rows.map((x) => [x.period, num(x.accrued), num(x.collected), num(x.refunded), num(x.netCollected), num(x.onlineCollected), num(x.pendingAtEnd), x.complimentaryGrants]),
        ["Toplam", num(r.totals.accrued), num(r.totals.collected), num(r.totals.refunded), num(r.totals.netCollected), num(r.totals.onlineCollected), num(r.totals.pending), r.totals.complimentaryGrants]],
    );
  }

  @Get("invoices")
  listInvoices(@Query(new ZodPipe(invoiceList)) q: z.infer<typeof invoiceList>) {
    return this.invoices.list(q);
  }

  @Get("invoices/:id")
  invoice(@Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post("invoices")
  createInvoice(@CurrentUser() u: AuthUser, @Body(new ZodPipe(draftSchema)) b: z.infer<typeof draftSchema>, @Req() req: Request) {
    return this.invoices.createDraft(u.id, b, req.ip);
  }

  @Patch("invoices/:id")
  updateInvoice(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(draftUpdate)) b: z.infer<typeof draftUpdate>, @Req() req: Request) {
    return this.invoices.updateDraft(id, u.id, b, req.ip);
  }

  @Post("invoices/:id/record")
  @HttpCode(200)
  recordInvoice(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(recordSchema)) b: z.infer<typeof recordSchema>, @Req() req: Request) {
    return this.invoices.record(id, u.id, b, req.ip);
  }

  @Post("invoices/:id/issue")
  @HttpCode(200)
  issueInvoice(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.invoices.issue(id, u.id, req.ip);
  }

  @Post("invoices/:id/cancel")
  @HttpCode(200)
  cancelInvoice(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @Req() req: Request) {
    return this.invoices.cancel(id, u.id, b.reason, req.ip);
  }
}
