import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantInfo } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Yönetim paneli özeti (tarih aralığı). */
  dashboard(t: TenantInfo, q: { from: string; to: string }) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    return this.prisma.withTenant(t, async (tx) => {
      const [byStatus, fin, newCustomers, totalCustomers, products, services, staff, completed] = await Promise.all([
        tx.appointment.groupBy({ by: ["status"], where: { startsAt: { gte: from, lt: to } }, _count: true }),
        tx.financeTransaction.groupBy({ by: ["type"], where: { occurredAt: { gte: from, lt: to } }, _sum: { amount: true } }),
        tx.customer.count({ where: { createdAt: { gte: from, lt: to }, anonymizedAt: null } }),
        tx.customer.count({ where: { anonymizedAt: null } }),
        tx.product.findMany({ where: { isActive: true }, select: { id: true, name: true, stockQty: true, minQty: true, unit: true, costPrice: true } }),
        tx.service.findMany({ select: { id: true, name: true } }),
        tx.staffMember.findMany({ select: { id: true, displayName: true } }),
        tx.appointment.findMany({
          where: { status: "COMPLETED", startsAt: { gte: from, lt: to } },
          select: { serviceId: true, staffId: true, price: true, customerPackageId: true, customerPackage: { select: { price: true, totalSessions: true } } },
        }),
      ]);
      const sum = (type: string) => D(fin.find((f) => f.type === type)?._sum.amount);
      const value = (a: (typeof completed)[number]) =>
        a.customerPackage ? D(a.customerPackage.price).div(a.customerPackage.totalSessions) : D(a.price);

      const group = (key: "serviceId" | "staffId", names: { id: string; name: string }[]) =>
        names
          .map((n) => {
            const rows = completed.filter((a) => a[key] === n.id);
            return { id: n.id, name: n.name, count: rows.length, revenue: money(rows.reduce((s, a) => s.plus(value(a)), D(0))) };
          })
          .filter((r) => r.count > 0)
          .sort((x, y) => y.count - x.count || Number(y.revenue) - Number(x.revenue));

      const status = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
      const total = byStatus.reduce((s, r) => s + r._count, 0);
      const low = products.filter((p) => D(p.stockQty).lessThanOrEqualTo(p.minQty));
      return {
        range: { from: q.from, to: q.to },
        appointments: {
          total,
          byStatus: status,
          completionRate: total ? Math.round(((status.COMPLETED ?? 0) / total) * 100) : 0,
          noShowRate: total ? Math.round(((status.NO_SHOW ?? 0) / total) * 100) : 0,
        },
        finance: {
          income: money(sum("INCOME")),
          expense: money(sum("EXPENSE")),
          refund: money(sum("REFUND")),
          net: money(sum("INCOME").minus(sum("EXPENSE")).minus(sum("REFUND"))),
          serviceValue: money(completed.reduce((s, a) => s.plus(value(a)), D(0))),
        },
        customers: { new: newCustomers, total: totalCustomers },
        topServices: group("serviceId", services).slice(0, 10),
        staffPerformance: group("staffId", staff.map((s) => ({ id: s.id, name: s.displayName }))),
        stock: {
          lowStock: low.map((p) => ({ id: p.id, name: p.name, stockQty: p.stockQty, minQty: p.minQty, unit: p.unit })),
          stockValue: money(products.reduce((s, p) => s.plus(D(p.stockQty).times(D(p.costPrice))), D(0))),
        },
      };
    });
  }

  /** Günlük net gelir serisi (işletmenin saat diliminde). */
  dailyRevenue(t: TenantInfo, q: { from: string; to: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { timezone: true } });
      const rows = await tx.$queryRaw<{ day: string; income: Prisma.Decimal; outflow: Prisma.Decimal }[]>`
        SELECT to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tenant.timezone}, 'YYYY-MM-DD') AS day,
               COALESCE(SUM(amount) FILTER (WHERE type = 'INCOME'), 0) AS income,
               COALESCE(SUM(amount) FILTER (WHERE type IN ('EXPENSE', 'REFUND')), 0) AS outflow
        FROM "FinanceTransaction"
        WHERE "occurredAt" >= ${new Date(q.from)} AND "occurredAt" < ${new Date(q.to)}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ day: r.day, income: money(D(r.income)), outflow: money(D(r.outflow)), net: money(D(r.income).minus(D(r.outflow))) }));
    });
  }
}
