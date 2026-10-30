import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { BillingCycle, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { StaffLimitPolicy } from "../staff/staff.service";
import { PaymentProvider } from "./payment-provider";

/** Deneme bitişine kaç gün kala hatırlatma gönderilir (büyükten küçüğe). */
export const TRIAL_REMINDER_THRESHOLDS = [7, 3, 1] as const;
const DAY = 86_400_000;

export const addPeriod = (d: Date, cycle: BillingCycle) => {
  const n = new Date(d);
  if (cycle === "MONTHLY") n.setUTCMonth(n.getUTCMonth() + 1);
  else n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

export interface LifecycleResult {
  trialsEnded: number;
  trialReminders: number;
  renewed: number;
  renewalFailed: number;
  manualExpired: number;
  cancelledAtPeriodEnd: number;
  cancelledAfterGrace: number;
  limitExceeded: number;
  limitResolved: number;
  errors: string[];
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger("Subscriptions");

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentProvider,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  plans() {
    return this.prisma.platform.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  }

  async publicSite() {
    const c = await this.prisma.platform.platformCompany.findUnique({ where: { id: 1 }, select: { legalName: true, address: true, email: true, phone: true, vatRate: true, pricesIncludeVat: true } });
    return {
      company: { legalName: c?.legalName ?? null, address: c?.address ?? null, phone: c?.phone ?? null, email: c?.email ?? loadEnv().SUPPORT_EMAIL },
      // KDV bilgisi yalnızca şirket ayarlarında hem oran hem dahil/hariç seçildiyse gösterilir.
      vat: c?.vatRate != null && c.pricesIncludeVat != null ? { rate: c.vatRate.toString(), included: c.pricesIncludeVat } : null,
    };
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
        tenant.status === "TRIAL" && tenant.trialEndsAt ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / DAY)) : null;
      const env = loadEnv();
      const graceEndsAt = tenant.pastDueSince ? new Date(tenant.pastDueSince.getTime() + env.BILLING_GRACE_DAYS * DAY) : null;
      const [savedMethod, company] = await Promise.all([
        this.prisma.platform.savedPaymentMethod.findFirst({ where: { tenantId: t.tenantId }, select: { label: true, provider: true, createdAt: true } }),
        this.prisma.platform.platformCompany.findUnique({ where: { id: 1 }, select: { email: true, phone: true } }),
      ]);
      return {
        status: tenant.status,
        plan: tenant.plan,
        trialEndsAt: tenant.trialEndsAt,
        trialDaysLeft,
        graceEndsAt,
        limitExceeded: !!tenant.limitExceededAt,
        usage: { activeStaff, maxStaff: tenant.plan.maxStaff },
        subscription,
        savedMethod,
        payments,
        /** false: online ödeme kapalı (canlıda gerçek sağlayıcı yok); paket SaaS sahibi tarafından tanımlanır. */
        onlinePayment: this.payments.acceptsPayments,
        /** Abonelik için iletişim (online ödeme kapalıyken paket SaaS sahibince tanımlanır) */
        contact: { email: company?.email ?? env.SUPPORT_EMAIL, phone: company?.phone ?? null },
      };
    });
  }

  /** Paket satın alma/değiştirme (test sağlayıcısıyla). */
  async checkout(t: TenantInfo, b: { planCode: string; billingCycle: BillingCycle; paymentToken: string }) {
    // Gerçek, doğrulanmış tahsilat yapamayan sağlayıcıyla (canlıda test sağlayıcısı) abonelik asla açılmaz.
    if (!this.payments.acceptsPayments) {
      throw new ServiceUnavailableException({ message: "Online ödeme henüz aktif değil. Paket için bizimle iletişime geçin.", code: "ONLINE_PAYMENT_DISABLED" });
    }
    const db = this.prisma.platform;
    const user = await db.user.findUniqueOrThrow({ where: { id: t.userId } });
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ message: "Ödeme yapmadan önce e-posta adresinizi doğrulayın", code: "EMAIL_NOT_VERIFIED" });
    }
    const plan = await db.plan.findUnique({ where: { code: b.planCode } });
    if (!plan || !plan.isActive) throw new NotFoundException("Paket bulunamadı");
    const activeStaff = await db.staffMember.count({ where: { tenantId: t.tenantId, isActive: true } });
    if (activeStaff > plan.maxStaff) {
      throw new ConflictException(`${plan.name} paketi en fazla ${plan.maxStaff} aktif personel destekler (şu an ${activeStaff}).`);
    }
    const amount = b.billingCycle === "MONTHLY" ? plan.monthlyPrice : plan.yearlyPrice;
    const idempotencyKey = `checkout:${t.tenantId}:${randomUUID()}`;
    const charge = await this.payments.charge({
      tenantId: t.tenantId,
      amount: amount.toFixed(2),
      currency: "TRY",
      description: `ProGüzellik ${plan.name} (${b.billingCycle === "MONTHLY" ? "aylık" : "yıllık"})`,
      paymentToken: b.paymentToken,
      idempotencyKey,
    });
    if (!charge.ok || !this.payments.acceptsPayments) {
      await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "subscription.payment_failed", metadata: { error: charge.error ?? null } });
      throw new HttpException(charge.error ?? "Ödeme başarısız", HttpStatus.PAYMENT_REQUIRED);
    }
    const now = new Date();
    return db.$transaction(async (tx) => {
      await tx.subscription.updateMany({ where: { tenantId: t.tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } }, data: { status: "CANCELLED" } });
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
        data: { tenantId: t.tenantId, subscriptionId: sub.id, amount, status: "PAID", provider: this.payments.name, providerRef: charge.providerRef, description: `${plan.name} paketi`, idempotencyKey },
      });
      // Otomatik yenileme için yalnızca sağlayıcı belirteci saklanır.
      await tx.savedPaymentMethod.deleteMany({ where: { tenantId: t.tenantId } });
      await tx.savedPaymentMethod.create({ data: { tenantId: t.tenantId, provider: this.payments.name, token: b.paymentToken, label: `Test kartı (${b.paymentToken.slice(-4)})` } });
      await tx.tenant.update({ where: { id: t.tenantId }, data: { status: "ACTIVE", planCode: plan.code, pastDueSince: null, limitExceededAt: null } });
      await tx.auditLog.create({ data: { tenantId: t.tenantId, actorId: t.userId, action: "subscription.activated", metadata: { plan: plan.code, cycle: b.billingCycle } } });
      return sub;
    });
  }

  async cancel(t: TenantInfo) {
    const db = this.prisma.platform;
    const sub = await db.subscription.findFirst({ where: { tenantId: t.tenantId, status: "ACTIVE" } });
    if (!sub) throw new NotFoundException("Aktif abonelik yok");
    // Manuel abonelik SaaS sahibince yönetilir; iptali de onun defterinden yapılır.
    if (sub.source === "MANUAL") throw new ConflictException("Bu abonelik yönetici tarafından tanımlandı; iptal için bizimle iletişime geçin");
    await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "subscription.cancel_requested" });
    return db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  }

  private async ownerEmail(tenantId: string) {
    const m = await this.prisma.platform.membership.findFirst({ where: { tenantId, role: "OWNER", isActive: true }, include: { user: { select: { email: true } } } });
    return m?.user.email ?? null;
  }

  private async mail(tenantId: string, tpl: Parameters<EmailService["send"]>[1], dedupeKey: string) {
    const to = await this.ownerEmail(tenantId);
    if (to) await this.email.send(to, tpl, { dedupeKey, tenantId });
  }

  /**
   * Günlük abonelik yaşam döngüsü. Her adım koşullu güncellemeyle yapılır;
   * aynı gün tekrar çalıştırılsa da durumlar ve tahsilatlar tekrarlanmaz.
   */
  async runLifecycle(now = new Date()): Promise<LifecycleResult> {
    const db = this.prisma.platform;
    const env = loadEnv();
    const link = `${appUrl(env)}/panel/abonelik`;
    const r: LifecycleResult = { trialsEnded: 0, trialReminders: 0, renewed: 0, renewalFailed: 0, manualExpired: 0, cancelledAtPeriodEnd: 0, cancelledAfterGrace: 0, limitExceeded: 0, limitResolved: 0, errors: [] };
    const guard = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        const msg = `${label}: ${(e as Error).message}`;
        this.logger.error(msg);
        r.errors.push(msg);
      }
    };

    // 1) Deneme bitişine 7, 3 ve 1 gün kala hatırlatma (her eşik için bir kez; iş bir gün kaçırılırsa sıradaki eşikte gönderilir)
    const soon = await db.tenant.findMany({ where: { status: "TRIAL", trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_THRESHOLDS[0] * DAY) } } });
    for (const t of soon) {
      await guard(`trial-reminder ${t.id}`, async () => {
        const days = Math.max(1, Math.ceil((t.trialEndsAt!.getTime() - now.getTime()) / DAY));
        const threshold = [...TRIAL_REMINDER_THRESHOLDS].reverse().find((d) => days <= d)!;
        const to = await this.ownerEmail(t.id);
        if (!to) return;
        const res = await this.email.send(to, { name: "trial_ending", vars: { salon: t.name, days, link } }, { dedupeKey: `trial-reminder:${t.id}:${t.trialEndsAt!.toISOString()}:${threshold}`, tenantId: t.id });
        if (!("skipped" in res)) r.trialReminders++;
      });
    }

    // 2) Deneme süresi bitenler → ödeme bekliyor (salt okunur)
    const ended = await db.tenant.findMany({ where: { status: "TRIAL", trialEndsAt: { lte: now } } });
    for (const t of ended) {
      await guard(`trial-end ${t.id}`, async () => {
        const u = await db.tenant.updateMany({ where: { id: t.id, status: "TRIAL" }, data: { status: "PAST_DUE", pastDueSince: t.trialEndsAt } });
        if (u.count === 0) return;
        r.trialsEnded++;
        await this.audit.logPlatform({ tenantId: t.id, action: "lifecycle.trial_ended" });
        await this.mail(t.id, { name: "trial_ended", vars: { salon: t.name, link } }, `trial-ended:${t.id}:${t.trialEndsAt!.toISOString()}`);
      });
    }

    // 3) Dönemi biten aktif abonelikler: iptal ya da otomatik yenileme
    const due = await db.subscription.findMany({ where: { status: "ACTIVE", currentPeriodEnd: { lte: now } }, include: { plan: true, tenant: true } });
    for (const s of due) {
      await guard(`renewal ${s.id}`, async () => {
        if (s.cancelAtPeriodEnd) {
          const u = await db.subscription.updateMany({ where: { id: s.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
          if (u.count === 0) return;
          await db.tenant.update({ where: { id: s.tenantId }, data: { status: "CANCELLED", pastDueSince: null } });
          r.cancelledAtPeriodEnd++;
          await this.audit.logPlatform({ tenantId: s.tenantId, action: "lifecycle.cancelled_at_period_end" });
          await this.mail(s.tenantId, { name: "subscription_cancelled", vars: { salon: s.tenant.name, link } }, `cancelled:${s.id}`);
          return;
        }
        if (s.source === "MANUAL") {
          await this.expireManual(s, r, link);
          return;
        }
        await this.renew(s, now, r, link);
      });
    }

    // 4) Ödeme süresi (grace) dolanlar → iptal
    const graceLimit = new Date(now.getTime() - env.BILLING_GRACE_DAYS * DAY);
    const overdue = await db.tenant.findMany({ where: { status: "PAST_DUE", pastDueSince: { lte: graceLimit } } });
    for (const t of overdue) {
      await guard(`grace ${t.id}`, async () => {
        const u = await db.tenant.updateMany({ where: { id: t.id, status: "PAST_DUE" }, data: { status: "CANCELLED" } });
        if (u.count === 0) return;
        await db.subscription.updateMany({ where: { tenantId: t.id, status: { in: ["ACTIVE", "PAST_DUE"] } }, data: { status: "CANCELLED" } });
        r.cancelledAfterGrace++;
        await this.audit.logPlatform({ tenantId: t.id, action: "lifecycle.cancelled_after_grace" });
        await this.mail(t.id, { name: "subscription_cancelled", vars: { salon: t.name, link } }, `grace-cancelled:${t.id}:${t.pastDueSince!.toISOString()}`);
      });
    }

    // 5) Paket personel sınırı denetimi (ör. SaaS sahibi paketi düşürdüyse)
    const tenants = await db.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } }, include: { plan: true } });
    for (const t of tenants) {
      await guard(`limit ${t.id}`, async () => {
        const active = await db.staffMember.count({ where: { tenantId: t.id, isActive: true } });
        if (active > t.plan.maxStaff && !t.limitExceededAt) {
          const u = await db.tenant.updateMany({ where: { id: t.id, limitExceededAt: null }, data: { limitExceededAt: now } });
          if (u.count === 0) return;
          r.limitExceeded++;
          await this.audit.logPlatform({ tenantId: t.id, action: "lifecycle.plan_limit_exceeded", metadata: { active, max: t.plan.maxStaff } });
          await this.mail(t.id, { name: "plan_limit_exceeded", vars: { salon: t.name, active, max: t.plan.maxStaff, link } }, `limit:${t.id}:${now.toISOString().slice(0, 10)}`);
        } else if (active <= t.plan.maxStaff && t.limitExceededAt) {
          await db.tenant.update({ where: { id: t.id }, data: { limitExceededAt: null } });
          r.limitResolved++;
        }
      });
    }
    return r;
  }

  /** Manuel abonelik otomatik yenilenmez ve tahsilat denenmez: süresi dolunca ödeme bekliyor (grace) durumuna geçer. */
  private async expireManual(s: Prisma.SubscriptionGetPayload<{ include: { plan: true; tenant: true } }>, r: LifecycleResult, link: string) {
    const db = this.prisma.platform;
    const env = loadEnv();
    const u = await db.subscription.updateMany({ where: { id: s.id, status: "ACTIVE", currentPeriodEnd: s.currentPeriodEnd }, data: { status: "PAST_DUE" } });
    if (u.count === 0) return;
    await db.tenant.updateMany({ where: { id: s.tenantId, status: "ACTIVE" }, data: { status: "PAST_DUE", pastDueSince: s.currentPeriodEnd } });
    await db.tenant.updateMany({ where: { id: s.tenantId, status: "SUSPENDED" }, data: { suspendedFromStatus: "PAST_DUE", pastDueSince: s.currentPeriodEnd } });
    r.manualExpired++;
    await this.audit.logPlatform({ tenantId: s.tenantId, action: "lifecycle.manual_expired", entity: "Subscription", entityId: s.id });
    await this.mail(s.tenantId, { name: "subscription_expired", vars: { salon: s.tenant.name, graceDays: env.BILLING_GRACE_DAYS, link } }, `manual-expired:${s.id}:${s.currentPeriodEnd.toISOString()}`);
  }

  /** Yenileme: dönem sonuna bağlı idempotency anahtarıyla tek tahsilat. */
  private async renew(
    s: Prisma.SubscriptionGetPayload<{ include: { plan: true; tenant: true } }>,
    now: Date,
    r: LifecycleResult,
    link: string,
  ) {
    const db = this.prisma.platform;
    const env = loadEnv();
    const key = `renew:${s.id}:${s.currentPeriodEnd.toISOString()}`;
    const amount = s.billingCycle === "MONTHLY" ? s.plan.monthlyPrice : s.plan.yearlyPrice;
    const method = await db.savedPaymentMethod.findFirst({ where: { tenantId: s.tenantId } });
    const existing = await db.subscriptionPayment.findUnique({ where: { idempotencyKey: key } });
    let ok = existing?.status === "PAID";
    let providerRef = existing?.providerRef ?? undefined;
    let error: string | undefined;
    if (!existing) {
      if (!this.payments.acceptsPayments) {
        // Canlıda test sağlayıcısıyla/ödeme kapalıyken yenileme "ödendi" sayılmaz.
        error = "Online ödeme aktif değil";
      } else if (!method) {
        error = "Kayıtlı ödeme yöntemi yok";
      } else if (method.provider !== this.payments.name) {
        error = "Kayıtlı ödeme yöntemi bu sağlayıcıya ait değil";
      } else {
        try {
          const c = await this.payments.charge({ tenantId: s.tenantId, amount: amount.toFixed(2), currency: "TRY", description: `ProGüzellik ${s.plan.name} yenileme`, paymentToken: method.token, idempotencyKey: key });
          ok = c.ok;
          providerRef = c.providerRef;
          error = c.error;
        } catch (e) {
          // Sağlayıcıya ulaşılamadı: durum değiştirilmez, bir sonraki çalıştırmada aynı anahtarla tekrar denenir.
          throw new Error(`Ödeme sağlayıcısı hatası: ${(e as Error).message}`);
        }
      }
    }
    if (ok) {
      const nextEnd = addPeriod(s.currentPeriodEnd, s.billingCycle);
      await db.$transaction(async (tx) => {
        if (!existing) {
          await tx.subscriptionPayment.create({ data: { tenantId: s.tenantId, subscriptionId: s.id, amount, status: "PAID", provider: this.payments.name, providerRef, description: `${s.plan.name} yenileme`, idempotencyKey: key } });
        }
        await tx.subscription.update({ where: { id: s.id }, data: { currentPeriodStart: s.currentPeriodEnd, currentPeriodEnd: nextEnd } });
        await tx.tenant.update({ where: { id: s.tenantId }, data: { status: "ACTIVE", pastDueSince: null } });
      });
      r.renewed++;
      await this.audit.logPlatform({ tenantId: s.tenantId, action: "lifecycle.renewed", metadata: { until: nextEnd.toISOString() } });
      await this.mail(s.tenantId, { name: "subscription_renewed", vars: { salon: s.tenant.name, plan: s.plan.name, amount: amount.toFixed(2), until: nextEnd.toISOString().slice(0, 10) } }, `renewed:${key}`);
      return;
    }
    await db.$transaction(async (tx: Tx) => {
      if (!existing) {
        await tx.subscriptionPayment.create({ data: { tenantId: s.tenantId, subscriptionId: s.id, amount, status: "FAILED", provider: this.payments.name, description: error ?? "Ödeme alınamadı", idempotencyKey: key } });
      }
      await tx.subscription.update({ where: { id: s.id }, data: { status: "PAST_DUE" } });
      await tx.tenant.update({ where: { id: s.tenantId }, data: { status: "PAST_DUE", pastDueSince: s.currentPeriodEnd } });
    });
    r.renewalFailed++;
    await this.audit.logPlatform({ tenantId: s.tenantId, action: "lifecycle.renewal_failed", metadata: { error: error ?? null } });
    await this.mail(s.tenantId, { name: "payment_failed", vars: { salon: s.tenant.name, graceDays: env.BILLING_GRACE_DAYS, link } }, `payment-failed:${key}`);
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
