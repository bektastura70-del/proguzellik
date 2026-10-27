import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../config/env";

export type TemplateName = "randevu_onay" | "randevu_hatirlatma" | "randevu_iptal";

export interface TemplateMessage {
  to: string;
  template: TemplateName;
  params: string[];
  language?: string;
}

export abstract class WhatsAppProvider {
  abstract readonly name: string;
  abstract sendTemplate(msg: TemplateMessage): Promise<{ messageId: string }>;
}

/** Türkçe önizleme metinleri (Meta'da onaylanacak şablonların karşılığı). */
export function renderTemplate(template: TemplateName, p: string[]): string {
  switch (template) {
    case "randevu_onay":
      return `Merhaba ${p[0]}, ${p[1]} randevunuz oluşturuldu: ${p[2]} – ${p[3]} ${p[4]}. Görüşmek üzere!`;
    case "randevu_hatirlatma":
      return `Merhaba ${p[0]}, yarın ${p[3]} ${p[4]} saatinde ${p[1]} – ${p[2]} randevunuz var.`;
    case "randevu_iptal":
      return `Merhaba ${p[0]}, ${p[1]} – ${p[2]} (${p[3]} ${p[4]}) randevunuz iptal edildi.`;
  }
}

/** Yerel/test sağlayıcısı: HİÇBİR MESAJ GÖNDERMEZ, yalnızca bellekte tutar ve loglar. */
@Injectable()
export class MockWhatsAppProvider extends WhatsAppProvider {
  readonly name = "mock";
  readonly outbox: (TemplateMessage & { messageId: string; text: string })[] = [];
  private readonly logger = new Logger("MockWhatsApp");

  async sendTemplate(msg: TemplateMessage) {
    if (msg.to.endsWith("0000000000")) throw new Error("Test: geçersiz numara");
    const messageId = `wamid.mock.${randomUUID()}`;
    const text = renderTemplate(msg.template, msg.params);
    this.outbox.push({ ...msg, messageId, text });
    this.logger.log(`[TEST – gönderilmedi] ${msg.to}: ${text}`);
    return { messageId };
  }
}

/**
 * WhatsApp Cloud API (Meta Graph API) şablon mesajı gönderimi.
 * Yalnızca WHATSAPP_MODE=cloud ve gerçek kimlik bilgileri tanımlıysa kullanılır.
 */
@Injectable()
export class CloudWhatsAppProvider extends WhatsAppProvider {
  readonly name = "cloud";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    super();
  }

  /** Türkiye numaralarını E.164 biçimine getirir (0555... → 90555...). */
  static toE164(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("90")) return digits;
    if (digits.startsWith("0")) return `90${digits.slice(1)}`;
    if (digits.length === 10) return `90${digits}`;
    return digits;
  }

  async sendTemplate(msg: TemplateMessage) {
    const env = loadEnv();
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error("WhatsApp Cloud API yapılandırılmamış");
    }
    const res = await this.fetchImpl(
      `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: CloudWhatsAppProvider.toE164(msg.to),
          type: "template",
          template: {
            name: msg.template,
            language: { code: msg.language ?? "tr" },
            components: [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }],
          },
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !body.messages?.[0]?.id) {
      throw new Error(`WhatsApp API hatası (${res.status}): ${body.error?.message ?? "bilinmeyen"}`);
    }
    return { messageId: body.messages[0].id };
  }
}
