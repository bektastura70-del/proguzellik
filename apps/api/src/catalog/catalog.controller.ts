import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
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
});
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
      if (!(await tx.service.findUnique({ where: { id } }))) throw new NotFoundException("Hizmet bulunamadı");
      if (b.categoryId && !(await tx.serviceCategory.findUnique({ where: { id: b.categoryId } }))) {
        throw new NotFoundException("Kategori bulunamadı");
      }
      return tx.service.update({ where: { id }, data: b });
    });
  }
}
