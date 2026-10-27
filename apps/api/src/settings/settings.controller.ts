import { Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
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
});

const PUBLIC_FIELDS = {
  id: true, name: true, slug: true, phone: true, email: true, address: true, timezone: true,
  onlineBookingEnabled: true, status: true, planCode: true, trialEndsAt: true,
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
  update(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.prisma.withTenant(t, (tx) => tx.tenant.update({ where: { id: t.tenantId }, data: b, select: PUBLIC_FIELDS }));
  }
}
