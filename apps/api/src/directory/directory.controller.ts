import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { RateLimitService } from "../auth/rate-limit.service";
import { AuthUser, CurrentTenant, CurrentUser, PlatformAdmin, Public, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { DirectoryService } from "./directory.service";

const listingSchema = z.object({
  enabled: z.boolean(),
  provinceCode: z.number().int().min(1).max(81).nullable(),
  districtCode: z.number().int().positive().nullable(),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
});
const unitSlug = z.string().regex(/^[a-z0-9-]{1,40}$/);
const pageSchema = z.object({ sayfa: z.coerce.number().int().min(1).max(1000).optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Neden yazın").max(300) });

/** İşletme paneli: "Pro Güzellik uygulamasında listelensin" ayarı. Değiştirmek yalnız işletme sahibinde. */
@Controller("directory")
export class DirectoryController {
  constructor(private readonly svc: DirectoryService) {}

  @Get("units")
  @Roles("OWNER", "MANAGER")
  units() {
    return { provinces: this.svc.units() };
  }

  @Get("listing")
  @Roles("OWNER", "MANAGER")
  get(@CurrentTenant() t: TenantInfo) {
    return this.svc.getForTenant(t);
  }

  @Put("listing")
  @Roles("OWNER")
  update(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(listingSchema)) b: z.infer<typeof listingSchema>, @Req() req: Request) {
    return this.svc.updateForTenant(t, b, req.ip);
  }
}

/** Herkese açık salon rehberi: girişsiz, arama yok, sayfalı, IP başına sınırlı; yalnızca salonun izin verdiği alanlar. */
@Public()
@Controller("public/directory")
export class PublicDirectoryController {
  constructor(
    private readonly svc: DirectoryService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get("provinces")
  provinces(@Req() req: Request) {
    this.rateLimit.hit(`directory:${req.ip}`, 120, 60_000);
    return this.svc.publicProvinces();
  }

  @Get("provinces/:il")
  districts(@Param("il", new ZodPipe(unitSlug)) il: string, @Req() req: Request) {
    this.rateLimit.hit(`directory:${req.ip}`, 120, 60_000);
    return this.svc.publicDistricts(il);
  }

  @Get("provinces/:il/:ilce")
  salons(@Param("il", new ZodPipe(unitSlug)) il: string, @Param("ilce", new ZodPipe(unitSlug)) ilce: string, @Query(new ZodPipe(pageSchema)) q: z.infer<typeof pageSchema>, @Req() req: Request) {
    this.rateLimit.hit(`directory:${req.ip}`, 120, 60_000);
    return this.svc.publicSalons(il, ilce, q.sayfa ?? 1);
  }
}

/** SaaS sahibi: rehberdeki salonlar, kötüye kullanımda listeden çıkarma (işletme yeniden açamaz) ve geri alma. */
@PlatformAdmin()
@Controller("platform/directory")
export class PlatformDirectoryController {
  constructor(private readonly svc: DirectoryService) {}

  @Get()
  list() {
    return this.svc.platformList();
  }

  @Post(":tenantId/block")
  block(@Param("tenantId", ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentUser() u: AuthUser) {
    return this.svc.platformBlock(id, u.id, true, b.reason);
  }

  @Post(":tenantId/unblock")
  unblock(@Param("tenantId", ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentUser() u: AuthUser) {
    return this.svc.platformBlock(id, u.id, false, b.reason);
  }
}
