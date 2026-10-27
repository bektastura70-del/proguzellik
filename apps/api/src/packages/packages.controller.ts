import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { moneySchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { PackagesService } from "./packages.service";

const tplSchema = z.object({
  name: z.string().trim().min(1).max(120),
  serviceId: z.string().uuid(),
  sessionCount: z.number().int().min(1).max(200),
  price: moneySchema,
  validityDays: z.number().int().min(1).max(3650).optional(),
});
const tplUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price: moneySchema.optional(),
  isActive: z.boolean().optional(),
  validityDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export const methodSchema = z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]);
const sellSchema = z.object({
  customerId: z.string().uuid(),
  templateId: z.string().uuid(),
  price: moneySchema.optional(),
  payment: z.object({ amount: moneySchema, method: methodSchema }).optional(),
});

@Controller()
export class PackagesController {
  constructor(private readonly pkgs: PackagesService) {}

  @Get("package-templates")
  @Roles()
  templates(@CurrentTenant() t: TenantInfo) {
    return this.pkgs.listTemplates(t);
  }

  @Post("package-templates")
  @Roles("OWNER", "MANAGER")
  createTemplate(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(tplSchema)) b: z.infer<typeof tplSchema>) {
    return this.pkgs.createTemplate(t, b);
  }

  @Patch("package-templates/:id")
  @Roles("OWNER", "MANAGER")
  updateTemplate(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(tplUpdate)) b: z.infer<typeof tplUpdate>,
  ) {
    return this.pkgs.updateTemplate(t, id, b);
  }

  @Post("customer-packages")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  sell(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(sellSchema)) b: z.infer<typeof sellSchema>) {
    return this.pkgs.sell(t, b);
  }

  @Get("customers/:id/packages")
  @Roles()
  forCustomer(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.pkgs.listForCustomer(t, id);
  }

  @Post("customer-packages/:id/cancel")
  @Roles("OWNER", "MANAGER")
  cancel(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.pkgs.cancel(t, id);
  }
}
