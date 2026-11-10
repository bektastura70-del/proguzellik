import { Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService, Tx } from "../prisma/prisma.service";

const dismissSchema = z.object({ dismissed: z.boolean() });

/**
 * Başlangıç sihirbazı durumu. Adımlar ayrı bir kayıtta tutulmaz, işletmenin mevcut verilerinden hesaplanır;
 * böylece panelin başka yerinden yapılan kurulum da sayılır.
 */
export async function onboardingStatus(tx: Tx, tenantId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, slug: true, phone: true, address: true, onlineBookingEnabled: true, onboardingDismissedAt: true },
  });
  const [services, staff, bookableStaff] = await Promise.all([
    tx.service.count({ where: { isActive: true } }),
    tx.staffMember.count({ where: { isActive: true } }),
    // Online randevuya hazır: aktif, online alınabilir, çalışma saati ve online alınabilir en az bir hizmeti olan personel.
    tx.staffMember.count({
      where: {
        isActive: true,
        onlineBookable: true,
        workingHours: { some: {} },
        services: { some: { service: { isActive: true, onlineBookable: true } } },
      },
    }),
  ]);
  const steps = {
    salon: !!tenant.phone && !!tenant.address?.trim(),
    services: services > 0,
    staff: staff > 0 && bookableStaff > 0,
    online: tenant.onlineBookingEnabled && bookableStaff > 0,
  };
  const done = Object.values(steps).filter(Boolean).length;
  return {
    steps,
    done,
    total: Object.keys(steps).length,
    complete: done === Object.keys(steps).length,
    dismissed: !!tenant.onboardingDismissedAt,
    slug: tenant.slug,
  };
}

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  get(@CurrentTenant() t: TenantInfo) {
    return this.prisma.withTenant(t, (tx) => onboardingStatus(tx, t.tenantId));
  }

  /** "Sonra yaparım" / yeniden göster. Yalnız görünürlüğü değiştirir, hiçbir kaydı silmez. */
  @Patch()
  @Roles("OWNER")
  dismiss(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(dismissSchema)) b: z.infer<typeof dismissSchema>) {
    return this.prisma.withTenant(t, async (tx) => {
      await tx.tenant.update({ where: { id: t.tenantId }, data: { onboardingDismissedAt: b.dismissed ? new Date() : null } });
      return onboardingStatus(tx, t.tenantId);
    });
  }
}
