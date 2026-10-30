import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { RateLimitService } from "../auth/rate-limit.service";
import { PLAN_FEATURES, planCodeSchema, PLAN_CORE_FEATURES } from "../billing/plans";
import { SubscriptionsService } from "../billing/subscriptions.service";
import { JobsService } from "../jobs/jobs.service";
import { AuthUser, CurrentUser, PlatformAdmin } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { ManualSubscriptionService } from "./manual-subscription.service";
import { PlatformUsersService } from "./platform-users.service";
import { DEFAULT_TRIAL_DAYS, inviteSelect, TenantAdminService } from "./tenant-admin.service";

const planCode = planCodeSchema;
const createTenantSchema = z.object({
  name: z.string().trim().min(2, "İşletme adı en az 2 karakter olmalı").max(120),
  ownerName: z.string().trim().min(2, "Sahip adı en az 2 karakter olmalı").max(120),
  ownerEmail: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin").max(200),
  phone: z.string().trim().max(30).optional(),
  planCode: planCode.default("PROFESSIONAL"),
  trialDays: z.number().int().min(1, "Deneme süresi en az 1 gün").max(60, "Deneme süresi en fazla 60 gün").default(DEFAULT_TRIAL_DAYS),
});
const inviteSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin").max(200),
});
const suspendSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe girin").max(300) });
const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
});
const tenantUpdate = z.object({
  // Pasife alma/açma ayrı uç noktalarla (gerekçe ve denetim kaydıyla) yapılır.
  // ACTIVE yalnızca abonelikle (ödeme sağlayıcısı ya da kayıtlı manuel abonelik) verilir.
  status: z.enum(["TRIAL", "PAST_DUE", "CANCELLED"]).optional(),
  planCode: planCode.optional(),
  trialEndsAt: z.string().datetime({ offset: true }).optional(),
});
const money = (max: number) => z.number().min(0).max(max).multipleOf(0.01, "En fazla 2 ondalık basamak");
const features = z
  .array(z.enum(PLAN_FEATURES))
  .max(PLAN_FEATURES.length)
  // Temel özellikler her pakette vardır; sıra PLAN_FEATURES ile aynı tutulur.
  .transform((f) => PLAN_FEATURES.filter((k) => f.includes(k) || (PLAN_CORE_FEATURES as readonly string[]).includes(k)));
const planUpdate = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  maxStaff: z.number().int().min(1).max(500).optional(),
  monthlyPrice: money(1_000_000).optional(),
  yearlyPrice: money(10_000_000).optional(),
  features: features.optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
const planCreate = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(2).max(60),
  maxStaff: z.number().int().min(1).max(500),
  monthlyPrice: money(1_000_000),
  yearlyPrice: money(10_000_000),
  features: features.default([...PLAN_CORE_FEATURES]),
  sortOrder: z.number().int().min(0).max(1000).default(100),
  isActive: z.boolean().default(true),
});
const trialSchema = z
  .object({
    days: z.number().int().min(1, "En az 1 gün").max(90, "Tek seferde en fazla 90 gün").optional(),
    until: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(3, "Gerekçe girin").max(300),
  })
  .refine((v) => (v.days === undefined) !== (v.until === undefined), "Gün sayısı ya da bitiş tarihinden yalnızca birini girin");
const subscriptionList = z.object({
  status: z.enum(["ACTIVE", "PAST_DUE", "CANCELLED"]).optional(),
  source: z.enum(["PROVIDER", "MANUAL"]).optional(),
  q: z.string().trim().max(100).optional(),
  expiringDays: z.coerce.number().int().min(1).max(365).optional(),
});

const note = z.string().trim().min(3, "Açıklama girin (en az 3 karakter)").max(500);
const requestId = z.string().uuid("Geçersiz istek kimliği");
const amount = z.number().min(0).max(10_000_000).optional();
const paidOrFree = <T extends { complimentary: boolean; agreedAmount?: number }>(v: T, ctx: z.RefinementCtx) => {
  if (v.complimentary && (v.agreedAmount ?? 0) > 0) ctx.addIssue({ code: "custom", path: ["agreedAmount"], message: "Ücretsiz abonelikte tutar girilemez" });
  if (!v.complimentary && !((v.agreedAmount ?? 0) > 0)) ctx.addIssue({ code: "custom", path: ["agreedAmount"], message: "Ücretli manuel abonelik için anlaşılan tutarı girin" });
};
const manualCreate = z
  .object({ planCode, billingCycle: z.enum(["MONTHLY", "YEARLY"]), durationDays: z.number().int().min(1).max(730).optional(), complimentary: z.boolean(), agreedAmount: amount, note, requestId })
  .superRefine(paidOrFree);
const manualRenew = z
  .object({ durationDays: z.number().int().min(1).max(730).optional(), complimentary: z.boolean(), agreedAmount: amount, note, requestId })
  .superRefine(paidOrFree);
const manualExtend = z.object({ days: z.number().int().min(1, "En az 1 gün").max(366, "En fazla 366 gün"), note, requestId });
const manualPlan = z.object({ planCode, note, requestId });
const manualCancel = z.object({ mode: z.enum(["immediate", "period_end"]), note, requestId });

const roleSchema = z.enum(["OWNER", "MANAGER", "RECEPTION", "STAFF"]);
const mfaResetSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().trim().regex(/^\d{6}$/, "6 haneli doğrulama kodu girin"),
  reason: z.string().trim().min(5, "Gerekçe en az 5 karakter olmalı").max(500),
});
export const memberInvite = z.object({
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı").max(120),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin").max(200),
  role: z.enum(["MANAGER", "RECEPTION", "STAFF"], { error: "Rol yönetici, resepsiyon veya personel olmalı" }),
});
const userList = z.object({
  search: z.string().trim().max(100).optional(),
  tenantId: z.string().uuid().optional(),
  role: roleSchema.optional(),
  status: z.enum(["active", "inactive", "locked"]).optional(),
  kind: z.enum(["tenant", "platform"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe girin").max(300) });
const optionalReason = z.object({ reason: z.string().trim().max(300).optional() });
const roleChange = z.object({ role: roleSchema });
const resetSchema = z.object({ revokeSessions: z.boolean().default(false) });

/** SaaS sahibi (platform yöneticisi) paneli. Tüm işletmeleri görür; RLS'yi atlayan ayrı rol kullanır. */
@PlatformAdmin()
@Controller("platform")
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly tenantAdmin: TenantAdminService,
    private readonly manual: ManualSubscriptionService,
    private readonly users: PlatformUsersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get("stats")
  async stats() {
    const db = this.prisma.platform;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byStatus, byPlan, signups, appts, subs] = await Promise.all([
      db.tenant.groupBy({ by: ["status"], _count: true }),
      db.tenant.groupBy({ by: ["planCode"], _count: true }),
      db.tenant.count({ where: { createdAt: { gte: since } } }),
      db.appointment.count({ where: { createdAt: { gte: since } } }),
      // MRR yalnızca ödeme sağlayıcısıyla tahsil edilen aboneliklerden hesaplanır; manuel/ücretsiz olanlar ayrı sayılır.
      db.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
    ]);
    const paid = subs.filter((s) => s.source === "PROVIDER");
    const manual = subs.filter((s) => s.source === "MANUAL");
    const mrr = paid.reduce(
      (s, x) => s.plus(x.billingCycle === "MONTHLY" ? x.plan.monthlyPrice : new Prisma.Decimal(x.plan.yearlyPrice).div(12)),
      new Prisma.Decimal(0),
    );
    return {
      tenants: { total: byStatus.reduce((s, r) => s + r._count, 0), byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])) },
      byPlan: Object.fromEntries(byPlan.map((r) => [r.planCode, r._count])),
      signupsLast30Days: signups,
      appointmentsLast30Days: appts,
      mrr: mrr.toFixed(2),
      activeSubscriptions: paid.length,
      manualSubscriptions: { total: manual.length, complimentary: manual.filter((s) => s.isComplimentary).length },
    };
  }

  @Get("tenants")
  async tenants(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const rows = await this.prisma.platform.tenant.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { slug: { contains: q.search.toLowerCase() } }, { email: { contains: q.search, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        plan: { select: { name: true, maxStaff: true } },
        _count: { select: { customers: true, staff: true, memberships: true } },
        memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { email: true, fullName: true } } } },
        invites: { where: { role: "OWNER", status: { in: ["PENDING_DELIVERY", "SENT"] } }, take: 1, select: { email: true, status: true, expiresAt: true } },
      },
    });
    return rows.map(({ memberships, invites, ...t }) => ({ ...t, owner: memberships[0]?.user ?? null, openInvite: invites[0] ?? null }));
  }

  @Get("tenants/:id")
  async tenant(@Param("id", ParseUUIDPipe) id: string) {
    const t = await this.prisma.platform.tenant.findUnique({
      where: { id },
      include: {
        plan: true,
        subscriptions: { orderBy: { createdAt: "desc" }, include: { payments: { orderBy: { createdAt: "desc" } }, grants: { orderBy: { createdAt: "desc" } } } },
        memberships: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, isActive: true, user: { select: { id: true, email: true, fullName: true, lastLoginAt: true, isActive: true } } } },
        // Açık davetlerin tamamı (sınırsız) — kapanmış davetlerden yalnızca son 10'u aşağıda eklenir.
        invites: { where: { status: { in: ["PENDING_DELIVERY", "SENT"] } }, orderBy: { createdAt: "desc" }, select: inviteSelect },
        _count: { select: { customers: true, staff: true, services: true } },
      },
    });
    if (!t) throw new NotFoundException("İşletme bulunamadı");
    const closed = await this.prisma.platform.tenantInvite.findMany({
      where: { tenantId: id, status: { in: ["ACCEPTED", "REVOKED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: inviteSelect,
    });
    return { ...t, invites: [...t.invites, ...closed] };
  }

  /** Yeni güzellik merkezi: işletme deneme sürecinde açılır, sahibine e-posta daveti gider (SMTP yoksa bekler). */
  @Post("tenants")
  createTenant(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createTenantSchema)) b: z.infer<typeof createTenantSchema>, @Req() req: Request) {
    return this.tenantAdmin.create(u.id, b, req.ip);
  }

  @Post("tenants/:id/invite")
  invite(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(inviteSchema)) b: z.infer<typeof inviteSchema>, @Req() req: Request) {
    return this.tenantAdmin.invite(id, u.id, b, req.ip);
  }

  @Post("tenants/:id/invite/resend")
  @HttpCode(200)
  resendInvite(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenantAdmin.resend(id, u.id, req.ip);
  }

  @Post("tenants/:id/invite/revoke")
  @HttpCode(200)
  revokeInvite(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenantAdmin.revoke(id, u.id, req.ip);
  }

  @Post("tenants/:id/suspend")
  @HttpCode(200)
  suspend(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(suspendSchema)) b: z.infer<typeof suspendSchema>, @Req() req: Request) {
    return this.tenantAdmin.suspend(id, u.id, b.reason, req.ip);
  }

  @Post("tenants/:id/reactivate")
  @HttpCode(200)
  reactivate(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenantAdmin.reactivate(id, u.id, req.ip);
  }

  // ---- Manuel abonelik (gerçek tahsilat değildir; SubscriptionGrant defterine ve denetim kaydına yazılır) ----

  @Post("tenants/:id/subscriptions")
  @HttpCode(200)
  createManual(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(manualCreate)) b: z.infer<typeof manualCreate>, @Req() req: Request) {
    return this.manual.create(id, u.id, b, req.ip);
  }

  @Post("subscriptions/:id/extend")
  @HttpCode(200)
  extendManual(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(manualExtend)) b: z.infer<typeof manualExtend>, @Req() req: Request) {
    return this.manual.extend(id, u.id, b, req.ip);
  }

  @Post("subscriptions/:id/renew")
  @HttpCode(200)
  renewManual(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(manualRenew)) b: z.infer<typeof manualRenew>, @Req() req: Request) {
    return this.manual.renew(id, u.id, b, req.ip);
  }

  @Post("subscriptions/:id/plan")
  @HttpCode(200)
  changeManualPlan(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(manualPlan)) b: z.infer<typeof manualPlan>, @Req() req: Request) {
    return this.manual.changePlan(id, u.id, b, req.ip);
  }

  @Post("subscriptions/:id/cancel")
  @HttpCode(200)
  cancelSubscription(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(manualCancel)) b: z.infer<typeof manualCancel>, @Req() req: Request) {
    return this.manual.cancel(id, u.id, b, req.ip);
  }

  // ---- Kullanıcı yönetimi ----

  @Get("users")
  listUsers(@Query(new ZodPipe(userList)) q: z.infer<typeof userList>) {
    return this.users.list(q);
  }

  @Get("users/:id")
  getUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post("users/:id/deactivate")
  @HttpCode(200)
  deactivateUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @Req() req: Request) {
    return this.users.deactivateUser(id, u.id, b.reason, req.ip);
  }

  @Post("users/:id/activate")
  @HttpCode(200)
  activateUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.users.activateUser(id, u.id, req.ip);
  }

  @Post("users/:id/password-reset")
  @HttpCode(200)
  passwordReset(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(resetSchema)) b: z.infer<typeof resetSchema>, @Req() req: Request) {
    return this.users.sendPasswordReset(id, u.id, b, req.ip);
  }

  /** 2FA sıfırlama: yöneticinin parolası + güncel 2FA kodu ve gerekçe zorunlu. */
  @Post("users/:id/mfa-reset")
  @HttpCode(200)
  mfaReset(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(mfaResetSchema)) b: z.infer<typeof mfaResetSchema>, @Req() req: Request) {
    this.rateLimit.hit(`platform-reauth:${u.id}`, 5, 15 * 60_000);
    return this.users.resetMfa(id, u.id, b, req.ip);
  }

  @Patch("memberships/:id")
  changeRole(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(roleChange)) b: z.infer<typeof roleChange>, @Req() req: Request) {
    return this.users.changeRole(id, u.id, b.role, req.ip);
  }

  @Post("memberships/:id/deactivate")
  @HttpCode(200)
  deactivateMember(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(optionalReason)) b: z.infer<typeof optionalReason>, @Req() req: Request) {
    return this.users.setMembershipActive(id, u.id, false, b.reason, req.ip);
  }

  @Post("memberships/:id/activate")
  @HttpCode(200)
  activateMember(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.users.setMembershipActive(id, u.id, true, undefined, req.ip);
  }

  /** İşletmeye yönetici/resepsiyon/personel daveti (parolayı davetli belirler). */
  @Post("tenants/:id/members")
  inviteMember(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(memberInvite)) b: z.infer<typeof memberInvite>, @Req() req: Request) {
    return this.tenantAdmin.inviteMember(id, u.id, b, req.ip);
  }

  @Post("invites/:id/resend")
  @HttpCode(200)
  resendInviteById(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenantAdmin.resendById(id, u.id, req.ip);
  }

  @Post("invites/:id/revoke")
  @HttpCode(200)
  revokeInviteById(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenantAdmin.revokeById(id, u.id, req.ip);
  }

  @Patch("tenants/:id")
  async updateTenant(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(tenantUpdate)) b: z.infer<typeof tenantUpdate>) {
    const current = await this.prisma.platform.tenant.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("İşletme bulunamadı");
    if (b.planCode && b.planCode !== current.planCode) {
      // Açık abonelikte paket abonelik üzerinden atanır (abonelik ve işletme paketi ayrışmasın).
      const open = await this.prisma.platform.subscription.count({ where: { tenantId: id, status: { in: ["ACTIVE", "PAST_DUE"] } } });
      if (open > 0) throw new ConflictException("Açık aboneliği olan işletmede paket, abonelik bölümünden atanır");
      await this.tenantAdmin.assertPlanFits(id, b.planCode);
    }
    const updated = await this.prisma.platform.tenant.update({
      where: { id },
      data: { ...b, ...(b.trialEndsAt ? { trialEndsAt: new Date(b.trialEndsAt) } : {}) },
    });
    await this.audit.logPlatform({ tenantId: id, actorId: u.id, action: "platform.tenant_updated", metadata: b });
    return updated;
  }

  @Get("plans")
  plans() {
    return this.prisma.platform.plan.findMany({ orderBy: { sortOrder: "asc" } });
  }

  @Post("plans")
  async createPlan(@CurrentUser() u: AuthUser, @Body(new ZodPipe(planCreate)) b: z.infer<typeof planCreate>) {
    if (b.yearlyPrice > 0 && b.monthlyPrice > 0 && b.yearlyPrice > b.monthlyPrice * 12) throw new ConflictException("Yıllık fiyat, aylık fiyatın 12 katından fazla olamaz");
    try {
      const plan = await this.prisma.platform.plan.create({ data: b });
      await this.audit.logPlatform({ actorId: u.id, action: "platform.plan_created", entity: "Plan", metadata: b });
      return plan;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu kodla bir paket zaten var");
      throw e;
    }
  }

  @Patch("plans/:code")
  async updatePlan(@CurrentUser() u: AuthUser, @Param("code") code: string, @Body(new ZodPipe(planUpdate)) b: z.infer<typeof planUpdate>) {
    const parsed = planCodeSchema.safeParse(code);
    const before = parsed.success ? await this.prisma.platform.plan.findUnique({ where: { code: parsed.data } }) : null;
    if (!before) throw new NotFoundException("Paket bulunamadı");
    if (b.maxStaff !== undefined && b.maxStaff < before.maxStaff) {
      // Sınır düşürülürken mevcut işletmelerden hiçbiri yeni sınırı aşmamalı.
      const over = await this.prisma.platform.$queryRaw<{ name: string; n: bigint }[]>`
        SELECT t.name, count(s.id) AS n FROM "Tenant" t JOIN "StaffMember" s ON s."tenantId" = t.id AND s."isActive"
        WHERE t."planCode" = ${before.code} AND t.status <> 'CANCELLED' GROUP BY t.id, t.name HAVING count(s.id) > ${b.maxStaff} LIMIT 3`;
      if (over.length) throw new ConflictException(`Personel sınırı düşürülemez; aşan işletmeler: ${over.map((o) => `${o.name} (${o.n})`).join(", ")}`);
    }
    const plan = await this.prisma.platform.plan.update({ where: { code: before.code }, data: b });
    const changes = Object.fromEntries(Object.keys(b).map((k) => [k, { from: (before as Record<string, unknown>)[k], to: (b as Record<string, unknown>)[k] }]));
    await this.audit.logPlatform({ actorId: u.id, action: "platform.plan_updated", entity: "Plan", metadata: JSON.parse(JSON.stringify({ code: before.code, changes })) });
    return plan;
  }

  /** Deneme süresini uzatır ya da yeniden açar (süresi dolmuş, aboneliği olmayan işletme). */
  @Post("tenants/:id/trial")
  @HttpCode(200)
  extendTrial(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(trialSchema)) b: z.infer<typeof trialSchema>, @Req() req: Request) {
    return this.tenantAdmin.extendTrial(id, u.id, b, req.ip);
  }

  /** Abonelik izleme: durum/kaynak filtresi, yakında bitenler ve özet sayılar. */
  @Get("subscriptions")
  async subscriptions(@Query(new ZodPipe(subscriptionList)) q: z.infer<typeof subscriptionList>) {
    const db = this.prisma.platform;
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 86_400_000);
    const where: Prisma.SubscriptionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.q ? { tenant: { name: { contains: q.q, mode: "insensitive" } } } : {}),
      ...(q.expiringDays ? { status: { in: ["ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lte: new Date(now.getTime() + q.expiringDays * 86_400_000) } } : {}),
    };
    const [items, tenantsByStatus, trialsEnding, subsEnding, bySubStatus] = await Promise.all([
      db.subscription.findMany({
        where,
        orderBy: { currentPeriodEnd: "asc" },
        take: 300,
        select: {
          id: true, status: true, source: true, isComplimentary: true, billingCycle: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, createdAt: true,
          plan: { select: { code: true, name: true } },
          tenant: { select: { id: true, name: true, status: true } },
        },
      }),
      db.tenant.groupBy({ by: ["status"], _count: true }),
      db.tenant.findMany({ where: { status: "TRIAL", trialEndsAt: { gt: now, lte: soon } }, orderBy: { trialEndsAt: "asc" }, select: { id: true, name: true, trialEndsAt: true } }),
      db.subscription.count({ where: { status: "ACTIVE", currentPeriodEnd: { gt: now, lte: soon } } }),
      db.subscription.groupBy({ by: ["status"], _count: true }),
    ]);
    return {
      summary: {
        tenants: Object.fromEntries(tenantsByStatus.map((r) => [r.status, r._count])),
        subscriptions: Object.fromEntries(bySubStatus.map((r) => [r.status, r._count])),
        trialsEndingIn7Days: trialsEnding,
        subscriptionsEndingIn7Days: subsEnding,
      },
      items,
    };
  }

  /** Günlük abonelik görevini elle tetikler; aynı gün ikinci kez yalnızca force=true ile çalışır. */
  @Post("lifecycle/run")
  runLifecycle(@CurrentUser() u: AuthUser, @Query("force") force?: string) {
    void this.audit.logPlatform({ actorId: u.id, action: "platform.lifecycle_triggered", metadata: { force: force === "true" } });
    return this.jobs.runDaily({ force: force === "true" });
  }

  @Get("jobs")
  jobRuns() {
    return this.jobs.recentRuns();
  }

  @Get("audit")
  audit_(@Query("tenantId") tenantId?: string) {
    return this.prisma.platform.auditLog.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}
