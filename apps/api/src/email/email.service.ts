import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { inviteDeliveryEnabled, loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { EmailProvider } from "./email.provider";
import { EmailTemplate, render, TEMPLATE_META, TemplateName } from "./templates";

export type SendResult = { sent: true; id: string } | { failed: true; id: string; code: "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED" } | { skipped: true };

@Injectable()
export class EmailService {
  private readonly logger = new Logger("EmailService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EmailProvider,
  ) {}

  /** Canlıda SMTP seçilmediyse (test sağlayıcısı) gerçek gönderim yoktur: gönderilmiş sayılmamalı. Davet akışıyla aynı kural. */
  get deliveryConfigured() {
    return inviteDeliveryEnabled(loadEnv());
  }

  private async override(name: TemplateName) {
    if (!TEMPLATE_META[name].editable) return null;
    return this.prisma.platform.emailTemplateOverride.findUnique({ where: { name } });
  }

  async preview(tpl: EmailTemplate, override?: { subject: string; body: string } | null) {
    return render(tpl, override === undefined ? await this.override(tpl.name) : override);
  }

  /**
   * E-posta gönderir ve kaydeder. dedupeKey verilirse aynı anahtarla ikinci gönderim yapılmaz
   * (zamanlanmış görevlerin tekrar çalışmasına dayanıklılık için).
   * Canlıda SMTP yoksa gönderim yapılmaz; kayıt "NOT_CONFIGURED" olur ve sonuç başarısızdır.
   */
  async send(to: string, tpl: EmailTemplate, opts: { dedupeKey?: string; tenantId?: string; actorId?: string } = {}): Promise<SendResult> {
    const { subject, html, text } = render(tpl, await this.override(tpl.name));
    const cleanSubject = subject.replace(/[\r\n]+/g, " ").slice(0, 200);
    // Gövde (bağlantı/belirteç içerebilir) yalnızca test sağlayıcısında ve canlı olmayan ortamda kaydedilir.
    const storeBody = this.provider.storesBody && loadEnv().NODE_ENV !== "production";
    const configured = this.deliveryConfigured;
    let rec;
    try {
      rec = await this.prisma.platform.outboundEmail.create({
        data: {
          to, template: tpl.name, subject: cleanSubject, body: storeBody ? text : null,
          status: configured ? "QUEUED" : "NOT_CONFIGURED", provider: this.provider.name, dedupeKey: opts.dedupeKey,
          error: configured ? null : "SMTP yapılandırılmadı; e-posta gönderilmedi",
          payload: TEMPLATE_META[tpl.name].secret ? Prisma.DbNull : (tpl.vars as Prisma.InputJsonValue),
          tenantId: opts.tenantId ?? null, actorId: opts.actorId ?? null, lastAttemptAt: new Date(),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { skipped: true as const };
      throw e;
    }
    if (!configured) return { failed: true as const, id: rec.id, code: "EMAIL_NOT_CONFIGURED" };
    return this.deliver(rec.id, to, cleanSubject, html, text, tpl.name);
  }

  private async deliver(id: string, to: string, subject: string, html: string, text: string, name: string): Promise<SendResult> {
    try {
      const { messageId } = await this.provider.send({ to, subject, html, text });
      await this.prisma.platform.outboundEmail.update({ where: { id }, data: { status: "SENT", providerMessageId: messageId, sentAt: new Date(), error: null } });
      return { sent: true as const, id };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      this.logger.warn(`E-posta gönderilemedi (${name} → ${to}): ${msg}`);
      await this.prisma.platform.outboundEmail.update({ where: { id }, data: { status: "FAILED", error: msg } });
      return { failed: true as const, id, code: "EMAIL_SEND_FAILED" };
    }
  }

  /** Başarısız ya da yapılandırma bekleyen e-postayı yeniden dener. Belirteçli e-postalar ilgili akıştan yeniden gönderilir. */
  async retry(id: string) {
    const rec = await this.prisma.platform.outboundEmail.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException("E-posta kaydı bulunamadı");
    if (rec.status === "SENT") throw new ConflictException("Bu e-posta zaten gönderildi");
    const meta = TEMPLATE_META[rec.template as TemplateName];
    if (!meta || meta.secret || rec.payload === null) {
      throw new ConflictException("Bu e-posta tek kullanımlık bağlantı içerir; davet/sıfırlama işleminden yeniden gönderin");
    }
    if (!this.deliveryConfigured) throw new ServiceUnavailableException({ message: "E-posta (SMTP) yapılandırılmadı; yeniden deneme yapılamaz.", code: "EMAIL_NOT_CONFIGURED" });
    const claimed = await this.prisma.platform.outboundEmail.updateMany({
      where: { id, status: { in: ["FAILED", "NOT_CONFIGURED"] } },
      data: { status: "QUEUED", attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException("E-posta şu an yeniden deneniyor ya da gönderildi");
    const tpl = { name: rec.template, vars: rec.payload } as EmailTemplate;
    const { subject, html, text } = render(tpl, await this.override(tpl.name));
    return this.deliver(id, rec.to, subject.replace(/[\r\n]+/g, " ").slice(0, 200), html, text, rec.template);
  }
}
