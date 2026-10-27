import { Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CurrentTenant, Public, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const STATUS_MAP = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const;

@Controller()
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("notifications")
  @RequiresFeature("WHATSAPP")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(z.object({ appointmentId: z.string().uuid().optional() }))) q: { appointmentId?: string }) {
    return this.prisma.withTenant(t, (tx) =>
      tx.notification.findMany({
        where: q.appointmentId ? { appointmentId: q.appointmentId } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  }

  /** Meta webhook doğrulaması (hub.challenge). */
  @Public()
  @Get("webhooks/whatsapp")
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    const expected = loadEnv().WHATSAPP_VERIFY_TOKEN;
    if (!expected) throw new ServiceUnavailableException("Webhook yapılandırılmamış");
    if (mode !== "subscribe" || !token || !safeEqual(token, expected)) throw new ForbiddenException();
    return challenge;
  }

  /** Mesaj durum güncellemeleri. X-Hub-Signature-256 imzası zorunludur. */
  @Public()
  @Post("webhooks/whatsapp")
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers("x-hub-signature-256") signature?: string) {
    const secret = loadEnv().WHATSAPP_APP_SECRET;
    if (!secret) throw new ServiceUnavailableException("Webhook yapılandırılmamış");
    const raw = req.rawBody;
    if (!raw || !signature) throw new ForbiddenException("İmza eksik");
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    if (!safeEqual(signature, expected)) throw new ForbiddenException("Geçersiz imza");

    const body = req.body as {
      entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string }[] }[] } }[] }[];
    };
    let updated = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const status = STATUS_MAP[s.status as keyof typeof STATUS_MAP];
          if (!status) continue;
          const r = await this.prisma.platform.notification.updateMany({
            where: { providerMessageId: s.id },
            data: { status, ...(status === "FAILED" ? { error: s.errors?.[0]?.title ?? "Teslim edilemedi" } : {}) },
          });
          updated += r.count;
        }
      }
    }
    return { received: true, updated };
  }
}
