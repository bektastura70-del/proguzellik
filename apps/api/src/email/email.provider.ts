import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createTransport, Transporter } from "nodemailer";
import { loadEnv } from "../config/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export abstract class EmailProvider {
  abstract readonly name: string;
  /** Test sağlayıcısında gövde kayda yazılır; gerçek sağlayıcıda yazılmaz (belirteç sızıntısını önler). */
  abstract readonly storesBody: boolean;
  abstract send(msg: EmailMessage): Promise<{ messageId: string }>;
}

/** GERÇEK E-POSTA GÖNDERMEZ. Mesajlar bellekte ve OutboundEmail tablosunda tutulur. */
@Injectable()
export class MockEmailProvider extends EmailProvider {
  readonly name = "mock";
  readonly storesBody = true;
  readonly outbox: (EmailMessage & { messageId: string })[] = [];
  private readonly logger = new Logger("MockEmail");

  async send(msg: EmailMessage) {
    if (msg.to.endsWith("@fail.test")) throw new Error("Test: e-posta reddedildi");
    const messageId = `mock-${randomUUID()}`;
    this.outbox.push({ ...msg, messageId });
    this.logger.log(`[TEST – gönderilmedi] ${msg.to}: ${msg.subject}`);
    return { messageId };
  }
}

/** SMTP (ör. Postmark, SES, Mailgun SMTP veya yerelde Mailpit). Yalnızca EMAIL_MODE=smtp ile açılır. */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  readonly name = "smtp";
  readonly storesBody = false;
  private transport?: Transporter;

  async send(msg: EmailMessage) {
    const env = loadEnv();
    if (!env.SMTP_URL) throw new Error("SMTP_URL tanımlı değil");
    this.transport ??= createTransport(env.SMTP_URL);
    const info = await this.transport.sendMail({ from: env.EMAIL_FROM, ...msg });
    return { messageId: String(info.messageId) };
  }
}
