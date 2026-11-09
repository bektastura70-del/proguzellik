import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, Prisma, TransactionType } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(t: TenantInfo, q: { from: string; to: string; type?: TransactionType; customerId?: string; staffId?: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const rows = await tx.financeTransaction.findMany({
        where: {
          occurredAt: { gte: new Date(q.from), lt: new Date(q.to) },
          ...(q.type ? { type: q.type } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.staffId ? { staffId: q.staffId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          staff: { select: { id: true, displayName: true } },
          productSale: { select: { id: true } },
        },
      });
      const incomeIds = rows.filter((r) => r.type === "INCOME").map((r) => r.id);
      const refunds = incomeIds.length
        ? await tx.financeTransaction.groupBy({ by: ["refundOfId"], where: { refundOfId: { in: incomeIds } }, _sum: { amount: true } })
        : [];
      return rows.map((r) => {
        const refunded = D(refunds.find((x) => x.refundOfId === r.id)?._sum.amount);
        return r.type === "INCOME" ? { ...r, refundedAmount: money(refunded), refundable: money(D(r.amount).minus(refunded)) } : r;
      });
    });
  }

  private async assertRefs(tx: Tx, b: { customerId?: string; appointmentId?: string; customerPackageId?: string; staffId?: string }) {
    if (b.customerId && !(await tx.customer.findUnique({ where: { id: b.customerId } }))) throw new NotFoundException("Müşteri bulunamadı");
    if (b.staffId && !(await tx.staffMember.findUnique({ where: { id: b.staffId } }))) throw new NotFoundException("Personel bulunamadı");
    if (b.appointmentId) {
      const a = await tx.appointment.findUnique({ where: { id: b.appointmentId } });
      if (!a || (b.customerId && a.customerId !== b.customerId)) throw new NotFoundException("Randevu bulunamadı");
    }
    if (b.customerPackageId) {
      const p = await tx.customerPackage.findUnique({ where: { id: b.customerPackageId } });
      if (!p || (b.customerId && p.customerId !== b.customerId)) throw new NotFoundException("Paket bulunamadı");
    }
  }

  /** Müşteriden tahsilat. Randevuya bağlıysa personel bilgisi primler için randevudan alınır. */
  collect(
    t: TenantInfo,
    b: { customerId: string; amount: number; method: PaymentMethod; appointmentId?: string; customerPackageId?: string; description?: string },
  ) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.assertRefs(tx, b);
      const appt = b.appointmentId ? await tx.appointment.findUnique({ where: { id: b.appointmentId } }) : null;
      const trx = await tx.financeTransaction.create({
        data: {
          tenantId: t.tenantId,
          type: "INCOME",
          category: b.customerPackageId ? "PAKET_SATISI" : "HIZMET",
          amount: b.amount,
          method: b.method,
          customerId: b.customerId,
          appointmentId: b.appointmentId,
          customerPackageId: b.customerPackageId,
          staffId: appt?.staffId,
          description: b.description,
          createdById: t.userId,
        },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "finance.collected", entity: "FinanceTransaction", entityId: trx.id });
      return trx;
    });
  }

  /** Serbest gelir veya gider kaydı (kira, malzeme, prim ödemesi vb.). */
  record(
    t: TenantInfo,
    b: { type: "INCOME" | "EXPENSE"; category: string; amount: number; method: PaymentMethod; staffId?: string; description?: string; occurredAt?: string },
  ) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.assertRefs(tx, b);
      const trx = await tx.financeTransaction.create({
        data: {
          tenantId: t.tenantId,
          ...b,
          occurredAt: b.occurredAt ? new Date(b.occurredAt) : undefined,
          createdById: t.userId,
        },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: `finance.${b.type.toLowerCase()}`, entity: "FinanceTransaction", entityId: trx.id });
      return trx;
    });
  }

  /** İade: yalnızca gelir kaydına, kalan iade edilebilir tutar kadar. */
  refund(t: TenantInfo, id: string, b: { amount: number; method?: PaymentMethod; reason: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      // Aynı gelir kaydına eşzamanlı iadeleri sıraya sokmak için işlem kilidi.
      // (Kayıtlarda UPDATE yetkisi olmadığından FOR UPDATE yerine advisory lock.)
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"refund:" + id}))::text`;
      const orig = await tx.financeTransaction.findUnique({ where: { id } });
      if (!orig) throw new NotFoundException("İşlem bulunamadı");
      if (orig.type !== "INCOME") throw new BadRequestException("Yalnızca gelir kayıtları iade edilebilir");
      // Ürün satış fişinin iadesi stokla birlikte yapılmalı (Stok > Satışlar).
      if (await tx.productSale.findFirst({ where: { financeTransactionId: id }, select: { id: true } })) {
        throw new ConflictException({ message: "Ürün satışlarının iadesi Stok > Satışlar ekranından yapılır", code: "USE_PRODUCT_RETURN" });
      }
      const prev = await tx.financeTransaction.aggregate({ where: { refundOfId: id }, _sum: { amount: true } });
      const remaining = D(orig.amount).minus(D(prev._sum.amount));
      if (D(b.amount).greaterThan(remaining)) {
        throw new ConflictException(`İade tutarı kalan tutarı (${money(remaining)} TL) aşamaz`);
      }
      const trx = await tx.financeTransaction.create({
        data: {
          tenantId: t.tenantId,
          type: "REFUND",
          category: "IADE",
          amount: b.amount,
          method: b.method ?? orig.method,
          customerId: orig.customerId,
          appointmentId: orig.appointmentId,
          customerPackageId: orig.customerPackageId,
          staffId: orig.staffId,
          refundOfId: orig.id,
          description: b.reason,
          createdById: t.userId,
        },
      });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "finance.refunded",
        entity: "FinanceTransaction",
        entityId: trx.id,
        metadata: { refundOf: id, amount: b.amount },
      });
      return trx;
    });
  }

  /** Kasa özeti: gelir, gider, iade, net ve ödeme yöntemine göre dağılım. */
  summary(t: TenantInfo, q: { from: string; to: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const rows = await tx.financeTransaction.groupBy({
        by: ["type", "method"],
        where: { occurredAt: { gte: new Date(q.from), lt: new Date(q.to) } },
        _sum: { amount: true },
        _count: true,
      });
      const tot = { INCOME: D(0), EXPENSE: D(0), REFUND: D(0) };
      const byMethod: Record<string, Prisma.Decimal> = {};
      for (const r of rows) {
        const amt = D(r._sum.amount);
        tot[r.type] = tot[r.type].plus(amt);
        const sign = r.type === "INCOME" ? 1 : -1;
        byMethod[r.method] = (byMethod[r.method] ?? D(0)).plus(amt.times(sign));
      }
      return {
        from: q.from,
        to: q.to,
        income: money(tot.INCOME),
        expense: money(tot.EXPENSE),
        refund: money(tot.REFUND),
        net: money(tot.INCOME.minus(tot.EXPENSE).minus(tot.REFUND)),
        byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, money(v)])),
      };
    });
  }

  /** Müşteri bakiyesi: tamamlanan ücretli randevular + paketler − (tahsilat − iade). */
  balance(t: TenantInfo, customerId: string) {
    return this.prisma.withTenant(t, (tx) => FinanceService.balanceInTx(tx, customerId));
  }

  static async balanceInTx(tx: Tx, customerId: string) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException("Müşteri bulunamadı");
    const [appts, pkgs, paid, refunded, products, productReturns] = await Promise.all([
      tx.appointment.aggregate({ where: { customerId, status: "COMPLETED", customerPackageId: null }, _sum: { price: true } }),
      tx.customerPackage.aggregate({ where: { customerId, status: { not: "CANCELLED" } }, _sum: { price: true } }),
      tx.financeTransaction.aggregate({ where: { customerId, type: "INCOME" }, _sum: { amount: true } }),
      tx.financeTransaction.aggregate({ where: { customerId, type: "REFUND" }, _sum: { amount: true } }),
      // Ürün satışları peşin tahsil edilir: borç olarak da sayılır ki bakiye alacaklı görünmesin.
      tx.productSale.aggregate({ where: { customerId }, _sum: { total: true } }),
      tx.productSaleReturn.aggregate({ where: { sale: { customerId } }, _sum: { amount: true } }),
    ]);
    const productNet = D(products._sum.total).minus(D(productReturns._sum.amount));
    const charges = D(appts._sum.price).plus(D(pkgs._sum.price)).plus(productNet);
    const payments = D(paid._sum.amount).minus(D(refunded._sum.amount));
    return { customerId, charges: money(charges), payments: money(payments), balance: money(charges.minus(payments)) };
  }

  /**
   * Personel primleri:
   * - Hizmet: dönemde tamamlanan randevuların değeri × prim oranı
   *   (paketli seanslar için seans değeri = paket fiyatı / seans sayısı).
   * - Ürün: dönemdeki ürün satışları (satan personel) − dönemdeki iadeleri × ürün prim oranı.
   * Ödenen primler "PRIM" kategorili gider kayıtlarından düşülür.
   */
  commissions(t: TenantInfo, q: { from: string; to: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const range = { gte: new Date(q.from), lt: new Date(q.to) };
      const staff = await tx.staffMember.findMany({ orderBy: { displayName: "asc" } });
      const appts = await tx.appointment.findMany({
        where: { status: "COMPLETED", startsAt: range },
        include: { customerPackage: { select: { price: true, totalSessions: true } } },
      });
      const [payouts, sales, returns] = await Promise.all([
        tx.financeTransaction.groupBy({
          by: ["staffId"],
          where: { type: "EXPENSE", category: "PRIM", occurredAt: range },
          _sum: { amount: true },
        }),
        tx.productSale.groupBy({ by: ["staffId"], where: { occurredAt: range, staffId: { not: null } }, _sum: { total: true }, _count: true }),
        tx.productSaleReturn.findMany({ where: { createdAt: range, sale: { staffId: { not: null } } }, select: { amount: true, sale: { select: { staffId: true } } } }),
      ]);
      return staff.map((s) => {
        const mine = appts.filter((a) => a.staffId === s.id);
        const revenue = mine.reduce((sum, a) => {
          const v = a.customerPackage ? D(a.customerPackage.price).div(a.customerPackage.totalSessions) : D(a.price);
          return sum.plus(v);
        }, D(0));
        const serviceEarned = revenue.times(D(s.commissionRate)).div(100);
        const sold = sales.find((x) => x.staffId === s.id);
        const returned = returns.filter((r) => r.sale.staffId === s.id).reduce((sum, r) => sum.plus(r.amount), D(0));
        const productRevenue = D(sold?._sum.total).minus(returned);
        const productEarned = productRevenue.times(D(s.productCommissionRate)).div(100);
        const earned = serviceEarned.plus(productEarned);
        const paid = D(payouts.find((p) => p.staffId === s.id)?._sum.amount);
        return {
          staffId: s.id,
          staffName: s.displayName,
          rate: D(s.commissionRate).toString(),
          appointments: mine.length,
          revenue: money(revenue),
          serviceEarned: money(serviceEarned),
          productRate: D(s.productCommissionRate).toString(),
          productSales: sold?._count ?? 0,
          productRevenue: money(productRevenue),
          productEarned: money(productEarned),
          earned: money(earned),
          paid: money(paid),
          due: money(earned.minus(paid)),
        };
      });
    });
  }
}
