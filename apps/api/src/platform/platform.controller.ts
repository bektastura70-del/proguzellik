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
import { loadEnv, renewalRemindersOn } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { ManualSubscriptionService } from "./manual-subscription.service";
import { PlanAdminService } from "./plan-admin.service";
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
/** Owner listeleri: sayfa boyutu. `all=1` seçim listeleri (kullanıcı/finans/e-posta) içindir ve üst sınırı yüksektir. */
const OWNER_PAGE_SIZE = 100;
const OWNER_ALL_LIMIT = 5000;
const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  all: z.enum(["1"]).optional(),
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
const limit = z.number().int().min(1).max(10_000_000).nullable();
const planFields = {
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullable().transform((v) => v || null),
  maxStaff: z.number().int().min(1).max(500),
  maxCustomers: limit,
  maxMonthlyAppointments: limit,
  features,
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
  isPublic: z.boolean(),
};
/** Fiyat alanları bu uç noktalarda kabul edilmez: fiyat yalnız onaylı fiyat sürümüyle değişir. */
const noPrice = (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const k of ["monthlyPrice", "yearlyPrice", "vatRate"]) {
    if (k in v) ctx.addIssue({ code: "custom", path: [k], message: "Fiyat, paket bilgisinden ayrı olarak fiyat sürümüyle (taslak + onay) değiştirilir" });
  }
};
const planUpdate = z.object(planFields).partial().passthrough().superRefine(noPrice);
const planCreate = z
  .object({
    ...planFields,
    code: planCodeSchema,
    description: planFields.description.default(null),
    maxCustomers: limit.default(null),
    maxMonthlyAppointments: limit.default(null),
    features: features.default([...PLAN_CORE_FEATURES]),
    sortOrder: planFields.sortOrder.default(100),
    isActive: planFields.isActive.default(true),
    // Yeni paket varsayılan olarak gizli: fiyatı onaylanıp bilinçli olarak satışa açılana kadar sitede görünmez.
    isPublic: planFields.isPublic.default(false),
  })
  .passthrough()
  .superRefine(noPrice);
const isoDate = z.string().datetime({ offset: true, message: "Geçerli bir tarih girin" });
const priceDraft = z
  .object({
    monthlyPrice: money(1_000_000),
    yearlyPrice: money(10_000_000),
    vatRate: z.number({ error: "KDV oranını girin" }).min(0, "KDV oranı 0-100 arası olmalı").max(100, "KDV oranı 0-100 arası olmalı").multipleOf(0.01, "En fazla 2 ondalık basamak"),
    effectiveFrom: isoDate.optional(),
    renewalPolicy: z.enum(["KEEP_EXISTING", "APPLY_ON_RENEWAL"], { error: "Mevcut aboneliklere etkisini seçin" }),
    renewalsFrom: isoDate.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.renewalPolicy === "KEEP_EXISTING" && v.renewalsFrom) ctx.addIssue({ code: "custom", path: ["renewalsFrom"], message: "Mevcut abonelikler korunuyorsa uygulama tarihi girilmez" });
    if (v.effectiveFrom && new Date(v.effectiveFrom).getTime() > Date.now() + 730 * 86_400_000) ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "En fazla 2 yıl sonrası seçilebilir" });
  });
const priceApprove = z.object({
  password: z.string().min(1, "Parolanızı girin").max(200),
  code: z.string().trim().regex(/^\d{6}$/, "6 haneli doğrulama kodu girin"),
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
  page: z.coerce.number().int().min(1).max(10_000).default(1),
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
const renewalAllowSchema = z.object({ allowed: z.boolean(), reason: z.string().trim().min(3, "Gerekçe yazın").max(300) });

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
    private readonly plansAdmin: PlanAdminService,
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
    // MRR, aboneliğin kilitli fiyatından (KDV hariç) hesaplanır; paketin güncel fiyatı geçmiş abonelikleri etkilemez.
    const mrr = paid.reduce(
      (s, x) => (x.priceAmount == null ? s : s.plus(x.billingCycle === "MONTHLY" ? x.priceAmount : new Prisma.Decimal(x.priceAmount).div(12))),
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
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: q.all ? 0 : (q.page - 1) * OWNER_PAGE_SIZE,
      take: q.all ? OWNER_ALL_LIMIT : OWNER_PAGE_SIZE,
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
    return { ...t, invites: [...t.invites, ...closed], renewalEnvOn: renewalRemindersOn(loadEnv()) };
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

  /**
   * Yenilenme hatırlatması pilotu: SaaS sahibi işletme başına izin verir/geri alır (gerekçe zorunlu, denetim kaydı).
   * İzin geri alınınca işletmenin kendi ayarı da kapanır; yeniden izin verilse bile hatırlatma kendiliğinden başlamaz.
   */
  @Post("tenants/:id/renewal-reminders")
  @HttpCode(200)
  async setRenewalAllowed(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(renewalAllowSchema)) b: z.infer<typeof renewalAllowSchema>) {
    return this.prisma.platform.$transaction(async (tx) => {
      const cur = await tx.tenant.findUnique({ where: { id }, select: { renewalRemindersAllowed: true, renewalRemindersEnabled: true } });
      if (!cur) throw new NotFoundException("İşletme bulunamadı");
      const updated = await tx.tenant.update({
        where: { id },
        data: { renewalRemindersAllowed: b.allowed, ...(b.allowed ? {} : { renewalRemindersEnabled: false }) },
        select: { renewalRemindersAllowed: true, renewalRemindersEnabled: true },
      });
      await this.audit.log(tx, {
        tenantId: id, actorId: u.id, action: "platform.renewal_reminders_allowed_changed", entity: "Tenant", entityId: id,
        metadata: { before: cur, after: updated, reason: b.reason },
      });
      return { ...updated, renewalEnvOn: renewalRemindersOn(loadEnv()) };
    });
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

  /** Paketler: güncel/planlanan onaylı fiyat ve taslak sayısıyla (eski fiyat sütunları dönmez). */
  @Get("plans")
  plans() {
    return this.plansAdmin.list();
  }

  /** Onaylı fiyatlar sitede/işletme panelinde görünüyor mu (PRICING_PUBLIC sunucu ayarı). */
  @Get("pricing-visibility")
  pricingVisibility() {
    return this.plansAdmin.pricingVisibility();
  }

  @Post("plans")
  createPlan(@CurrentUser() u: AuthUser, @Body(new ZodPipe(planCreate)) b: z.infer<typeof planCreate>) {
    const { code, name, description, maxStaff, maxCustomers, maxMonthlyAppointments, features: f, sortOrder, isActive, isPublic } = b;
    return this.plansAdmin.create(u.id, { code, name, description, maxStaff, maxCustomers, maxMonthlyAppointments, features: f, sortOrder, isActive, isPublic });
  }

  @Patch("plans/:code")
  updatePlan(@CurrentUser() u: AuthUser, @Param("code") code: string, @Body(new ZodPipe(planUpdate)) b: z.infer<typeof planUpdate>) {
    const keys = Object.keys(planFields) as (keyof typeof planFields)[];
    const data = Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
    return this.plansAdmin.update(u.id, code, data);
  }

  /** Fiyat geçmişi (tüm sürümler). */
  @Get("plans/:code/prices")
  planPrices(@Param("code") code: string) {
    return this.plansAdmin.prices(code);
  }

  /** Yeni fiyat taslağı (KDV hariç). Onaylanana kadar hiçbir yerde kullanılmaz. */
  @Post("plans/:code/prices")
  createPlanPrice(@CurrentUser() u: AuthUser, @Param("code") code: string, @Body(new ZodPipe(priceDraft)) b: z.infer<typeof priceDraft>) {
    return this.plansAdmin.createDraft(u.id, code, b);
  }

  /** Owner onayı: parola + güncel 2FA kodu. */
  @Post("plans/:code/prices/:id/approve")
  @HttpCode(200)
  approvePlanPrice(@CurrentUser() u: AuthUser, @Param("code") code: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(priceApprove)) b: z.infer<typeof priceApprove>, @Req() req: Request) {
    this.rateLimit.hit(`platform-reauth:${u.id}`, 5, 15 * 60_000);
    return this.plansAdmin.approve(u.id, code, id, b, req.ip);
  }

  @Post("plans/:code/prices/:id/cancel")
  @HttpCode(200)
  cancelPlanPrice(@CurrentUser() u: AuthUser, @Param("code") code: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.plansAdmin.cancel(u.id, code, id, b.reason);
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
    const [items, tenantsByStatus, trialsEnding, subsEnding, bySubStatus, total] = await Promise.all([
      db.subscription.findMany({
        where,
        orderBy: [{ currentPeriodEnd: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * OWNER_PAGE_SIZE,
        take: OWNER_PAGE_SIZE,
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
      db.subscription.count({ where }),
    ]);
    return {
      summary: {
        tenants: Object.fromEntries(tenantsByStatus.map((r) => [r.status, r._count])),
        subscriptions: Object.fromEntries(bySubStatus.map((r) => [r.status, r._count])),
        trialsEndingIn7Days: trialsEnding,
        subscriptionsEndingIn7Days: subsEnding,
      },
      items,
      total,
      page: q.page,
      pageSize: OWNER_PAGE_SIZE,
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
