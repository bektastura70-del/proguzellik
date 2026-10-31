import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { CampaignsService } from "./campaigns.service";

const schema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(1000),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  isActive: z.boolean().optional(),
});
const broadcastSchema = z.object({
  confirm: z.literal(true, { error: "Gönderimi onaylamalısınız" }),
  iysConfirmed: z.literal(true, { error: "İYS kaydını onaylamalısınız" }),
});

/** Kampanyalar: yapay zekâ müşteriye yalnızca buradaki aktif kampanyaları anlatır. */
@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @Roles("OWNER", "MANAGER", "RECEPTION")
  list(@CurrentTenant() t: TenantInfo) {
    return this.campaigns.list(t);
  }

  @Post()
  @Roles("OWNER", "MANAGER")
  create(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(schema)) b: z.infer<typeof schema>) {
    return this.campaigns.create(t, b);
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER")
  update(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(schema.partial())) b: Partial<z.infer<typeof schema>>) {
    return this.campaigns.update(t, id, b);
  }

  @Get(":id/audience")
  @Roles("OWNER", "MANAGER")
  audience(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.audience(t, id);
  }

  @Post(":id/broadcast")
  @HttpCode(200)
  @Roles("OWNER")
  broadcast(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(broadcastSchema)) _b: z.infer<typeof broadcastSchema>) {
    return this.campaigns.broadcast(t, id);
  }
}
