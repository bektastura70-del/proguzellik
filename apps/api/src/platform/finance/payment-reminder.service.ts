import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService, SendResult } from "../../email/email.service";
import { ZERO } from "./money";

const DAY = 86_400_000;
/** Vadesi geçen tahakkuk için otomatik hatırlatma aralığı (gün). */
export const OVERDUE_REMINDER_EVERY_DAYS = 7;

const trDate = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
const trMoney = (s: string) => Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * SaaS sahibi carisindeki açık tahakkuklar için ödeme hatırlatması.
 * Alıcı: işletmenin fatura e-postası, yoksa aktif işletme sahibi. Ödeme bilgisi şirket ayarlarından gelir.
 */
@Injectable()
export class PaymentReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  private async openAmount(entryId: string) {
    const deps = await this.db.platformLedgerEntry.groupBy({ by: ["type"], where: { relatedEntryId: entryId, type: { in: ["PAYMENT", "ACCRUAL_CANCEL"] } }, _sum: { amount: true } });
    return deps.reduce((s, d) => s.plus(d._sum.amount ?? ZERO), ZERO);
  }

  /** Tek tahakkuk için hatırlatma. dedupeKey verilirse aynı anahtarla ikinci kez gönderilmez. */
  async remind(entryId: string, opts: { actorId?: string; dedupeKey?: string } = {}): Promise<SendResult & { to?: string }> {
    const e = await this.db.platformLedgerEntry.findUnique({ where: { id: entryId }, include: { tenant: { select: { id: true, name: true, billingProfile: { select: { email: true } } } } } });
    if (!e) throw new NotFoundException("Kayıt bulunamadı");
    if (e.type !== "ACCRUAL") throw new ConflictException("Hatırlatma yalnızca tahakkuk için gönderilir");
    const open = e.amount.minus(await this.openAmount(e.id));
    if (open.lte(0)) throw new ConflictException("Bu tahakkukun açık tutarı yok");
    const owner = await this.db.membership.findFirst({ where: { tenantId: e.tenantId, role: "OWNER", isActive: true, user: { isActive: true } }, select: { user: { select: { email: true } } } });
    const to = e.tenant.billingProfile?.email ?? owner?.user.email;
    if (!to) throw new ConflictException("İşletmenin e-posta adresi yok");
    const c = await this.db.platformCompany.findUnique({ where: { id: 1 }, select: { legalName: true, iban: true } });
    const payTo = c?.legalName && c.iban ? `${c.legalName} · IBAN ${c.iban}` : undefined;
    const r = await this.email.send(
      to,
      { name: "payment_reminder", vars: { salon: e.tenant.name, description: e.description, amount: trMoney(open.toFixed(2)), dueDate: e.dueDate ? trDate(e.dueDate) : "belirtilmedi", payTo } },
      { dedupeKey: opts.dedupeKey, tenantId: e.tenantId, actorId: opts.actorId },
    );
    return { ...r, to };
  }

  /**
   * Fatura bildirimi: yalnızca resmî numarası olan (dış sistemde kesilip kaydedilmiş ya da entegratörle kesilmiş) faturalar.
   * Taslak "fatura" olarak bildirilmez.
   */
  async notifyInvoice(invoiceId: string, actorId: string): Promise<SendResult & { to?: string }> {
    const inv = await this.db.platformInvoice.findUnique({ where: { id: invoiceId }, include: { tenant: { select: { name: true, billingProfile: { select: { email: true } } } } } });
    if (!inv) throw new NotFoundException("Fatura bulunamadı");
    if (!(inv.status === "RECORDED" || inv.status === "ISSUED") || !inv.officialNumber) throw new ConflictException("Yalnızca resmî numarası kaydedilmiş fatura bildirilebilir; taslak fatura değildir");
    const buyerEmail = (inv.buyer as { email?: string | null } | null)?.email ?? null;
    const owner = await this.db.membership.findFirst({ where: { tenantId: inv.tenantId, role: "OWNER", isActive: true, user: { isActive: true } }, select: { user: { select: { email: true } } } });
    const to = buyerEmail ?? inv.tenant.billingProfile?.email ?? owner?.user.email;
    if (!to) throw new ConflictException("İşletmenin e-posta adresi yok");
    const r = await this.email.send(
      to,
      { name: "invoice_notice", vars: { salon: inv.tenant.name, number: inv.officialNumber, amount: trMoney(inv.grossTotal.toFixed(2)), date: trDate(inv.issueDate ?? inv.updatedAt) } },
      { tenantId: inv.tenantId, actorId },
    );
    return { ...r, to };
  }

  /** Günlük görev: vadesi geçmiş açık tahakkuklara her 7 günde bir hatırlatma. */
  async sendOverdue(now = new Date()) {
    const due = await this.db.platformLedgerEntry.findMany({ where: { type: "ACCRUAL", dueDate: { lt: now } }, select: { id: true, dueDate: true } });
    const out = { paymentReminders: 0, paymentReminderErrors: [] as string[] };
    for (const e of due) {
      try {
        const n = Math.floor((now.getTime() - e.dueDate!.getTime()) / (OVERDUE_REMINDER_EVERY_DAYS * DAY));
        const r = await this.remind(e.id, { dedupeKey: `payment-reminder:auto:${e.id}:${n}` });
        if ("sent" in r) out.paymentReminders++;
      } catch (err) {
        if (err instanceof ConflictException) continue; // ödenmiş/iptal ya da e-postası yok
        out.paymentReminderErrors.push(`${e.id}: ${(err as Error).message}`);
      }
    }
    return out;
  }
}
