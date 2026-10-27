import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailProvider } from "./email.provider";
import { EmailTemplate, render } from "./templates";

@Injectable()
export class EmailService {
  private readonly logger = new Logger("EmailService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EmailProvider,
  ) {}

  /**
   * E-posta gönderir ve kaydeder. dedupeKey verilirse aynı anahtarla ikinci gönderim yapılmaz
   * (zamanlanmış görevlerin tekrar çalışmasına dayanıklılık için).
   */
  async send(to: string, tpl: EmailTemplate, opts: { dedupeKey?: string } = {}) {
    const { subject, html, text } = render(tpl);
    let rec;
    try {
      rec = await this.prisma.platform.outboundEmail.create({
        data: { to, template: tpl.name, subject, body: this.provider.storesBody ? text : null, status: "QUEUED", provider: this.provider.name, dedupeKey: opts.dedupeKey },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { skipped: true as const };
      throw e;
    }
    try {
      const { messageId } = await this.provider.send({ to, subject, html, text });
      await this.prisma.platform.outboundEmail.update({ where: { id: rec.id }, data: { status: "SENT", providerMessageId: messageId, sentAt: new Date() } });
      return { sent: true as const, id: rec.id };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      this.logger.warn(`E-posta gönderilemedi (${tpl.name} → ${to}): ${msg}`);
      await this.prisma.platform.outboundEmail.update({ where: { id: rec.id }, data: { status: "FAILED", error: msg } });
      return { failed: true as const, id: rec.id };
    }
  }
}
