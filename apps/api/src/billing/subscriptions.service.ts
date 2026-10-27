import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { BillingCycle, PlanCode, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { StaffLimitPolicy } from "../staff/staff.service";
import { PaymentProvider } from "./payment-provider";

const addPeriod = (d: Date, cycle: BillingCycle) => {
  const n = new Date(d);
  if (cycle === "MONTHLY") n.setUTCMonth(n.getUTCMonth() + 1);
  else n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentProvider,
    private readonly audit: AuditService,
  ) {}

  plans() {
    return this.prisma.platform.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  }

  async current(t: TenantInfo) {
    return this.prisma.withTenant(t, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, include: { plan: true } });
      const [activeStaff, subscription, payments] = await Promise.all([
        tx.staffMember.count({ where: { isActive: true } }),
        tx.subscription.findFirst({ orderBy: { createdAt: "desc" } }),
        tx.subscriptionPayment.findMany({ orderBy: { createdAt: "desc" }, take: 24 }),
      ]);
      const trialDaysLeft =
        tenant.status === "TRIAL" && tenant.trialEndsAt
          ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / 86_400_000))
          : null;
      return {
        status: tenant.status,
        plan: tenant.plan,
        trialEndsAt: tenant.trialEndsAt,
        trialDaysLeft,
        usage: { activeStaff, maxStaff: tenant.plan.maxStaff },
        subscription,
        payments,
      };
    });
  }

  /** Paket satın alma/değiştirme (test sağlayıcısıyla). */
  async checkout(t: TenantInfo, b: { planCode: PlanCode; billingCycle: BillingCycle; paymentToken: string }) {
    const db = this.prisma.platform;
    const plan = await db.plan.findUnique({ where: { code: b.planCode } });
    if (!plan || !plan.isActive) throw new NotFoundException("Paket bulunamadı");
    const activeStaff = await db.staffMember.count({ where: { tenantId: t.tenantId, isActive: true } });
    if (activeStaff > plan.maxStaff) {
      throw new ConflictException(`${plan.name} paketi en fazla ${plan.maxStaff} aktif personel destekler (şu an ${activeStaff}).`);
    }
    const amount = b.billingCycle === "MONTHLY" ? plan.monthlyPrice : plan.yearlyPrice;
    const charge = await this.payments.charge({
      tenantId: t.tenantId,
      amount: amount.toFixed(2),
      currency: "TRY",
      description: `ProGüzellik ${plan.name} (${b.billingCycle === "MONTHLY" ? "aylık" : "yıllık"})`,
      paymentToken: b.paymentToken,
    });
    if (!charge.ok) {
      await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "subscription.payment_failed", metadata: { error: charge.error ?? null } });
      throw new HttpException(charge.error ?? "Ödeme başarısız", HttpStatus.PAYMENT_REQUIRED);
    }
    const now = new Date();
    const sub = await db.$transaction(async (tx) => {
      await tx.subscription.updateMany({ where: { tenantId: t.tenantId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      const sub = await tx.subscription.create({
        data: {
          tenantId: t.tenantId,
          planCode: plan.code,
          billingCycle: b.billingCycle,
          currentPeriodStart: now,
          currentPeriodEnd: addPeriod(now, b.billingCycle),
          provider: this.payments.name,
          providerRef: charge.providerRef,
        },
      });
      await tx.subscriptionPayment.create({
        data: { tenantId: t.tenantId, subscriptionId: sub.id, amount, status: "PAID", provider: this.payments.name, providerRef: charge.providerRef, description: `${plan.name} paketi` },
      });
      await tx.tenant.update({ where: { id: t.tenantId }, data: { status: "ACTIVE", planCode: plan.code } });
      await tx.auditLog.create({ data: { tenantId: t.tenantId, actorId: t.userId, action: "subscription.activated", metadata: { plan: plan.code, cycle: b.billingCycle } } });
      return sub;
    });
    return sub;
  }

  async cancel(t: TenantInfo) {
    const db = this.prisma.platform;
    const sub = await db.subscription.findFirst({ where: { tenantId: t.tenantId, status: "ACTIVE" } });
    if (!sub) throw new NotFoundException("Aktif abonelik yok");
    await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "subscription.cancel_requested" });
    return db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  }

  /**
   * Abonelik yaşam döngüsü (zamanlanmış görev):
   *  - süresi biten ve iptal istenen abonelik → CANCELLED, işletme CANCELLED
   *  - süresi biten diğerleri → PAST_DUE (yenileme ödemesi beklenir)
   */
  async runLifecycle(now = new Date()) {
    const db = this.prisma.platform;
    const expired = await db.subscription.findMany({ where: { status: "ACTIVE", currentPeriodEnd: { lt: now } } });
    for (const s of expired) {
      const status = s.cancelAtPeriodEnd ? "CANCELLED" : "PAST_DUE";
      await db.$transaction([
        db.subscription.update({ where: { id: s.id }, data: { status } }),
        db.tenant.update({ where: { id: s.tenantId }, data: { status } }),
      ]);
    }
    return { processed: expired.length };
  }
}

/** Aktif personel sayısını paket sınırına göre denetler. */
@Injectable()
export class PlanStaffLimit extends StaffLimitPolicy {
  async assertCanAddStaff(tx: Tx, tenantId: string) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
    const active = await tx.staffMember.count({ where: { isActive: true } });
    if (active >= tenant.plan.maxStaff) {
      throw new HttpException(
        `${tenant.plan.name} paketinde en fazla ${tenant.plan.maxStaff} aktif personel olabilir. Paketinizi yükseltin.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}

export const toMoney = (d: Prisma.Decimal) => d.toFixed(2);
