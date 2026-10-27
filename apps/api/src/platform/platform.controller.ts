import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { SubscriptionsService } from "../billing/subscriptions.service";
import { AuthUser, CurrentUser, PlatformAdmin } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";

const listSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
});
const tenantUpdate = z.object({
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
  planCode: z.enum(["STARTER", "PROFESSIONAL", "SMART"]).optional(),
  trialEndsAt: z.string().datetime({ offset: true }).optional(),
});
const planUpdate = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  maxStaff: z.number().int().min(1).max(500).optional(),
  monthlyPrice: z.number().min(0).max(1_000_000).optional(),
  yearlyPrice: z.number().min(0).max(10_000_000).optional(),
  isActive: z.boolean().optional(),
});

/** SaaS sahibi (platform yöneticisi) paneli. Tüm işletmeleri görür; RLS'yi atlayan ayrı rol kullanır. */
@PlatformAdmin()
@Controller("platform")
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
    private readonly audit: AuditService,
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
      db.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
    ]);
    const mrr = subs.reduce(
      (s, x) => s.plus(x.billingCycle === "MONTHLY" ? x.plan.monthlyPrice : new Prisma.Decimal(x.plan.yearlyPrice).div(12)),
      new Prisma.Decimal(0),
    );
    return {
      tenants: { total: byStatus.reduce((s, r) => s + r._count, 0), byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])) },
      byPlan: Object.fromEntries(byPlan.map((r) => [r.planCode, r._count])),
      signupsLast30Days: signups,
      appointmentsLast30Days: appts,
      mrr: mrr.toFixed(2),
      activeSubscriptions: subs.length,
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
      },
    });
    return rows.map(({ memberships, ...t }) => ({ ...t, owner: memberships[0]?.user ?? null }));
  }

  @Get("tenants/:id")
  async tenant(@Param("id", ParseUUIDPipe) id: string) {
    const t = await this.prisma.platform.tenant.findUnique({
      where: { id },
      include: {
        plan: true,
        subscriptions: { orderBy: { createdAt: "desc" }, include: { payments: true } },
        memberships: { select: { role: true, isActive: true, user: { select: { email: true, fullName: true, lastLoginAt: true } } } },
        _count: { select: { customers: true, staff: true, services: true } },
      },
    });
    if (!t) throw new NotFoundException("İşletme bulunamadı");
    return t;
  }

  @Patch("tenants/:id")
  async updateTenant(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(tenantUpdate)) b: z.infer<typeof tenantUpdate>) {
    if (!(await this.prisma.platform.tenant.findUnique({ where: { id } }))) throw new NotFoundException("İşletme bulunamadı");
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

  @Patch("plans/:code")
  async updatePlan(@CurrentUser() u: AuthUser, @Param("code") code: string, @Body(new ZodPipe(planUpdate)) b: z.infer<typeof planUpdate>) {
    const parsed = z.enum(["STARTER", "PROFESSIONAL", "SMART"]).safeParse(code);
    if (!parsed.success) throw new NotFoundException("Paket bulunamadı");
    const plan = await this.prisma.platform.plan.update({ where: { code: parsed.data }, data: b });
    await this.audit.logPlatform({ actorId: u.id, action: "platform.plan_updated", metadata: { code, ...b } });
    return plan;
  }

  @Post("lifecycle/run")
  runLifecycle() {
    return this.subs.runLifecycle();
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
