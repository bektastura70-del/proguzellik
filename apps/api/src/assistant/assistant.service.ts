import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { RateLimitService } from "../auth/rate-limit.service";
import { TenantInfo } from "../common/decorators";
import { FinanceService } from "../finance/finance.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReportsService } from "../reports/reports.service";
import { AiProvider, BusinessSnapshot } from "./ai.provider";

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly finance: FinanceService,
    private readonly ai: AiProvider,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Yalnızca toplu metrikler: müşteri kimlik bilgisi içermez. */
  async snapshot(t: TenantInfo): Promise<BusinessSnapshot> {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const range = { from: from.toISOString(), to: to.toISOString() };
    const [dash, commissions, tenant] = await Promise.all([
      this.reports.dashboard(t, range),
      this.finance.commissions(t, range),
      this.prisma.withTenant(t, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { name: true } })),
    ]);
    return {
      salonName: tenant.name,
      period: "son 30 gün",
      metrics: {
        appointments: dash.appointments,
        finance: dash.finance,
        newCustomers: dash.customers.new,
        totalCustomers: dash.customers.total,
        topServices: dash.topServices.map(({ name, count, revenue }) => ({ name, count, revenue })),
        staffPerformance: dash.staffPerformance.map(({ name, count, revenue }) => ({ name, count, revenue })),
        commissionsDue: commissions.map((c) => ({ staff: c.staffName, due: c.due })),
        lowStock: dash.stock.lowStock.map((p) => ({ name: p.name, stockQty: String(p.stockQty), unit: p.unit })),
      },
    };
  }

  async ask(t: TenantInfo, question: string) {
    this.rateLimit.hit(`assistant:${t.tenantId}`, 30, 60 * 60_000);
    const snapshot = await this.snapshot(t);
    const answer = await this.ai.answer(question, snapshot);
    await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "assistant.asked", metadata: { provider: this.ai.name, length: question.length } });
    return { answer, provider: this.ai.name, generatedAt: new Date().toISOString() };
  }
}
