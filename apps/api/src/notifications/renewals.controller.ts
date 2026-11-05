import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { RateLimitService } from "../auth/rate-limit.service";
import { CurrentTenant, Public, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { loadEnv, renewalRemindersOn } from "../config/env";
import { RenewalService } from "./renewal.service";

const listSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const optOutSchema = z.object({ token: z.string().min(80).max(200) });

/** Salon paneli: "Yenilenmesi yaklaşan müşteriler". Özellik ortamda kapalıysa yoktur (404). */
@Controller("renewals")
export class RenewalsController {
  constructor(private readonly renewal: RenewalService) {}

  @Get()
  @Roles("OWNER", "MANAGER", "RECEPTION")
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    if (!renewalRemindersOn(loadEnv())) throw new NotFoundException("Bu özellik açık değil");
    return this.renewal.list(t, q.days);
  }
}

/** E-postadaki "hatırlatmaları kapat" bağlantısı (oturum gerekmez, imzalı belirteç). Özellik kapalıyken de çalışır. */
@Public()
@Controller("public/renewal-reminders")
export class RenewalOptOutController {
  constructor(
    private readonly renewal: RenewalService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post("opt-out")
  @HttpCode(200)
  optOut(@Body(new ZodPipe(optOutSchema)) b: z.infer<typeof optOutSchema>, @Req() req: Request) {
    this.rateLimit.hit(`renewal-optout:${req.ip}`, 30, 60_000);
    return this.renewal.optOut(b.token);
  }
}
