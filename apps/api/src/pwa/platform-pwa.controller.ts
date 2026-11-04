import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { AuthUser, CurrentUser, PlatformAdmin } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { loadEnv, pwaEnabled, webPushMode } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_PWA, FLAG_KEYS, PWA_FLAGS } from "./pwa-settings";

const flagsSchema = z
  .object({
    businessPwaEnabled: z.boolean().optional(),
    customerPwaEnabled: z.boolean().optional(),
    customerBookingEnabled: z.boolean().optional(),
    webPushEnabled: z.boolean().optional(),
    customerSessionTrackingEnabled: z.boolean().optional(),
    reason: z.string().trim().min(3, "Değişiklik nedeni yazın").max(300),
  })
  .refine((v) => PWA_FLAGS.some((f) => v[f] !== undefined), "En az bir bayrak değişmeli");

/** SaaS sahibi: işletme başına PWA özellik bayrakları (canlı işletmede açmak ayrı onay gerektirir). */
@PlatformAdmin()
@Controller("platform/tenants/:id/pwa")
export class PlatformPwaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async view(tenantId: string) {
    const row = await this.prisma.platform.tenantPwaSettings.findUnique({ where: { tenantId } });
    const env = loadEnv();
    return {
      environment: { pwaEnabled: pwaEnabled(env), webPushMode: webPushMode(env) },
      flags: Object.fromEntries(PWA_FLAGS.map((f) => [f, row?.[f] ?? DEFAULT_PWA[f]])),
      keys: FLAG_KEYS,
      flagsUpdatedAt: row?.flagsUpdatedAt ?? null,
    };
  }

  @Get()
  async get(@Param("id", ParseUUIDPipe) id: string) {
    if (!(await this.prisma.platform.tenant.findUnique({ where: { id } }))) throw new NotFoundException("İşletme bulunamadı");
    return this.view(id);
  }

  @Patch()
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(flagsSchema)) b: z.infer<typeof flagsSchema>, @CurrentUser() u: AuthUser) {
    const tenant = await this.prisma.platform.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException("İşletme bulunamadı");
    const { reason, ...flags } = b;
    const before = await this.view(id);
    const data = { ...flags, flagsUpdatedById: u.id, flagsUpdatedAt: new Date() };
    await this.prisma.platform.$transaction(async (tx) => {
      await tx.tenantPwaSettings.upsert({ where: { tenantId: id }, create: { tenantId: id, ...data }, update: data });
      await this.audit.log(tx, {
        tenantId: id, actorId: u.id, action: "platform.pwa_flags_changed", entity: "Tenant", entityId: id,
        metadata: { before: before.flags, change: flags, reason },
      });
    });
    return this.view(id);
  }
}
