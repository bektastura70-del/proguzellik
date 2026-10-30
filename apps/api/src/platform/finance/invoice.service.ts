import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EInvoiceProvider } from "./einvoice-provider";
import { PlatformFinanceService } from "./finance.service";
import { lineAmounts, ZERO } from "./money";

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

const include = { lines: { orderBy: { sortOrder: "asc" } }, tenant: { select: { id: true, name: true } } } satisfies Prisma.PlatformInvoiceInclude;

/**
 * Fatura taslakları ve kayıtları. Taslak mali belge değildir; resmî fatura yalnızca yetkili entegratörle
 * (EInvoiceProvider) düzenlenir ya da başka sistemde kesilen faturanın numarası elle kaydedilir.
 */
@Injectable()
export class PlatformInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: PlatformFinanceService,
    private readonly einvoice: EInvoiceProvider,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  get einvoiceStatus() {
    return { provider: this.einvoice.name, configured: this.einvoice.configured };
  }

  /** Taslak için eksik şirket/alıcı bilgileri (uydurulmaz, girilmesi istenir). */
  private async parties(tenantId: string) {
    const c = await this.finance.company();
    const missing: string[] = [];
    if (!c.legalName) missing.push("şirket unvanı");
    if (!c.taxNumber) missing.push("VKN");
    if (!c.taxOffice) missing.push("vergi dairesi");
    if (!c.address) missing.push("şirket adresi");
    if (c.vatRate === null || c.vatRate === undefined) missing.push("KDV oranı");
    if (c.pricesIncludeVat === null || c.pricesIncludeVat === undefined) missing.push("fiyatların KDV durumu");
    const b = await this.db.tenantBillingProfile.findUnique({ where: { tenantId } });
    if (!b) missing.push("işletmenin fatura bilgileri");
    if (missing.length) throw new UnprocessableEntityException({ message: `Fatura taslağı için eksik bilgi: ${missing.join(", ")}`, code: "INVOICE_SETTINGS_MISSING", missing });
    return {
      seller: { legalName: c.legalName, taxNumber: c.taxNumber, taxOffice: c.taxOffice, address: c.address, iban: c.iban, email: c.email, phone: c.phone },
      buyer: { legalName: b!.legalName, taxNumber: b!.taxNumber, taxOffice: b!.taxOffice, address: b!.address, email: b!.email },
      vatRate: c.vatRate!,
      pricesIncludeVat: c.pricesIncludeVat!,
      note: c.invoiceNote,
    };
  }

  private computeLines(lines: InvoiceLineInput[], vatRate: Prisma.Decimal, pricesIncludeVat: boolean) {
    let net = ZERO, vat = ZERO, gross = ZERO;
    const rows = lines.map((l, i) => {
      const a = lineAmounts(l.quantity, l.unitPrice, vatRate, pricesIncludeVat);
      net = net.plus(a.net); vat = vat.plus(a.vat); gross = gross.plus(a.gross);
      return { description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, netAmount: a.net, vatAmount: a.vat, grossAmount: a.gross, sortOrder: i };
    });
    return { rows, net, vat, gross };
  }

  list(q: { tenantId?: string; status?: "DRAFT" | "RECORDED" | "ISSUED" | "CANCELLED" }) {
    return this.db.platformInvoice.findMany({ where: { ...(q.tenantId ? { tenantId: q.tenantId } : {}), ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: "desc" }, take: 300, include: { tenant: { select: { id: true, name: true } } } });
  }

  async get(id: string) {
    const inv = await this.db.platformInvoice.findUnique({ where: { id }, include });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    return { ...inv, isFiscalDocument: inv.status === "ISSUED" || inv.status === "RECORDED" };
  }

  async createDraft(actorId: string, i: { tenantId: string; accrualId?: string; lines?: InvoiceLineInput[]; note?: string }, ip?: string) {
    if (!(await this.db.tenant.findUnique({ where: { id: i.tenantId }, select: { id: true } }))) throw new NotFoundException("İşletme bulunamadı");
    const p = await this.parties(i.tenantId);
    let lines = i.lines ?? [];
    if (i.accrualId) {
      const a = await this.db.platformLedgerEntry.findUnique({ where: { id: i.accrualId }, include: { invoice: { select: { id: true, status: true } } } });
      if (!a || a.tenantId !== i.tenantId || a.type !== "ACCRUAL") throw new NotFoundException("Tahakkuk bulunamadı");
      if (a.invoice && a.invoice.status !== "CANCELLED") throw new ConflictException("Bu tahakkuk için zaten fatura var");
      if (!lines.length) lines = [{ description: a.description, quantity: 1, unitPrice: Number(a.amount) }];
    }
    if (!lines.length) throw new UnprocessableEntityException("En az bir fatura kalemi girin");
    const c = this.computeLines(lines, p.vatRate, p.pricesIncludeVat);
    const year = new Date().getFullYear();
    return this.db.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('platform_invoice_draft_seq') AS n`;
      const inv = await tx.platformInvoice.create({
        data: {
          tenantId: i.tenantId, draftNo: `TASLAK-${year}-${String(n).padStart(6, "0")}`,
          seller: p.seller, buyer: p.buyer, vatRate: p.vatRate, pricesIncludeVat: p.pricesIncludeVat,
          netTotal: c.net, vatTotal: c.vat, grossTotal: c.gross, note: i.note ?? p.note ?? null,
          accrualId: i.accrualId ?? null, createdById: actorId,
          lines: { create: c.rows },
        },
        include,
      });
      await tx.auditLog.create({ data: { tenantId: i.tenantId, actorId, ip, action: "platform.invoice_draft_created", entity: "PlatformInvoice", entityId: inv.id, metadata: { draftNo: inv.draftNo, grossTotal: c.gross.toFixed(2) } } });
      return inv;
    });
  }

  async updateDraft(id: string, actorId: string, i: { lines: InvoiceLineInput[]; note?: string | null }, ip?: string) {
    const inv = await this.db.platformInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    if (inv.status !== "DRAFT") throw new ConflictException("Yalnızca taslak fatura düzenlenebilir");
    const c = this.computeLines(i.lines, inv.vatRate, inv.pricesIncludeVat);
    return this.db.$transaction(async (tx) => {
      await tx.platformInvoiceLine.deleteMany({ where: { invoiceId: id } });
      const r = await tx.platformInvoice.update({ where: { id }, data: { netTotal: c.net, vatTotal: c.vat, grossTotal: c.gross, ...(i.note !== undefined ? { note: i.note } : {}), lines: { create: c.rows } }, include });
      await tx.auditLog.create({ data: { tenantId: inv.tenantId, actorId, ip, action: "platform.invoice_draft_updated", entity: "PlatformInvoice", entityId: id, metadata: { grossTotal: c.gross.toFixed(2) } } });
      return r;
    });
  }

  /** Başka bir (yetkili) sistemde kesilmiş faturanın resmî numarasını kaydeder. Burada fatura kesilmez. */
  async record(id: string, actorId: string, i: { officialNumber: string; issueDate: string }, ip?: string) {
    const inv = await this.db.platformInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    if (inv.status !== "DRAFT") throw new ConflictException("Yalnızca taslak fatura kaydedilebilir");
    try {
      const r = await this.db.platformInvoice.update({ where: { id }, data: { status: "RECORDED", officialNumber: i.officialNumber, issueDate: new Date(i.issueDate), provider: "external" }, include });
      await this.db.auditLog.create({ data: { tenantId: inv.tenantId, actorId, ip, action: "platform.invoice_recorded", entity: "PlatformInvoice", entityId: id, metadata: { officialNumber: i.officialNumber } } });
      return r;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu fatura numarası zaten kayıtlı");
      throw e;
    }
  }

  /** Yetkili entegratörle resmî e-Fatura/e-Arşiv düzenler. Entegratör yoksa 503; asla kesildi denmez. */
  async issue(id: string, actorId: string, ip?: string) {
    const inv = await this.get(id);
    if (inv.status !== "DRAFT") throw new ConflictException("Yalnızca taslak fatura düzenlenebilir");
    const res = await this.einvoice.issue({
      invoiceId: inv.id, seller: inv.seller as Record<string, unknown>, buyer: inv.buyer as Record<string, unknown>,
      lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), netAmount: l.netAmount.toFixed(2), vatAmount: l.vatAmount.toFixed(2), grossAmount: l.grossAmount.toFixed(2) })),
      vatRate: inv.vatRate.toString(), netTotal: inv.netTotal.toFixed(2), vatTotal: inv.vatTotal.toFixed(2), grossTotal: inv.grossTotal.toFixed(2), currency: inv.currency,
    });
    if (!res.ok) {
      await this.db.auditLog.create({ data: { tenantId: inv.tenantId, actorId, ip, action: "platform.invoice_issue_blocked", entity: "PlatformInvoice", entityId: id, metadata: { code: res.code } } });
      throw new ServiceUnavailableException({ message: res.message, code: res.code });
    }
    const r = await this.db.platformInvoice.update({ where: { id }, data: { status: "ISSUED", officialNumber: res.officialNumber, providerRef: res.providerRef, provider: this.einvoice.name, issueDate: new Date() }, include });
    await this.db.auditLog.create({ data: { tenantId: inv.tenantId, actorId, ip, action: "platform.invoice_issued", entity: "PlatformInvoice", entityId: id, metadata: { officialNumber: res.officialNumber, provider: this.einvoice.name } } });
    return r;
  }

  async cancel(id: string, actorId: string, reason: string, ip?: string) {
    const inv = await this.db.platformInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    if (inv.status === "CANCELLED") throw new ConflictException("Fatura zaten iptal");
    if (inv.status === "ISSUED") throw new ConflictException("Entegratörle düzenlenmiş fatura yalnızca entegratör üzerinden iptal edilir");
    const r = await this.db.platformInvoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, accrualId: null }, include });
    await this.db.auditLog.create({ data: { tenantId: inv.tenantId, actorId, ip, action: "platform.invoice_cancelled", entity: "PlatformInvoice", entityId: id, metadata: { previousStatus: inv.status, reason } } });
    return r;
  }
}
