import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { AuthUser, CurrentTenant, CurrentUser, Roles, TenantInfo } from "../common/decorators";
import { phoneSchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(300).optional(),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Geçersiz saat dilimi").optional(),
  onlineBookingEnabled: z.boolean().optional(),
  requireMfa: z.boolean().optional(),
  packageReminderDays: z.number().int().min(1).max(60).optional(),
});

const PUBLIC_FIELDS = {
  id: true, name: true, slug: true, phone: true, email: true, address: true, timezone: true,
  onlineBookingEnabled: true, requireMfa: true, packageReminderDays: true, status: true, planCode: true, trialEndsAt: true,
} as const;

@Controller("settings")
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles()
  get(@CurrentTenant() t: TenantInfo) {
    return this.prisma.withTenant(t, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: PUBLIC_FIELDS }));
  }

  @Patch()
  @Roles("OWNER", "MANAGER")
  async update(@CurrentTenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    if (b.requireMfa !== undefined) {
      if (t.role !== "OWNER") throw new ForbiddenException("2FA zorunluluğunu yalnızca işletme sahibi değiştirebilir");
      // Sahip kendini kilitlememesi için önce kendi 2FA'sını açmış olmalı.
      if (b.requireMfa && !u.mfaVerified) throw new BadRequestException("Önce kendi hesabınızda iki adımlı doğrulamayı açın ve 2FA ile giriş yapın");
    }
    return this.prisma.withTenant(t, async (tx) => {
      const r = await tx.tenant.update({ where: { id: t.tenantId }, data: b, select: PUBLIC_FIELDS });
      if (b.requireMfa !== undefined) {
        await tx.auditLog.create({ data: { tenantId: t.tenantId, actorId: t.userId, action: "tenant.require_mfa_changed", metadata: { requireMfa: b.requireMfa } } });
      }
      return r;
    });
  }
}
