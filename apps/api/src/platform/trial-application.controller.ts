import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { RateLimitService } from "../auth/rate-limit.service";
import { planCodeSchema } from "../billing/plans";
import { AuthUser, CurrentUser, PlatformAdmin, Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { loadEnv, trialApplicationsEnabled } from "../config/env";
import { DEFAULT_TRIAL_DAYS } from "./tenant-admin.service";
import { TrialApplicationService } from "./trial-application.service";

const applicationSchema = z.object({
  businessName: z.string().trim().min(2, "Salon adı en az 2 karakter olmalı").max(120),
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı").max(120),
  email: z.string().trim().email("Geçerli bir e-posta girin").max(200),
  phone: z.string({ error: "Telefon numarası gerekli" }).trim().min(10, "Telefon numarası gerekli").max(30),
  city: z.string().trim().max(60).optional(),
  staffCount: z.number().int().min(1, "Personel sayısı en az 1").max(500, "Personel sayısı en fazla 500").optional(),
  planCode: planCodeSchema.optional(),
  note: z.string().trim().max(1000, "Not en fazla 1000 karakter olabilir").optional(),
  kvkkAccepted: z.literal(true, { error: "KVKK Aydınlatma Metni'ni okuduğunuzu onaylayın" }),
  termsAccepted: z.literal(true, { error: "Kullanım Koşulları'nı kabul edin" }),
  marketingConsent: z.boolean().optional(),
  hp: z.string().max(200).optional(),
});
const tokenSchema = z.object({ token: z.string().min(20).max(200) });
const listSchema = z.object({
  status: z.enum(["UNVERIFIED", "PENDING", "APPROVED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const approveSchema = z.object({
  name: z.string().trim().min(2, "İşletme adı en az 2 karakter olmalı").max(120),
  ownerName: z.string().trim().min(2, "Sahip adı en az 2 karakter olmalı").max(120),
  ownerEmail: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin").max(200),
  phone: z.string().trim().max(30).optional(),
  planCode: planCodeSchema.default("PROFESSIONAL"),
  trialDays: z.number().int().min(1, "Deneme süresi en az 1 gün").max(60, "Deneme süresi en fazla 60 gün").default(DEFAULT_TRIAL_DAYS),
  ignoreWarnings: z.boolean().optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe girin").max(300) });

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

/** Herkese açık deneme başvurusu (kayıt kapalıyken, TRIAL_APPLICATIONS_ENABLED ile). */
@Controller("auth/trial-applications")
export class PublicTrialApplicationController {
  constructor(
    private readonly apps: TrialApplicationService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post()
  @HttpCode(202)
  submit(@Body() raw: unknown, @Req() req: Request) {
    // Kapalıyken gövde doğrulanmadan reddedilir.
    if (!trialApplicationsEnabled(loadEnv())) throw new ForbiddenException("Deneme başvurusu şu anda kapalı");
    this.rateLimit.hit(`trial-app:${req.ip}`, 5, 60 * 60_000);
    const body = new ZodPipe(applicationSchema).transform(raw);
    this.rateLimit.hit(`trial-app-email:${body.email.toLowerCase()}`, 3, 60 * 60_000);
    return this.apps.submit(body, meta(req));
  }

  /** Belirteç URL'de değil gövdede gönderilir (erişim günlüklerine düşmesin). */
  @Public()
  @Post("verify")
  @HttpCode(200)
  verify(@Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>, @Req() req: Request) {
    if (!trialApplicationsEnabled(loadEnv())) throw new ForbiddenException("Deneme başvurusu şu anda kapalı");
    this.rateLimit.hit(`trial-app-verify:${req.ip}`, 20, 60 * 60_000);
    return this.apps.verify(body.token, meta(req));
  }
}

/** SaaS sahibi: başvuruları görür, onaylar ya da reddeder. Bayrak kapalıyken de mevcut başvurular yönetilebilir. */
@PlatformAdmin()
@Controller("platform/trial-applications")
export class PlatformTrialApplicationController {
  constructor(private readonly apps: TrialApplicationService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.apps.list(q.status, q.page);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.apps.get(id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(approveSchema)) b: z.infer<typeof approveSchema>, @Req() req: Request) {
    return this.apps.approve(id, u.id, b, req.ip);
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) b: z.infer<typeof rejectSchema>, @Req() req: Request) {
    return this.apps.reject(id, u.id, b.reason, req.ip);
  }
}
