import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { AuthUser, CurrentTenant, CurrentUser, PlatformAdmin, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AiQuotaService } from "./ai-quota.service";

/** Salon paneli: yalnız yaklaşık yüzde ve durum. Para/birim dönmez. */
@Controller("ai-quota")
export class AiQuotaController {
  constructor(private readonly quota: AiQuotaService) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  status(@CurrentTenant() t: TenantInfo) {
    return this.quota.status(t.tenantId);
  }
}

const settingsSchema = z.object({
  usdTry: z.number().min(1).max(10_000),
  fxBuffer: z.number().min(1).max(2),
  // Çarpan 1'in altına inemez: aksi hâlde salonun gördüğü değerden fazla harcama yapılır.
  markup: z.number().min(1).max(20),
  creditRatio: z.number().min(0.05).max(1),
  trialCreditKurus: z.number().int().min(0).max(1_000_000),
  tenantDailyMaxUsd: z.number().min(0.01).max(1000),
  conversationMaxTokens: z.number().int().min(10_000).max(5_000_000),
});

/** SaaS sahibi: gerçek maliyet ve kullanım; fiyatlandırma ayarları. */
@PlatformAdmin()
@Controller("platform/ai")
export class PlatformAiController {
  constructor(private readonly quota: AiQuotaService) {}

  @Get()
  overview() {
    return this.quota.overview();
  }

  @Put("settings")
  settings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.quota.updateSettings(b, u.id);
  }
}
