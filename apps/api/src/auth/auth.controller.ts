import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const passwordSchema = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı")
  .max(200)
  .regex(/[A-Za-zÇĞİÖŞÜçğıöşü]/, "Parola harf içermeli")
  .regex(/[0-9]/, "Parola rakam içermeli");

const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  password: passwordSchema,
  phone: z.string().trim().max(30).optional(),
  planCode: z.enum(["STARTER", "PROFESSIONAL", "SMART"]).optional(),
  kvkkAccepted: z.literal(true, { errorMap: () => ({ message: "KVKK aydınlatma metni onaylanmalı" }) }),
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    // IP başına genel sınır + IP/e-posta çifti başına daha sıkı sınır.
    this.rateLimit.hit(`login-ip:${req.ip}`, 100, 15 * 60_000);
    this.rateLimit.hit(`login:${req.ip}:${body.email.toLowerCase()}`, 10, 15 * 60_000);
    return this.auth.login(body.email, body.password, req.ip);
  }

  @Public()
  @Post("register")
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: Request) {
    this.rateLimit.hit(`register:${req.ip}`, 10, 60 * 60_000);
    return this.auth.registerBusiness(body);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @Post("change-password")
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>,
    @Req() req: Request,
  ) {
    this.rateLimit.hit(`pw:${user.id}`, 10, 15 * 60_000);
    return this.auth.changePassword(user.id, body.currentPassword, body.newPassword, req.ip);
  }
}
