import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, Res, StreamableFile } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { RateLimitService } from "../auth/rate-limit.service";
import { Public } from "../common/decorators";
import { phoneSchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { BrandingService } from "./branding.service";
import { endpointSchema, subscriptionSchema } from "./business.controller";
import { PushSubscriptionsService } from "./push-subscriptions.service";
import { CustomerAuthService } from "./customer-auth.service";
import { PortalService } from "./portal.service";

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const emailSchema = z.object({ email: z.string().trim().email().max(200) });
const verifySchema = z.object({ email: z.string().trim().email().max(200), code: z.string().regex(/^\d{6}$/, "6 haneli kod girin") });
const bookingSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  notes: z.string().max(500).optional(),
  kvkkConsent: z.literal(true, { error: "KVKK aydınlatma metni onaylanmalı" }),
  marketingConsent: z.boolean().optional(),
});
const rescheduleSchema = z.object({ startsAt: z.string().datetime({ offset: true }), staffId: z.string().uuid().optional() });
const prefsSchema = z.object({ notifyAppointments: z.boolean().optional(), notifyReminders: z.boolean().optional() });
const deleteSchema = z.object({ code: z.string().regex(/^\d{6}$/, "6 haneli kod girin") });
const idemSchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();

/** Müşteri oturum belirteci yalnızca web vekilinden (httpOnly çerez → başlık) gelir; tarayıcı JS'i görmez. */
const SESSION_HEADER = "x-customer-session";

@Public()
@Controller("public/salons/:slug")
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly auth: CustomerAuthService,
    private readonly rateLimit: RateLimitService,
    private readonly branding: BrandingService,
    private readonly push: PushSubscriptionsService,
  ) {}

  /** Müşteri cihazı push aboneliği: yalnızca giriş yapmış kimlik, yalnızca bu salon için. */
  @Post("portal/push/subscriptions")
  subscribePush(
    @Param("slug", new ZodPipe(slug)) s: string,
    @Body(new ZodPipe(subscriptionSchema)) b: z.infer<typeof subscriptionSchema>,
    @Req() req: Request,
    @Headers(SESSION_HEADER) token?: string,
  ) {
    this.rateLimit.hit(`push-sub:${req.ip}`, 30, 60 * 60_000);
    return this.portal.withIdentity(s, token, (tx, me, { pwa }) => {
      if (!PushSubscriptionsService.pushAvailable(pwa, "CUSTOMER")) throw new NotFoundException("Anlık bildirimler bu salonda açık değil");
      return this.push.subscribeInTx(tx, me.tenantId, { audience: "CUSTOMER", identityId: me.identityId }, b, req.headers["user-agent"]);
    });
  }

  @Delete("portal/push/subscriptions")
  unsubscribePush(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(endpointSchema)) b: z.infer<typeof endpointSchema>, @Headers(SESSION_HEADER) token?: string) {
    return this.portal.withIdentity(s, token, (tx, me) => this.push.unsubscribeInTx(tx, me.tenantId, { audience: "CUSTOMER", identityId: me.identityId }, b.endpoint));
  }

  /** Salonun logo/simgesi. Kimlik numarasıyla adreslenir (içerik değişirse yeni numara), bu yüzden uzun süre önbelleklenebilir. */
  @Get("assets/:id")
  async asset(@Param("slug", new ZodPipe(slug)) s: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.rateLimit.hit(`public:${req.ip}`, 300, 60_000);
    const a = await this.branding.publicAsset(s, id);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("ETag", `"${a.sha256}"`);
    return new StreamableFile(Buffer.from(a.bytes));
  }

  @Get("app")
  app(@Param("slug", new ZodPipe(slug)) s: string, @Req() req: Request) {
    this.rateLimit.hit(`public:${req.ip}`, 300, 60_000);
    return this.portal.appInfo(s);
  }

  @Post("portal/otp")
  @HttpCode(202)
  async requestOtp(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(emailSchema)) b: z.infer<typeof emailSchema>, @Req() req: Request) {
    const { tenant } = await this.portal.portalTenant(s);
    return this.auth.requestCode(tenant, b.email, req.ip);
  }

  @Post("portal/verify")
  @HttpCode(200)
  async verify(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(verifySchema)) b: z.infer<typeof verifySchema>, @Req() req: Request) {
    const { tenant } = await this.portal.portalTenant(s);
    return this.auth.verifyCode(tenant.id, b.email, b.code, { ip: req.ip, userAgent: req.headers["user-agent"] });
  }

  @Post("portal/logout")
  @HttpCode(200)
  async logout(@Param("slug", new ZodPipe(slug)) s: string, @Headers(SESSION_HEADER) token?: string) {
    const { tenant } = await this.portal.portalTenant(s);
    return this.auth.logout(tenant.id, token);
  }

  @Get("portal/me")
  me(@Param("slug", new ZodPipe(slug)) s: string, @Headers(SESSION_HEADER) token?: string) {
    return this.portal.me(s, token);
  }

  @Patch("portal/me")
  prefs(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(prefsSchema)) b: z.infer<typeof prefsSchema>, @Headers(SESSION_HEADER) token?: string) {
    return this.portal.updatePreferences(s, token, b);
  }

  /** Hesabı silme: önce POST portal/otp ile yeni kod istenir, sonra bu uca kod gönderilir. */
  @Post("portal/me/delete")
  @HttpCode(200)
  async deleteMe(@Param("slug", new ZodPipe(slug)) s: string, @Body(new ZodPipe(deleteSchema)) b: z.infer<typeof deleteSchema>, @Req() req: Request, @Headers(SESSION_HEADER) token?: string) {
    const { tenant } = await this.portal.portalTenant(s);
    return this.auth.deleteIdentity(tenant.id, token, b.code, { ip: req.ip });
  }

  @Get("portal/appointments")
  list(@Param("slug", new ZodPipe(slug)) s: string, @Headers(SESSION_HEADER) token?: string) {
    return this.portal.appointmentsList(s, token);
  }

  @Post("portal/bookings")
  book(
    @Param("slug", new ZodPipe(slug)) s: string,
    @Body(new ZodPipe(bookingSchema)) b: z.infer<typeof bookingSchema>,
    @Headers("idempotency-key") idemRaw: string | undefined,
    @Req() req: Request,
    @Headers(SESSION_HEADER) token?: string,
  ) {
    this.rateLimit.hit(`portal-booking-ip:${req.ip}`, 20, 60 * 60_000);
    const idem = new ZodPipe(idemSchema).transform(idemRaw) as string | undefined;
    return this.portal.book(s, token, idem, b, req.ip);
  }

  @Post("portal/appointments/:id/cancel")
  @HttpCode(200)
  cancel(@Param("slug", new ZodPipe(slug)) s: string, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Headers(SESSION_HEADER) token?: string) {
    this.rateLimit.hit(`portal-change-ip:${req.ip}`, 30, 60 * 60_000);
    return this.portal.cancel(s, token, id, req.ip);
  }

  @Post("portal/appointments/:id/reschedule")
  @HttpCode(200)
  reschedule(
    @Param("slug", new ZodPipe(slug)) s: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rescheduleSchema)) b: z.infer<typeof rescheduleSchema>,
    @Req() req: Request,
    @Headers(SESSION_HEADER) token?: string,
  ) {
    this.rateLimit.hit(`portal-change-ip:${req.ip}`, 30, 60 * 60_000);
    return this.portal.reschedule(s, token, id, b, req.ip);
  }

  @Get("portal/packages")
  packages(@Param("slug", new ZodPipe(slug)) s: string, @Headers(SESSION_HEADER) token?: string) {
    return this.portal.packages(s, token);
  }
}
