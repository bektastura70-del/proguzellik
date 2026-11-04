import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { BrandingService } from "./branding.service";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB biçiminde olmalı").nullable().optional();
const text = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
const brandingSchema = z.object({
  appName: text(40),
  shortName: text(12),
  description: text(160),
  primaryColor: color,
  secondaryColor: color,
  cancelMinHours: z.number().int().min(0).max(168).optional(),
  rescheduleMinHours: z.number().int().min(0).max(168).optional(),
  allowCustomerCancel: z.boolean().optional(),
  allowCustomerReschedule: z.boolean().optional(),
});
const kindSchema = z.enum(["logo", "icon"]);

/** Salon uygulaması ayarları: yalnızca işletme sahibi ve yönetici. Özellik bayrakları burada değişmez. */
@Controller("pwa/branding")
export class BrandingController {
  constructor(private readonly svc: BrandingService) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  get(@CurrentTenant() t: TenantInfo) {
    return this.svc.get(t);
  }

  @Patch()
  @Roles("OWNER", "MANAGER")
  update(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(brandingSchema)) b: z.infer<typeof brandingSchema>) {
    return this.svc.update(t, b);
  }

  /** Gövde ham görsel baytlarıdır (Content-Type: image/png | image/jpeg | image/webp, en fazla 512 KB). */
  @Post(":kind")
  @Roles("OWNER", "MANAGER")
  upload(@CurrentTenant() t: TenantInfo, @Param("kind", new ZodPipe(kindSchema)) kind: "logo" | "icon", @Req() req: Request) {
    return this.svc.upload(t, kind === "logo" ? "LOGO" : "ICON", req.body);
  }

  @Delete(":kind")
  @Roles("OWNER", "MANAGER")
  remove(@CurrentTenant() t: TenantInfo, @Param("kind", new ZodPipe(kindSchema)) kind: "logo" | "icon") {
    return this.svc.remove(t, kind === "logo" ? "LOGO" : "ICON");
  }
}
