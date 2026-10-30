import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { BillingCycle, Prisma, Subscription, SubscriptionGrantAction, Tenant, TenantStatus } from "@prisma/client";
import { addPeriod } from "../billing/subscriptions.service";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { TenantAdminService } from "./tenant-admin.service";

const DAY = 86_400_000;
export const MANUAL_PROVIDER = "manual";

interface Common {
  note: string;
  /** İstemcinin her işlem için ürettiği UUID. Aynı kimlikle tekrar gelen istek işlemi ikinci kez uygulamaz. */
  requestId: string;
}
export interface ManualCreateInput extends Common {
  planCode: string;
  billingCycle: BillingCycle;
  durationDays?: number;
  complimentary: boolean;
  agreedAmount?: number;
}
export interface ManualRenewInput extends Common {
  durationDays?: number;
  complimentary: boolean;
  agreedAmount?: number;
}
export interface ManualExtendInput extends Common {
  days: number;
}
export interface ManualPlanInput extends Common {
  planCode: string;
}
export interface ManualCancelInput extends Common {
  mode: "immediate" | "period_end";
}

export interface ManualResult {
  subscription: Subscription;
  grant: Prisma.SubscriptionGrantGetPayload<object>;
  replayed: boolean;
}

/** Yeniden denenmesi gereken eşzamanlı aynı istek; dış katmanda önceki sonuç döndürülür. */
class Replay extends Error {}

/**
 * SaaS sahibinin manuel abonelik işlemleri (havale/sözleşme ile ya da ücretsiz verilen paketler).
 * - Gerçek tahsilat değildir: SubscriptionPayment'a hiçbir kayıt yazılmaz, işlemler SubscriptionGrant defterine eklenir.
 * - Her işlem denetim kaydına yazılır.
 * - Aynı işletmedeki işlemler kilitle sıraya girer; aynı requestId ile tekrar istek ikinci kez uygulanmaz.
 */
@Injectable()
export class ManualSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantAdmin: TenantAdminService,
    private readonly email: EmailService,
  ) {}

  /** Yeni/yenilenen dönem için işletme sahibine bilgi verir. Gönderilemezse işlem geri alınmaz; geçmişte FAILED/NOT_CONFIGURED görünür. */
  private async notifyStarted(r: ManualResult, actorId: string) {
    if (r.replayed) return r;
    const s = r.subscription;
    const [tenant, owner, plan] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true } }),
      this.db.membership.findFirst({ where: { tenantId: s.tenantId, role: "OWNER", isActive: true }, select: { user: { select: { email: true } } } }),
      this.db.plan.findUnique({ where: { code: s.planCode }, select: { name: true } }),
    ]);
    if (!tenant || !owner) return r;
    const until = s.currentPeriodEnd.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
    await this.email.send(
      owner.user.email,
      { name: "subscription_started", vars: { salon: tenant.name, plan: plan?.name ?? s.planCode, until, complimentary: s.isComplimentary, link: `${appUrl(loadEnv())}/panel/abonelik` } },
      { dedupeKey: `subscription-started:${r.grant.id}`, tenantId: s.tenantId, actorId },
    );
    return r;
  }

  private get db() {
    return this.prisma.platform;
  }

  /** Önceki aynı istek varsa onun sonucunu döner; istek kimliği başka işlem için kullanılmışsa reddeder. */
  private async previous(requestId: string, match: { tenantId?: string; subscriptionId?: string; action: SubscriptionGrantAction }): Promise<ManualResult | null> {
    const g = await this.db.subscriptionGrant.findUnique({ where: { requestId } });
    if (!g) return null;
    if (g.action !== match.action || (match.tenantId && g.tenantId !== match.tenantId) || (match.subscriptionId && g.subscriptionId !== match.subscriptionId)) {
      throw new ConflictException("Bu istek kimliği başka bir işlem için kullanılmış");
    }
    const subscription = await this.db.subscription.findUniqueOrThrow({ where: { id: g.subscriptionId } });
    return { subscription, grant: g, replayed: true };
  }

  private async run(
    requestId: string,
    match: { tenantId?: string; subscriptionId?: string; action: SubscriptionGrantAction },
    tenantId: string,
    fn: (tx: Tx) => Promise<Omit<ManualResult, "replayed">>,
  ): Promise<ManualResult> {
    const prev = await this.previous(requestId, match);
    if (prev) return prev;
    try {
      const r = await this.db.$transaction(async (tx) => {
        // Aynı işletmenin abonelik işlemlerini sıraya sokar (çift tıklama / eşzamanlı istek).
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"subscription:" + tenantId}))::text`;
        if (await tx.subscriptionGrant.findUnique({ where: { requestId }, select: { id: true } })) throw new Replay();
        return fn(tx);
      });
      return { ...r, replayed: false };
    } catch (e) {
      const dup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (e instanceof Replay || dup) {
        const again = await this.previous(requestId, match);
        if (again) return again;
      }
      throw e;
    }
  }

  /** Pasif işletmede durum değiştirilmez; yalnızca açılınca dönülecek durum güncellenir. */
  private async setTenantStatus(tx: Tx, tenant: Tenant, status: TenantStatus, extra: Prisma.TenantUpdateInput = {}) {
    const data: Prisma.TenantUpdateInput =
      tenant.status === "SUSPENDED" ? { suspendedFromStatus: status, ...extra } : { status, ...extra };
    await tx.tenant.update({ where: { id: tenant.id }, data });
  }

  private amountOf(i: { complimentary: boolean; agreedAmount?: number }) {
    return new Prisma.Decimal(i.complimentary ? 0 : (i.agreedAmount ?? 0));
  }

  private async log(tx: Tx, actorId: string, ip: string | undefined, action: string, sub: Subscription, metadata: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { tenantId: sub.tenantId, actorId, ip, action, entity: "Subscription", entityId: sub.id, metadata } });
  }

  private async loadManual(tx: Tx, subscriptionId: string, allowed: Subscription["status"][]) {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException("Abonelik bulunamadı");
    if (sub.source !== "MANUAL") throw new ConflictException("Ödeme sağlayıcısıyla alınan abonelik elle değiştirilemez; yalnızca iptal edilebilir");
    if (!allowed.includes(sub.status)) throw new ConflictException("Abonelik bu işlem için uygun durumda değil");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sub.tenantId } });
    return { sub, tenant };
  }

  private async tenantIdOf(subscriptionId: string) {
    const s = await this.db.subscription.findUnique({ where: { id: subscriptionId }, select: { tenantId: true } });
    if (!s) throw new NotFoundException("Abonelik bulunamadı");
    return s.tenantId;
  }

  /** Yeni manuel abonelik: işletmeyi aktif pakete geçirir. Açık (aktif/gecikmede) abonelik varsa reddedilir. */
  async create(tenantId: string, actorId: string, i: ManualCreateInput, ip?: string) {
    const exists = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException("İşletme bulunamadı");
    await this.tenantAdmin.assertPlanFits(tenantId, i.planCode);
    const res = await this.run(i.requestId, { tenantId, action: "CREATED" }, tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const open = await tx.subscription.findFirst({ where: { tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } } });
      if (open) {
        throw new ConflictException(
          open.source === "MANUAL"
            ? "İşletmenin açık bir manuel aboneliği var; süre uzatma veya yenileme kullanın"
            : "İşletmenin ödeme sağlayıcısıyla açık bir aboneliği var; önce onu iptal edin",
        );
      }
      const plan = await tx.plan.findUniqueOrThrow({ where: { code: i.planCode } });
      const start = new Date();
      const end = i.durationDays ? new Date(start.getTime() + i.durationDays * DAY) : addPeriod(start, i.billingCycle);
      const sub = await tx.subscription.create({
        data: {
          tenantId,
          planCode: plan.code,
          billingCycle: i.billingCycle,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          provider: MANUAL_PROVIDER,
          source: "MANUAL",
          isComplimentary: i.complimentary,
        },
      });
      const grant = await tx.subscriptionGrant.create({
        data: { tenantId, subscriptionId: sub.id, action: "CREATED", planCode: plan.code, periodStart: start, periodEnd: end, agreedAmount: this.amountOf(i), isComplimentary: i.complimentary, note: i.note, actorId, requestId: i.requestId },
      });
      await this.setTenantStatus(tx, tenant, "ACTIVE", { plan: { connect: { code: plan.code } }, pastDueSince: null });
      await this.log(tx, actorId, ip, "platform.subscription_manual_created", sub, { plan: plan.code, cycle: i.billingCycle, until: end.toISOString(), complimentary: i.complimentary, agreedAmount: grant.agreedAmount.toFixed(2), note: i.note });
      return { subscription: sub, grant };
    });
    return this.notifyStarted(res, actorId);
  }

  /** Süre uzatma: bitiş tarihine (geçmişse bugüne) gün ekler. */
  async extend(subscriptionId: string, actorId: string, i: ManualExtendInput, ip?: string) {
    const tenantId = await this.tenantIdOf(subscriptionId);
    return this.run(i.requestId, { subscriptionId, action: "EXTENDED" }, tenantId, async (tx) => {
      const { sub, tenant } = await this.loadManual(tx, subscriptionId, ["ACTIVE", "PAST_DUE"]);
      const base = new Date(Math.max(sub.currentPeriodEnd.getTime(), Date.now()));
      const end = new Date(base.getTime() + i.days * DAY);
      const updated = await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end, status: "ACTIVE" } });
      const grant = await tx.subscriptionGrant.create({
        data: { tenantId, subscriptionId: sub.id, action: "EXTENDED", planCode: sub.planCode, periodStart: sub.currentPeriodStart, periodEnd: end, previousPeriodEnd: sub.currentPeriodEnd, isComplimentary: true, note: i.note, actorId, requestId: i.requestId },
      });
      await this.setTenantStatus(tx, tenant, "ACTIVE", { pastDueSince: null });
      await this.log(tx, actorId, ip, "platform.subscription_manual_extended", sub, { days: i.days, from: sub.currentPeriodEnd.toISOString(), until: end.toISOString(), note: i.note });
      return { subscription: updated, grant };
    });
  }

  /** Yenileme: yeni dönem; süre bitmediyse dönem sonundan, bittiyse bugünden başlar. */
  async renew(subscriptionId: string, actorId: string, i: ManualRenewInput, ip?: string) {
    const tenantId = await this.tenantIdOf(subscriptionId);
    const res = await this.run(i.requestId, { subscriptionId, action: "RENEWED" }, tenantId, async (tx) => {
      const { sub, tenant } = await this.loadManual(tx, subscriptionId, ["ACTIVE", "PAST_DUE"]);
      const now = new Date();
      const start = sub.status === "ACTIVE" && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
      const end = i.durationDays ? new Date(start.getTime() + i.durationDays * DAY) : addPeriod(start, sub.billingCycle);
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodStart: start, currentPeriodEnd: end, status: "ACTIVE", cancelAtPeriodEnd: false, isComplimentary: i.complimentary },
      });
      const grant = await tx.subscriptionGrant.create({
        data: { tenantId, subscriptionId: sub.id, action: "RENEWED", planCode: sub.planCode, periodStart: start, periodEnd: end, previousPeriodEnd: sub.currentPeriodEnd, agreedAmount: this.amountOf(i), isComplimentary: i.complimentary, note: i.note, actorId, requestId: i.requestId },
      });
      await this.setTenantStatus(tx, tenant, "ACTIVE", { pastDueSince: null });
      await this.log(tx, actorId, ip, "platform.subscription_manual_renewed", sub, { from: start.toISOString(), until: end.toISOString(), complimentary: i.complimentary, agreedAmount: grant.agreedAmount.toFixed(2), note: i.note });
      return { subscription: updated, grant };
    });
    return this.notifyStarted(res, actorId);
  }

  /** Paket atama: manuel aboneliğin ve işletmenin paketini değiştirir (personel sınırı kontrolüyle). */
  async changePlan(subscriptionId: string, actorId: string, i: ManualPlanInput, ip?: string) {
    const tenantId = await this.tenantIdOf(subscriptionId);
    await this.tenantAdmin.assertPlanFits(tenantId, i.planCode);
    return this.run(i.requestId, { subscriptionId, action: "PLAN_CHANGED" }, tenantId, async (tx) => {
      const { sub, tenant } = await this.loadManual(tx, subscriptionId, ["ACTIVE", "PAST_DUE"]);
      if (sub.planCode === i.planCode) throw new ConflictException("Abonelik zaten bu pakette");
      const updated = await tx.subscription.update({ where: { id: sub.id }, data: { planCode: i.planCode } });
      const grant = await tx.subscriptionGrant.create({
        data: { tenantId, subscriptionId: sub.id, action: "PLAN_CHANGED", planCode: i.planCode, previousPlanCode: sub.planCode, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, isComplimentary: sub.isComplimentary, note: i.note, actorId, requestId: i.requestId },
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { planCode: i.planCode } });
      await this.log(tx, actorId, ip, "platform.subscription_manual_plan_changed", sub, { from: sub.planCode, to: i.planCode, note: i.note });
      return { subscription: updated, grant };
    });
  }

  /**
   * İptal: "period_end" dönem sonunda sona erdirir, "immediate" hemen kapatır (işletme CANCELLED olur).
   * Ödeme sağlayıcılı abonelikler de iptal edilebilir; para iadesi bu işlemle yapılmaz.
   */
  async cancel(subscriptionId: string, actorId: string, i: ManualCancelInput, ip?: string) {
    const tenantId = await this.tenantIdOf(subscriptionId);
    return this.run(i.requestId, { subscriptionId, action: "CANCELLED" }, tenantId, async (tx) => {
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      if (sub.status === "CANCELLED") throw new ConflictException("Abonelik zaten iptal edilmiş");
      if (i.mode === "period_end" && sub.cancelAtPeriodEnd) throw new ConflictException("Abonelik zaten dönem sonunda iptal edilecek");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const updated =
        i.mode === "immediate"
          ? await tx.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED" } })
          : await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
      if (i.mode === "immediate") await this.setTenantStatus(tx, tenant, "CANCELLED", { pastDueSince: null });
      const grant = await tx.subscriptionGrant.create({
        data: { tenantId, subscriptionId: sub.id, action: "CANCELLED", planCode: sub.planCode, periodStart: sub.currentPeriodStart, periodEnd: i.mode === "immediate" ? new Date() : sub.currentPeriodEnd, previousPeriodEnd: sub.currentPeriodEnd, isComplimentary: sub.isComplimentary, note: `${i.mode === "immediate" ? "Hemen" : "Dönem sonunda"}: ${i.note}`, actorId, requestId: i.requestId },
      });
      await this.log(tx, actorId, ip, "platform.subscription_cancelled", sub, { mode: i.mode, source: sub.source, note: i.note });
      return { subscription: updated, grant };
    });
  }
}
