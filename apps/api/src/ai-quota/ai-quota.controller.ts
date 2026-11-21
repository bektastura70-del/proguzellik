import { FxRateService } from "./fx-rate.service";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { z } from "zod";
import { AuthUser, CurrentTenant, CurrentUser, PlatformAdmin, Public, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AiQuotaService } from "./ai-quota.service";
import { AiTopupService, TOPUP_MAX, TOPUP_MIN } from "./ai-topup.service";

const amountSchema = z.coerce.number().int().min(TOPUP_MIN).max(TOPUP_MAX);
const topupSchema = z.object({
  amount: amountSchema,
  billing: z.object({
    fullName: z.string().trim().min(3).max(100),
    identityNumber: z.string().trim().regex(/^\d{10,11}$/, { error: "T.C. kimlik no (11 hane) veya vergi no (10 hane) girin" }),
    gsmNumber: z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/, { error: "Geçerli bir cep telefonu girin" }),
    city: z.string().trim().min(2).max(50),
    address: z.string().trim().min(5).max(300),
  }),
  acceptedTerms: z.literal(true, { error: "Ön bilgilendirme ve satış koşulları onaylanmalı" }),
  acceptedInstantPerformance: z.literal(true, { error: "Hizmetin hemen başlamasına onay verilmeli" }),
  termsVersion: z.string().trim().min(1).max(40),
});
const callbackSchema = z.object({ token: z.string().min(10).max(200) });
const ipOf = (req: Request) => (req.ip ?? "127.0.0.1").replace(/^::ffff:/, "");

/** Salon paneli: yalnız yaklaşık yüzde ve durum. Para/birim dönmez. */
@Controller("ai-quota")
export class AiQuotaController {
  constructor(
    private readonly quota: AiQuotaService,
    private readonly topup: AiTopupService,
  ) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  status(@CurrentTenant() t: TenantInfo) {
    return this.quota.status(t.tenantId);
  }

  /** Ek paket ekranı: tutarlar, KDV dökümü ve birimsiz etki. */
  @Get("topup")
  @Roles("OWNER", "MANAGER")
  options(@CurrentTenant() t: TenantInfo) {
    return this.topup.options(t);
  }

  @Get("topup/quote")
  @Roles("OWNER", "MANAGER")
  quote(@CurrentTenant() t: TenantInfo, @Query("amount", new ZodPipe(amountSchema)) amount: number) {
    return this.topup.quote(t, amount);
  }

  /** iyzico ödeme formunu başlatır (kart bilgisi iyzico'da girilir). */
  @Post("topup/checkout")
  @Roles("OWNER")
  checkout(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(topupSchema)) b: z.infer<typeof topupSchema>, @Req() req: Request) {
    return this.topup.startCheckout(t, b, ipOf(req));
  }
}

/** Ödeme formundan dönüş (web sunucusu iletir). Sonuç iyzico API'sinden doğrulanır. */
@Controller("billing/iyzico")
export class AiTopupCallbackController {
  constructor(private readonly topup: AiTopupService) {}

  @Public()
  @Post("ai-callback")
  @HttpCode(200)
  callback(@Body(new ZodPipe(callbackSchema)) b: z.infer<typeof callbackSchema>) {
    return this.topup.completeCallback(b.token);
  }
}

const settingsSchema = z.object({
  usdTry: z.number().min(1).max(10_000),
  fxAuto: z.boolean().optional(),
  fxBuffer: z.number().min(1).max(2),
  // Çarpan 1'in altına inemez: aksi hâlde salonun gördüğü değerden fazla harcama yapılır.
  markup: z.number().min(1).max(20),
  creditRatio: z.number().min(0.05).max(1),
  trialCreditKurus: z.number().int().min(0).max(1_000_000),
  tenantDailyMaxUsd: z.number().min(0.01).max(1000),
  conversationMaxTokens: z.number().int().min(10_000).max(5_000_000),
});

const refundSchema = z.object({ amount: z.number().positive().max(1_000_000) });

/** SaaS sahibi: gerçek maliyet ve kullanım; fiyatlandırma ayarları. */
@PlatformAdmin()
@Controller("platform/ai")
export class PlatformAiController {
  constructor(
    private readonly quota: AiQuotaService,
    private readonly topup: AiTopupService,
    private readonly fx: FxRateService,
  ) {}

  @Get("purchases")
  purchases() {
    return this.topup.purchases();
  }

  /** Para iadesi (iyzico) + iade oranında değerin cüzdandan geri alınması. */
  @Post("purchases/:id/refund")
  @HttpCode(200)
  refund(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Body(new ZodPipe(refundSchema)) b: z.infer<typeof refundSchema>, @Req() req: Request) {
    return this.topup.refund(id, b.amount, u.id, ipOf(req));
  }

  @Get()
  async overview() {
    const [o, fx] = await Promise.all([this.quota.overview(), this.fx.status()]);
    return { ...o, fx };
  }

  /** TCMB kurunu şimdi oku (ve otomatik açıksa uygula). */
  @Post("fx/refresh")
  @HttpCode(200)
  refreshFx(@CurrentUser() u: AuthUser) {
    return this.fx.refresh(new Date(), u.id);
  }

  @Put("settings")
  settings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.quota.updateSettings(b, u.id);
  }
}
