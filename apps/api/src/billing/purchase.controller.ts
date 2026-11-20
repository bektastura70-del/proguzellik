import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { passwordSchema } from "../auth/password";
import { RateLimitService } from "../auth/rate-limit.service";
import { Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { iyzicoCheckoutSchema } from "./billing.controller";
import { planCodeSchema } from "./plans";
import { PurchaseService } from "./purchase.service";

const requestSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string({ error: "Telefon numarası gerekli" }).trim().min(10, "Telefon numarası gerekli").max(30),
  password: passwordSchema,
  planCode: planCodeSchema,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  kvkkAccepted: z.literal(true, { error: "KVKK Aydınlatma Metni'ni okuduğunuzu onaylayın" }),
  termsAccepted: z.literal(true, { error: "Kullanım Koşulları'nı kabul edin" }),
  marketingConsent: z.boolean().optional(),
  hp: z.string().max(200).optional(),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});
const tokenSchema = z.object({ token: z.string().min(20).max(200) });
const checkoutSchema = iyzicoCheckoutSchema.pick({ billing: true, acceptedTerms: true, acceptedRenewal: true, acceptedInstantPerformance: true, termsVersion: true }).extend({ token: z.string().min(20).max(200) });

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

/** Siteden denemesiz doğrudan paket satın alma (herkese açık; bayrakla açılır). */
@Controller("purchase")
export class PurchaseController {
  constructor(
    private readonly purchase: PurchaseService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get("status")
  status() {
    return this.purchase.status();
  }

  @Public()
  @Post()
  @HttpCode(202)
  async request(@Body() raw: unknown, @Req() req: Request) {
    this.rateLimit.hit(`purchase:${req.ip}`, 10, 60 * 60_000);
    const body = new ZodPipe(requestSchema).transform(raw);
    this.rateLimit.hit(`purchase-email:${body.email.toLowerCase()}`, 3, 60 * 60_000);
    return this.purchase.request(body, meta(req));
  }

  /** Belirteç gövdede gönderilir (erişim günlüklerine düşmesin). */
  @Public()
  @Post("verify")
  @HttpCode(200)
  verify(@Body(new ZodPipe(tokenSchema)) b: z.infer<typeof tokenSchema>, @Req() req: Request) {
    this.rateLimit.hit(`purchase-verify:${req.ip}`, 30, 60 * 60_000);
    return this.purchase.verify(b.token, meta(req));
  }

  @Public()
  @Post("checkout")
  @HttpCode(200)
  checkout(@Body(new ZodPipe(checkoutSchema)) b: z.infer<typeof checkoutSchema>, @Req() req: Request) {
    this.rateLimit.hit(`purchase-checkout:${req.ip}`, 20, 60 * 60_000);
    return this.purchase.checkout(b.token, b.billing, b.termsVersion, meta(req));
  }
}
