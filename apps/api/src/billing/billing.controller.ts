import { Body, Controller, Get, Headers, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { AllowInactive, CurrentTenant, Public, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { planCodeSchema } from "./plans";
import { SubscriptionsService } from "./subscriptions.service";
import { IyzicoBillingService, WebhookBody } from "./iyzico/iyzico-billing.service";

const checkoutSchema = z.object({
  planCode: planCodeSchema,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  paymentToken: z.string().min(3).max(200),
});

export const iyzicoCheckoutSchema = z.object({
  planCode: planCodeSchema,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  billing: z.object({
    fullName: z.string().trim().min(3).max(100),
    // iyzico TCKN ister; şirketlerde VKN (10 hane) de kabul edilir.
    identityNumber: z.string().trim().regex(/^\d{10,11}$/, { error: "T.C. kimlik no (11 hane) veya vergi no (10 hane) girin" }),
    gsmNumber: z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/, { error: "Geçerli bir cep telefonu girin" }),
    city: z.string().trim().min(2).max(50),
    address: z.string().trim().min(5).max(300),
  }),
  acceptedTerms: z.literal(true, { error: "Ön Bilgilendirme Formu, Mesafeli Satış Sözleşmesi ve Teslimat ve İade Şartları onaylanmalı" }),
  acceptedRenewal: z.literal(true, { error: "Otomatik yenilemeye onay verilmeli" }),
  acceptedInstantPerformance: z.literal(true, { error: "Hizmetin hemen başlamasına (cayma hakkı bulunmadığına) onay verilmeli" }),
  termsVersion: z.string().trim().min(1).max(40),
});

const iyzicoCallbackSchema = z.object({ token: z.string().min(10).max(200) });

@Controller()
export class BillingController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly iyzico: IyzicoBillingService,
  ) {}

  @Public()
  @Get("plans")
  plans() {
    return this.subs.plans();
  }

  /** Tanıtım sitesi için yalnızca SaaS sahibinin girdiği herkese açık bilgiler (girilmeyen alan null döner). */
  @Public()
  @Get("public/site")
  site() {
    return this.subs.publicSite();
  }

  @Get("subscription")
  @AllowInactive()
  @Roles("OWNER", "MANAGER")
  current(@CurrentTenant() t: TenantInfo) {
    return this.subs.current(t);
  }

  @Post("subscription/checkout")
  @AllowInactive()
  @Roles("OWNER")
  checkout(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(checkoutSchema)) b: z.infer<typeof checkoutSchema>) {
    return this.subs.checkout(t, b);
  }

  @Post("subscription/cancel")
  @HttpCode(200)
  @Roles("OWNER")
  cancel(@CurrentTenant() t: TenantInfo) {
    return this.subs.cancel(t);
  }

  /** iyzico ödeme formunu başlatır; yanıt iyzico'nun form içeriğidir (kart bilgisi iyzico'da girilir). */
  @Post("subscription/iyzico/checkout")
  @AllowInactive()
  @Roles("OWNER")
  iyzicoCheckout(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(iyzicoCheckoutSchema)) b: z.infer<typeof iyzicoCheckoutSchema>) {
    return this.iyzico.startCheckout(t, b);
  }

  /** Ödeme formundan dönüş (web sunucusu iletir). Sonuç iyzico API'sinden doğrulanır. */
  @Public()
  @Post("billing/iyzico/callback")
  @HttpCode(200)
  iyzicoCallback(@Body(new ZodPipe(iyzicoCallbackSchema)) b: z.infer<typeof iyzicoCallbackSchema>) {
    return this.iyzico.completeCallback(b.token);
  }

  /** iyzico abonelik bildirimi (X-IYZ-SIGNATURE-V3 ile imzalı). */
  @Public()
  @Post("billing/iyzico/webhook")
  @HttpCode(200)
  iyzicoWebhook(@Body() b: WebhookBody, @Headers("x-iyz-signature-v3") signature?: string) {
    return this.iyzico.handleWebhook(b ?? {}, signature);
  }
}
