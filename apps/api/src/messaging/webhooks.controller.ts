import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { Public } from "../common/decorators";
import { uuidParam } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { safeEqual } from "../security/crypto";
import { openSecret } from "./channels.service";

/**
 * İşletmeye özel Meta webhook adresi: /webhooks/meta/:connectionId
 * (web vekili üzerinden herkese açık: https://<alan>/api/webhooks/meta/:connectionId).
 */
@Controller("webhooks/meta")
export class MetaWebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  private async connection(id: string) {
    if (!uuidParam.test(id)) throw new NotFoundException();
    const c = await this.prisma.platform.channelConnection.findUnique({ where: { id } });
    if (!c || c.status === "DISABLED" || !c.verifyTokenEnc) throw new NotFoundException();
    return c;
  }

  /** Meta abonelik doğrulaması (hub.challenge). Belirteç bağlantıya özeldir. */
  @Public()
  @Get(":id")
  async verify(@Param("id") id: string, @Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    const c = await this.connection(id);
    if (mode !== "subscribe" || !token || !safeEqual(token, openSecret(c.verifyTokenEnc))) throw new ForbiddenException();
    await this.prisma.withTenant({ tenantId: c.tenantId, userId: "" }, (tx) =>
      tx.channelConnection.update({ where: { id: c.id }, data: { webhookVerifiedAt: new Date() } }),
    );
    return String(challenge ?? "");
  }
}
