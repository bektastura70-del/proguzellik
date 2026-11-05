import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { moneySchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";

const categorySchema = z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().optional() });
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  durationMin: z.number().int().min(5).max(720),
  price: moneySchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  onlineBookable: z.boolean().optional(),
  rebookAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  /** Yenileme tarihinden kaç gün önce müşteriye hatırlatma gider (tekrar süresinden kısa olmalı) */
  renewalRemindDaysBefore: z.number().int().min(1).max(60).nullable().optional(),
});
/** Hatırlatma günü, tekrar süresinden önce olmalı (ör. 45 günlük işlemde en fazla 44 gün önce). */
function checkRenewal(v: { rebookAfterDays?: number | null; renewalRemindDaysBefore?: number | null }) {
  if (v.renewalRemindDaysBefore && !v.rebookAfterDays) throw new BadRequestException("Hatırlatma için önce tekrar süresini (gün) girin");
  if (v.renewalRemindDaysBefore && v.rebookAfterDays && v.renewalRemindDaysBefore >= v.rebookAfterDays) {
    throw new BadRequestException("Hatırlatma günü, tekrar süresinden kısa olmalı");
  }
}
const listSchema = z.object({ includeInactive: z.enum(["true", "false"]).optional() });

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("service-categories")
  @Roles()
  categories(@CurrentTenant() t: TenantInfo) {
    return this.prisma.withTenant(t, (tx) => tx.serviceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  }

  @Post("service-categories")
  @Roles("OWNER", "MANAGER")
  createCategory(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(categorySchema)) b: z.infer<typeof categorySchema>) {
    return this.prisma.withTenant(t, (tx) => tx.serviceCategory.create({ data: { tenantId: t.tenantId, ...b } }));
  }

  @Patch("service-categories/:id")
  @Roles("OWNER", "MANAGER")
  updateCategory(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(categorySchema.partial())) b: Partial<z.infer<typeof categorySchema>>) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.serviceCategory.findUnique({ where: { id } }))) throw new NotFoundException("Kategori bulunamadı");
      return tx.serviceCategory.update({ where: { id }, data: b });
    });
  }

  @Delete("service-categories/:id")
  @Roles("OWNER", "MANAGER")
  deleteCategory(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.serviceCategory.findUnique({ where: { id } }))) throw new NotFoundException("Kategori bulunamadı");
      const used = await tx.service.count({ where: { categoryId: id } });
      if (used) throw new ConflictException(`Bu kategoride ${used} hizmet var; önce hizmetleri taşıyın`);
      await tx.serviceCategory.delete({ where: { id } });
      return { deleted: true };
    });
  }

  @Get("services")
  @Roles()
  services(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.prisma.withTenant(t, (tx) =>
      tx.service.findMany({
        where: q.includeInactive === "true" ? {} : { isActive: true },
        orderBy: { name: "asc" },
        include: { category: { select: { id: true, name: true } }, staff: { select: { staffId: true } } },
      }),
    );
  }

  @Post("services")
  @Roles("OWNER", "MANAGER")
  createService(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(serviceSchema)) b: z.infer<typeof serviceSchema>) {
    checkRenewal(b);
    return this.prisma.withTenant(t, async (tx) => {
      if (b.categoryId && !(await tx.serviceCategory.findUnique({ where: { id: b.categoryId } }))) {
        throw new NotFoundException("Kategori bulunamadı");
      }
      return tx.service.create({ data: { tenantId: t.tenantId, ...b } });
    });
  }

  @Patch("services/:id")
  @Roles("OWNER", "MANAGER")
  updateService(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(serviceSchema.partial())) b: Partial<z.infer<typeof serviceSchema>>,
  ) {
    return this.prisma.withTenant(t, async (tx) => {
      const cur = await tx.service.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException("Hizmet bulunamadı");
      // Tekrar süresi kaldırılırsa hatırlatma da kalkar.
      if (b.rebookAfterDays === null && b.renewalRemindDaysBefore === undefined) b = { ...b, renewalRemindDaysBefore: null };
      checkRenewal({ rebookAfterDays: b.rebookAfterDays !== undefined ? b.rebookAfterDays : cur.rebookAfterDays, renewalRemindDaysBefore: b.renewalRemindDaysBefore !== undefined ? b.renewalRemindDaysBefore : cur.renewalRemindDaysBefore });
      if (b.categoryId && !(await tx.serviceCategory.findUnique({ where: { id: b.categoryId } }))) {
        throw new NotFoundException("Kategori bulunamadı");
      }
      return tx.service.update({ where: { id }, data: b });
    });
  }
}
