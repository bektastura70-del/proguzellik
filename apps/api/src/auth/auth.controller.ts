import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { loadEnv, registrationEnabled } from "../config/env";
import { AuthService, ClientMeta } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";
import { SessionService } from "./session.service";

import { passwordSchema } from "./password";

export { passwordSchema };

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });
const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  password: passwordSchema,
  phone: z.string().trim().max(30).optional(),
  planCode: z.enum(["STARTER", "PROFESSIONAL", "SMART"]).optional(),
  kvkkAccepted: z.literal(true, { error: "KVKK aydınlatma metni onaylanmalı" }),
});
const forgotSchema = z.object({ email: z.string().email().max(200) });
const tokenSchema = z.string().min(20).max(200);
const resetSchema = z.object({ token: tokenSchema, newPassword: passwordSchema });
const verifySchema = z.object({ token: tokenSchema });
const acceptInviteSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1).max(200),
  kvkkAccepted: z.literal(true, { error: "KVKK aydınlatma metni onaylanmalı" }),
});
const mfaVerifySchema = z
  .object({ mfaToken: z.string().min(10).max(2000), code: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(8).max(20).optional() })
  .refine((v) => !!v.code !== !!v.recoveryCode, "Doğrulama kodu veya kurtarma kodu girin");
const passwordOnly = z.object({ password: z.string().min(1).max(200) });
const codeOnly = z.object({ code: z.string().regex(/^\d{6}$/, "6 haneli kod girin") });
const passwordAndCode = z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/, "6 haneli kod girin") });

const meta = (req: Request): ClientMeta => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    this.rateLimit.hit(`login-ip:${req.ip}`, 100, 15 * 60_000);
    this.rateLimit.hit(`login:${req.ip}:${body.email.toLowerCase()}`, 10, 15 * 60_000);
    return this.auth.login(body.email, body.password, meta(req));
  }

  @Public()
  @Post("mfa/verify")
  @HttpCode(200)
  mfaVerify(@Body(new ZodPipe(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>, @Req() req: Request) {
    this.rateLimit.hit(`mfa:${req.ip}`, 20, 15 * 60_000);
    return this.auth.verifyMfa(body.mfaToken, body, meta(req));
  }

  /** Web kayıt sayfası bu bilgiyle formu gösterir ya da "kayıtlar kapalı" mesajı verir. */
  @Public()
  @Get("registration")
  registration() {
    return { enabled: registrationEnabled(loadEnv()) };
  }

  @Public()
  @Post("register")
  register(@Body() raw: unknown, @Req() req: Request) {
    // Kayıt kapalıyken gövde doğrulanmadan reddedilir (gövde ne olursa olsun 403).
    if (!registrationEnabled(loadEnv())) throw new ForbiddenException("Yeni işletme kaydı şu anda kapalı");
    const body = new ZodPipe(registerSchema).transform(raw);
    this.rateLimit.hit(`register:${req.ip}`, 10, 60 * 60_000);
    return this.auth.registerBusiness(body, meta(req));
  }

  /** Belirteç URL'de değil gövdede gönderilir (erişim günlüklerine düşmesin). */
  @Public()
  @Post("invite/preview")
  @HttpCode(200)
  invitePreview(@Body(new ZodPipe(verifySchema)) body: z.infer<typeof verifySchema>, @Req() req: Request) {
    this.rateLimit.hit(`invite:${req.ip}`, 30, 60 * 60_000);
    return this.auth.previewInvite(body.token);
  }

  @Public()
  @Post("accept-invite")
  @HttpCode(200)
  acceptInvite(@Body(new ZodPipe(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>, @Req() req: Request) {
    this.rateLimit.hit(`invite:${req.ip}`, 30, 60 * 60_000);
    return this.auth.acceptInvite(body.token, body.password, meta(req));
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() req: Request) {
    this.rateLimit.hit(`forgot-ip:${req.ip}`, 10, 60 * 60_000);
    this.rateLimit.hit(`forgot:${body.email.toLowerCase()}`, 3, 60 * 60_000);
    return this.auth.forgotPassword(body.email, req.ip);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  reset(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Req() req: Request) {
    this.rateLimit.hit(`reset:${req.ip}`, 20, 60 * 60_000);
    return this.auth.resetPassword(body.token, body.newPassword, req.ip);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(200)
  verifyEmail(@Body(new ZodPipe(verifySchema)) body: z.infer<typeof verifySchema>, @Req() req: Request) {
    this.rateLimit.hit(`verify:${req.ip}`, 30, 60 * 60_000);
    return this.auth.verifyEmail(body.token);
  }

  @Post("resend-verification")
  @HttpCode(200)
  resend(@CurrentUser() u: AuthUser) {
    this.rateLimit.hit(`resend:${u.id}`, 3, 60 * 60_000);
    return this.auth.sendVerification(u.id);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @Post("change-password")
  @HttpCode(200)
  changePassword(@CurrentUser() u: AuthUser, @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>, @Req() req: Request) {
    this.rateLimit.hit(`pw:${u.id}`, 10, 15 * 60_000);
    return this.auth.changePassword(u.id, u.sessionId, body.currentPassword, body.newPassword, req.ip);
  }

  /* -------- Oturumlar -------- */
  @Get("sessions")
  async listSessions(@CurrentUser() u: AuthUser) {
    const list = await this.sessions.list(u.id);
    return list.map((s) => ({ ...s, current: s.id === u.sessionId }));
  }

  @Delete("sessions/:id")
  revokeSession(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.sessions.revoke(u.id, id);
  }

  @Post("logout")
  @HttpCode(200)
  logout(@CurrentUser() u: AuthUser) {
    return this.sessions.revoke(u.id, u.sessionId);
  }

  @Post("logout-others")
  @HttpCode(200)
  logoutOthers(@CurrentUser() u: AuthUser) {
    return this.sessions.revokeAll(u.id, u.sessionId);
  }

  /* -------- İki adımlı doğrulama -------- */
  @Post("mfa/setup")
  @HttpCode(200)
  mfaSetup(@CurrentUser() u: AuthUser, @Body(new ZodPipe(passwordOnly)) b: z.infer<typeof passwordOnly>) {
    this.rateLimit.hit(`mfa-setup:${u.id}`, 10, 15 * 60_000);
    return this.auth.mfaSetup(u.id, b.password);
  }

  @Post("mfa/enable")
  @HttpCode(200)
  mfaEnable(@CurrentUser() u: AuthUser, @Body(new ZodPipe(codeOnly)) b: z.infer<typeof codeOnly>) {
    this.rateLimit.hit(`mfa-enable:${u.id}`, 10, 15 * 60_000);
    return this.auth.mfaEnable(u.id, u.sessionId, b.code);
  }

  @Post("mfa/disable")
  @HttpCode(200)
  mfaDisable(@CurrentUser() u: AuthUser, @Body(new ZodPipe(passwordAndCode)) b: z.infer<typeof passwordAndCode>) {
    this.rateLimit.hit(`mfa-disable:${u.id}`, 10, 15 * 60_000);
    return this.auth.mfaDisable(u.id, b.password, b.code);
  }

  @Post("mfa/recovery-codes")
  @HttpCode(200)
  regenerate(@CurrentUser() u: AuthUser, @Body(new ZodPipe(passwordAndCode)) b: z.infer<typeof passwordAndCode>) {
    this.rateLimit.hit(`mfa-rc:${u.id}`, 5, 15 * 60_000);
    return this.auth.regenerateRecoveryCodes(u.id, b.password, b.code);
  }
}
