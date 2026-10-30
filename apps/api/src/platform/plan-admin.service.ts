import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PlanPrice, PlanPriceRenewalPolicy, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { planCodeSchema } from "../billing/plans";
import { priceForNewSale, upcomingPrice } from "../billing/plan-pricing";
import { PrismaService } from "../prisma/prisma.service";

export interface PlanInput {
  name: string;
  description?: string | null;
  maxStaff: number;
  maxCustomers?: number | null;
  maxMonthlyAppointments?: number | null;
  features: string[];
  sortOrder: number;
  isActive: boolean;
  isPublic: boolean;
}

export interface PriceDraftInput {
  monthlyPrice: number;
  yearlyPrice: number;
  vatRate: number;
  effectiveFrom?: string;
  renewalPolicy: PlanPriceRenewalPolicy;
  renewalsFrom?: string;
  note?: string;
}

/** Fiyat sürümü görünümü (tutarlar metin, KDV hariç). */
const priceView = (v: PlanPrice & { _count?: { subscriptions: number } }, users: Map<string, string>) => ({
  id: v.id,
  version: v.version,
  status: v.status,
  monthlyPrice: v.monthlyPrice.toFixed(2),
  yearlyPrice: v.yearlyPrice.toFixed(2),
  vatRate: v.vatRate.toFixed(2),
  effectiveFrom: v.effectiveFrom,
  renewalPolicy: v.renewalPolicy,
  renewalsFrom: v.renewalsFrom,
  note: v.note,
  createdAt: v.createdAt,
  createdBy: v.createdById ? users.get(v.createdById) ?? null : null,
  approvedAt: v.approvedAt,
  approvedBy: v.approvedById ? users.get(v.approvedById) ?? null : null,
  cancelledAt: v.cancelledAt,
  cancelledBy: v.cancelledById ? users.get(v.cancelledById) ?? null : null,
  cancelReason: v.cancelReason,
  lockedSubscriptions: v._count?.subscriptions ?? 0,
});

/**
 * SaaS sahibinin paket ve fiyat yönetimi.
 * Fiyat değişikliği her zaman yeni bir sürümdür: taslak → (parola + 2FA ile) onay. Onaylı sürüm değiştirilemez.
 */
@Injectable()
export class PlanAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  private async findPlan(code: string) {
    const parsed = planCodeSchema.safeParse(code);
    const plan = parsed.success ? await this.db.plan.findUnique({ where: { code: parsed.data } }) : null;
    if (!plan) throw new NotFoundException("Paket bulunamadı");
    return plan;
  }

  private async userNames(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const users = list.length ? await this.db.user.findMany({ where: { id: { in: list } }, select: { id: true, email: true } }) : [];
    return new Map(users.map((u) => [u.id, u.email]));
  }

  /** Paket listesi: güncel ve planlanan onaylı fiyat, taslak sayısı, kullanım. Eski fiyat sütunları dönmez. */
  async list(now = new Date()) {
    const plans = await this.db.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { tenants: true } } } });
    const versions = await this.db.planPrice.findMany({ where: { status: { in: ["APPROVED", "DRAFT"] } }, orderBy: { createdAt: "desc" } });
    return plans.map(({ monthlyPrice: _m, yearlyPrice: _y, _count, ...p }) => {
      const mine = versions.filter((v) => v.planCode === p.code);
      const current = priceForNewSale(mine, now);
      const upcoming = upcomingPrice(mine, now);
      const short = (v: PlanPrice | null) => v && { id: v.id, version: v.version, monthlyPrice: v.monthlyPrice.toFixed(2), yearlyPrice: v.yearlyPrice.toFixed(2), vatRate: v.vatRate.toFixed(2), effectiveFrom: v.effectiveFrom, renewalPolicy: v.renewalPolicy, renewalsFrom: v.renewalsFrom };
      return { ...p, tenantCount: _count.tenants, currentPrice: short(current), upcomingPrice: short(upcoming), draftCount: mine.filter((v) => v.status === "DRAFT").length };
    });
  }

  async create(actorId: string, b: PlanInput & { code: string }) {
    try {
      // Eski fiyat sütunları zorunlu olduğu için 0 yazılır; fiyat yalnız onaylı sürümden okunur.
      const plan = await this.db.plan.create({ data: { ...b, monthlyPrice: 0, yearlyPrice: 0 } });
      await this.audit.logPlatform({ actorId, action: "platform.plan_created", entity: "Plan", metadata: JSON.parse(JSON.stringify(b)) });
      return plan;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu kodla bir paket zaten var");
      throw e;
    }
  }

  async update(actorId: string, code: string, b: Partial<PlanInput>) {
    const before = await this.findPlan(code);
    if (b.maxStaff !== undefined && b.maxStaff < before.maxStaff) {
      // Sınır düşürülürken mevcut işletmelerden hiçbiri yeni sınırı aşmamalı.
      const over = await this.db.$queryRaw<{ name: string; n: bigint }[]>`
        SELECT t.name, count(s.id) AS n FROM "Tenant" t JOIN "StaffMember" s ON s."tenantId" = t.id AND s."isActive"
        WHERE t."planCode" = ${before.code} AND t.status <> 'CANCELLED' GROUP BY t.id, t.name HAVING count(s.id) > ${b.maxStaff} LIMIT 3`;
      if (over.length) throw new ConflictException(`Personel sınırı düşürülemez; aşan işletmeler: ${over.map((o) => `${o.name} (${o.n})`).join(", ")}`);
    }
    if (b.maxCustomers != null && (before.maxCustomers == null || b.maxCustomers < before.maxCustomers)) {
      const over = await this.db.$queryRaw<{ name: string; n: bigint }[]>`
        SELECT t.name, count(c.id) AS n FROM "Tenant" t JOIN "Customer" c ON c."tenantId" = t.id AND c."anonymizedAt" IS NULL
        WHERE t."planCode" = ${before.code} AND t.status <> 'CANCELLED' GROUP BY t.id, t.name HAVING count(c.id) > ${b.maxCustomers} LIMIT 3`;
      if (over.length) throw new ConflictException(`Müşteri sınırı düşürülemez; aşan işletmeler: ${over.map((o) => `${o.name} (${o.n})`).join(", ")}`);
    }
    const plan = await this.db.plan.update({ where: { code: before.code }, data: b });
    const changes = Object.fromEntries(Object.keys(b).map((k) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: (b as Record<string, unknown>)[k] ?? null }]));
    await this.audit.logPlatform({ actorId, action: "platform.plan_updated", entity: "Plan", metadata: JSON.parse(JSON.stringify({ code: before.code, changes })) });
    const { monthlyPrice: _m, yearlyPrice: _y, ...rest } = plan;
    return rest;
  }

  /** Fiyat geçmişi: tüm sürümler (taslak, onaylı, iptal), en yeni önce. */
  async prices(code: string) {
    const plan = await this.findPlan(code);
    const rows = await this.db.planPrice.findMany({
      where: { planCode: plan.code },
      orderBy: [{ createdAt: "desc" }],
      include: { _count: { select: { subscriptions: true } } },
    });
    const users = await this.userNames(rows.flatMap((r) => [r.createdById, r.approvedById, r.cancelledById]));
    const now = new Date();
    const current = priceForNewSale(rows, now);
    return { plan: { code: plan.code, name: plan.name }, currentId: current?.id ?? null, items: rows.map((r) => priceView(r, users)) };
  }

  /** Yeni fiyat taslağı. Taslak hiçbir yerde fiyat olarak kullanılmaz; onay gerekir. */
  async createDraft(actorId: string, code: string, b: PriceDraftInput) {
    const plan = await this.findPlan(code);
    validatePrice(b);
    const effectiveFrom = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    const renewalsFrom = b.renewalPolicy === "APPLY_ON_RENEWAL" ? new Date(b.renewalsFrom ?? effectiveFrom) : null;
    if (renewalsFrom && renewalsFrom < effectiveFrom) throw new BadRequestException("Mevcut aboneliklere uygulama tarihi, yeni satış başlangıcından önce olamaz");
    const v = await this.db.planPrice.create({
      data: { planCode: plan.code, monthlyPrice: b.monthlyPrice, yearlyPrice: b.yearlyPrice, vatRate: b.vatRate, effectiveFrom, renewalPolicy: b.renewalPolicy, renewalsFrom, note: b.note || null, createdById: actorId },
    });
    await this.audit.logPlatform({ actorId, action: "platform.plan_price_drafted", entity: "PlanPrice", entityId: v.id, metadata: { plan: plan.code, monthly: v.monthlyPrice.toFixed(2), yearly: v.yearlyPrice.toFixed(2), vatRate: v.vatRate.toFixed(2), effectiveFrom: effectiveFrom.toISOString(), renewalPolicy: v.renewalPolicy, renewalsFrom: renewalsFrom?.toISOString() ?? null } });
    return priceView(v, await this.userNames([actorId]));
  }

  /**
   * Owner onayı (parola + 2FA). Geçmişe dönük uygulama yoktur: yürürlük tarihleri onay anından önceyse onay anına çekilir.
   * Daha önce onaylanıp bu sürümle aynı anda ya da sonra yürürlüğe girecek sürümler artık hiç uygulanamayacağı için iptal edilir
   * (aynı anda yürürlükteki sürümler arasında en son onaylanan geçerlidir).
   */
  async approve(actorId: string, code: string, id: string, input: { password: string; code: string }, ip?: string) {
    const plan = await this.findPlan(code);
    const draft = await this.db.planPrice.findFirst({ where: { id, planCode: plan.code } });
    if (!draft) throw new NotFoundException("Fiyat sürümü bulunamadı");
    if (draft.status !== "DRAFT") throw new ConflictException("Yalnız taslak fiyat onaylanabilir");
    await this.auth.reauthenticate(actorId, input.password, input.code, ip);
    const now = new Date();
    const effectiveFrom = draft.effectiveFrom < now ? now : draft.effectiveFrom;
    const renewalsFrom = draft.renewalsFrom ? (draft.renewalsFrom < effectiveFrom ? effectiveFrom : draft.renewalsFrom) : null;
    const result = await this.db.$transaction(async (tx) => {
      // Aynı paketin onaylarını sıraya sokar (eşzamanlı iki onayda sürüm numarası çakışmaz).
      await tx.$queryRaw`SELECT 1 FROM "Plan" WHERE code = ${plan.code} FOR UPDATE`;
      const superseded = await tx.planPrice.findMany({ where: { planCode: plan.code, status: "APPROVED", effectiveFrom: { gt: now, gte: effectiveFrom } }, select: { id: true, version: true } });
      for (const s of superseded) {
        await tx.planPrice.update({ where: { id: s.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: "Daha sonra onaylanan fiyat sürümüyle değiştirildi" } });
      }
      const last = await tx.planPrice.aggregate({ where: { planCode: plan.code }, _max: { version: true } });
      const updated = await tx.planPrice.updateMany({
        where: { id: draft.id, status: "DRAFT" },
        data: { status: "APPROVED", version: (last._max.version ?? 0) + 1, approvedAt: now, approvedById: actorId, effectiveFrom, renewalsFrom },
      });
      if (updated.count !== 1) throw new ConflictException("Fiyat sürümü bu arada değişti; sayfayı yenileyin");
      return { superseded };
    });
    const v = await this.db.planPrice.findUniqueOrThrow({ where: { id: draft.id } });
    await this.audit.logPlatform({
      actorId, ip, action: "platform.plan_price_approved", entity: "PlanPrice", entityId: v.id,
      metadata: { plan: plan.code, version: v.version, monthly: v.monthlyPrice.toFixed(2), yearly: v.yearlyPrice.toFixed(2), vatRate: v.vatRate.toFixed(2), effectiveFrom: effectiveFrom.toISOString(), renewalPolicy: v.renewalPolicy, renewalsFrom: renewalsFrom?.toISOString() ?? null, superseded: result.superseded.map((s) => s.version) },
    });
    return priceView(v, await this.userNames([v.createdById, v.approvedById]));
  }

  /** Taslağı ya da henüz yürürlüğe girmemiş, aboneliğe bağlanmamış onaylı sürümü iptal eder. */
  async cancel(actorId: string, code: string, id: string, reason: string) {
    const plan = await this.findPlan(code);
    const v = await this.db.planPrice.findFirst({ where: { id, planCode: plan.code }, include: { _count: { select: { subscriptions: true } } } });
    if (!v) throw new NotFoundException("Fiyat sürümü bulunamadı");
    if (v.status === "CANCELLED") throw new ConflictException("Fiyat sürümü zaten iptal edilmiş");
    if (v.status === "APPROVED") {
      if (v.effectiveFrom <= new Date()) throw new ConflictException("Yürürlüğe girmiş fiyat iptal edilemez; yeni bir fiyat sürümü oluşturun");
      if (v._count.subscriptions > 0) throw new ConflictException("Aboneliğe bağlanmış fiyat iptal edilemez");
    }
    const now = new Date();
    await this.db.planPrice.update({ where: { id: v.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: reason } });
    await this.audit.logPlatform({ actorId, action: "platform.plan_price_cancelled", entity: "PlanPrice", entityId: v.id, metadata: { plan: plan.code, previousStatus: v.status, version: v.version, reason } });
    return { cancelled: true };
  }
}

function validatePrice(b: PriceDraftInput) {
  if (!(b.monthlyPrice > 0)) throw new BadRequestException("Aylık fiyat 0'dan büyük olmalı");
  if (b.yearlyPrice > 0 && b.monthlyPrice > 0 && b.yearlyPrice > b.monthlyPrice * 12) throw new ConflictException("Yıllık fiyat, aylık fiyatın 12 katından fazla olamaz");
}
