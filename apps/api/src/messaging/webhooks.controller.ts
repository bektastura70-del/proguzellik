import { Controller, ForbiddenException, Get, Headers, HttpCode, Logger, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ChannelConnection } from "@prisma/client";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { Public } from "../common/decorators";
import { uuidParam } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { safeEqual } from "../security/crypto";
import { loadEnv, metaApp } from "../config/env";
import { openSecret } from "./channels.service";
import { InboundMessage, InboxService } from "./inbox.service";
import { InboundSink } from "./inbound-sink";

const STATUS_MAP = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const;

/* Meta webhook gövdeleri (yalnızca kullanılan alanlar). Biçimler Meta belgelerinden alındı; gerçek hesapla denenmedi. */
type WaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: { from: string; id: string; timestamp: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
  statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
};
type WaBody = { object?: string; entry?: { id?: string; changes?: { field?: string; value?: WaValue }[] }[] };
type IgBody = {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] } }[] }[];
};

const NON_TEXT = (type: string) => `[${type === "image" ? "Fotoğraf" : type === "audio" ? "Sesli mesaj" : type === "video" ? "Video" : type === "document" ? "Belge" : type === "sticker" ? "Çıkartma" : type === "location" ? "Konum" : "Desteklenmeyen mesaj"} gönderildi — panelden görüntülenemez, lütfen müşteriye yazılı yanıt verin]`;

/** WhatsApp Cloud API gövdesinden bu bağlantıya ait gelen mesajlar ve durumlar. Başka numaraya ait olaylar yok sayılır. */
export function parseWhatsApp(body: WaBody, phoneNumberId: string) {
  const messages: InboundMessage[] = [];
  const statuses: { id: string; status: (typeof STATUS_MAP)[keyof typeof STATUS_MAP]; error?: string }[] = [];
  if (body.object !== "whatsapp_business_account") return { messages, statuses };
  for (const e of body.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value;
      if (ch.field !== "messages" || !v || v.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of v.messages ?? []) {
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const text = m.type === "text" ? m.text?.body : m.type === "button" ? m.button?.text : m.type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : undefined;
        messages.push({ externalUserId: m.from, name, providerMessageId: m.id, text: text ?? NON_TEXT(m.type), isText: !!text, at: new Date(Number(m.timestamp) * 1000 || Date.now()) });
      }
      for (const s of v.statuses ?? []) {
        const st = STATUS_MAP[s.status as keyof typeof STATUS_MAP];
        if (st) statuses.push({ id: s.id, status: st, error: s.errors?.[0]?.title });
      }
    }
  }
  return { messages, statuses };
}

/** Instagram (Instagram Login) mesaj olayları; işletmenin kendi gönderdiği (yankı) mesajlar alınmaz. */
export function parseInstagram(body: IgBody, igId: string) {
  const messages: InboundMessage[] = [];
  if (body.object !== "instagram") return { messages, statuses: [] };
  for (const e of body.entry ?? []) {
    if (e.id !== igId) continue;
    for (const ev of e.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_echo || !ev.sender?.id || ev.sender.id === igId) continue;
      messages.push({
        externalUserId: ev.sender.id,
        providerMessageId: m.mid,
        text: m.text ?? NON_TEXT("attachment"),
        isText: !!m.text,
        at: new Date(ev.timestamp && ev.timestamp > 1e12 ? ev.timestamp : (ev.timestamp ?? Date.now() / 1000) * 1000),
      });
    }
  }
  return { messages, statuses: [] };
}

/**
 * İşletmeye özel Meta webhook adresi: /webhooks/meta/:connectionId
 * (web vekili üzerinden herkese açık: https://<alan>/api/webhooks/meta/:connectionId).
 */
@Controller("webhooks/meta")
export class MetaWebhooksController {
  private readonly logger = new Logger("MetaWebhook");

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly sink: InboundSink,
  ) {}

  /** ProGüzellik uygulamasının ortak webhook doğrulaması (Meta uygulama panelinde girilen belirteç). */
  @Public()
  @Get()
  verifyApp(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string) {
    const app = metaApp(loadEnv());
    if (!app) throw new NotFoundException();
    if (mode !== "subscribe" || !token || !safeEqual(token, app.verifyToken)) throw new ForbiddenException();
    return String(challenge ?? "");
  }

  /**
   * Ortak webhook: Embedded Signup ile bağlanan tüm salonların olayları buraya gelir. İmza uygulama sırrıyla
   * doğrulanır; her olay numara kimliğine (phone_number_id) göre ilgili salonun bağlantısına yönlendirilir.
   * Bağlı olmayan numaraların olayları yok sayılır.
   */
  @Public()
  @Post()
  @HttpCode(200)
  async receiveApp(@Req() req: RawBodyRequest<Request>, @Headers("x-hub-signature-256") signature?: string) {
    const app = metaApp(loadEnv());
    if (!app) throw new NotFoundException();
    this.checkSignature(req, app.appSecret, signature);
    const body = req.body as WaBody;
    if (body?.object !== "whatsapp_business_account") return { received: true, stored: 0, updated: 0 };
    const ids = new Set<string>();
    for (const e of body.entry ?? []) for (const ch of e.changes ?? []) if (ch.value?.metadata?.phone_number_id) ids.add(ch.value.metadata.phone_number_id);
    let stored = 0;
    let updated = 0;
    for (const phoneId of ids) {
      const c = await this.prisma.platform.channelConnection.findFirst({ where: { channel: "WHATSAPP", externalId: phoneId, managed: true, status: "CONNECTED" } });
      if (!c) continue;
      const r = await this.process(c, body);
      stored += r.stored;
      updated += r.updated;
    }
    return { received: true, stored, updated };
  }

  private checkSignature(req: RawBodyRequest<Request>, secret: string, signature?: string) {
    const raw = req.rawBody;
    if (!raw || !signature) throw new ForbiddenException("İmza eksik");
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    if (!safeEqual(signature, expected)) throw new ForbiddenException("Geçersiz imza");
  }

  private async process(c: ChannelConnection, body: unknown) {
    await this.prisma.withTenant({ tenantId: c.tenantId, userId: "" }, (tx) => tx.channelConnection.update({ where: { id: c.id }, data: { lastWebhookAt: new Date() } }));
    const parsed = c.channel === "WHATSAPP" ? parseWhatsApp(body as WaBody, c.externalId) : parseInstagram(body as IgBody, c.externalId);
    let stored = 0;
    for (const m of parsed.messages) {
      const r = await this.inbox.ingest(c, m);
      if (!r) continue;
      stored++;
      if (m.isText && !r.optedOut) await this.sink.inbound(c, r.conversation.id, r.message.id);
    }
    let updated = 0;
    for (const s of parsed.statuses) updated += await this.inbox.applyStatus(c.tenantId, s.id, s.status, s.error);
    if (stored || updated) this.logger.log(`Webhook ${c.channel}: ${stored} yeni mesaj, ${updated} durum`);
    return { stored, updated };
  }

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

  /**
   * Gelen mesaj ve teslim durumu olayları. İmza (X-Hub-Signature-256) bağlantının uygulama sırrıyla doğrulanır;
   * aynı mesaj tekrar gelirse yok sayılır. Yanıt hızlı döner, yapay zekâ işi kuyrukta yürür.
   */
  @Public()
  @Post(":id")
  @HttpCode(200)
  async receive(@Param("id") id: string, @Req() req: RawBodyRequest<Request>, @Headers("x-hub-signature-256") signature?: string) {
    const c = await this.connection(id);
    // ProGüzellik uygulamasıyla bağlanan numaralar yalnızca ortak adresten olay alır.
    if (c.managed || !c.appSecretEnc) throw new NotFoundException();
    this.checkSignature(req, openSecret(c.appSecretEnc), signature);
    return { received: true, ...(await this.process(c, req.body)) };
  }
}
