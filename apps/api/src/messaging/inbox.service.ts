import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ChannelConnection, ConversationMode, MessageAuthor, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { igCreds, waCreds } from "./channels.service";
import { MetaApiError, MetaDisabledError, MetaGateway, toE164 } from "./meta.gateway";

/** Meta kuralı: işletme serbest metni yalnızca müşterinin son mesajından sonraki 24 saat içinde gönderebilir. */
export const WINDOW_MS = 24 * 3_600_000;
export const windowOpen = (lastInboundAt: Date | null, now = Date.now()) => !!lastInboundAt && now - lastInboundAt.getTime() < WINDOW_MS;

export interface InboundMessage {
  externalUserId: string;
  name?: string | null;
  providerMessageId: string;
  text: string;
  /** Yalnızca metin mesajları yapay zekâya gider; diğer türler personele bırakılır. */
  isText: boolean;
  at: Date;
}

/** Ticari ileti reddi (şablondaki "RET yazmanız yeterli" ifadesi). */
const OPT_OUT = /^(ret|iptal|stop|dur)$/i;

/** WhatsApp numarasını müşteri kaydındaki olası yazımlarla eşleştirmek için adaylar. */
export function phoneCandidates(waId: string) {
  const d = toE164(waId);
  if (!d.startsWith("90") || d.length !== 12) return [waId];
  const ten = d.slice(2);
  return [`0${ten}`, `90${ten}`, `+90${ten}`, ten, `+${d}`];
}

/**
 * Gelen kutusu: Meta'dan gelen mesajları kaydeder, personel/yapay zekâ yanıtlarını gönderir.
 * Tüm yazmalar kiracı bağlamında (RLS) yapılır.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger("Inbox");

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGateway,
    private readonly audit: AuditService,
  ) {}

  private ctx(tenantId: string) {
    return { tenantId, userId: "" };
  }

  /**
   * Gelen mesajı kaydeder. Meta aynı olayı birden çok kez gönderebilir: mesaj kimliği zaten varsa `null` döner.
   */
  async ingest(conn: ChannelConnection, m: InboundMessage) {
    return this.prisma.withTenant(this.ctx(conn.tenantId), async (tx) => {
      if (await tx.conversationMessage.findUnique({ where: { providerMessageId: m.providerMessageId }, select: { id: true } })) return null;
      let conv = await tx.conversation.findUnique({ where: { connectionId_externalUserId: { connectionId: conn.id, externalUserId: m.externalUserId } } });
      if (!conv) {
        const customer =
          conn.channel === "WHATSAPP"
            ? await tx.customer.findFirst({ where: { phone: { in: phoneCandidates(m.externalUserId) }, anonymizedAt: null }, select: { id: true } })
            : null;
        conv = await tx.conversation.create({
          data: { tenantId: conn.tenantId, connectionId: conn.id, channel: conn.channel, externalUserId: m.externalUserId, displayName: m.name ?? null, customerId: customer?.id ?? null },
        });
      }
      // Sıralama sunucunun alış saatine göre (Meta saniye hassasiyetinde gönderir); 24 saat penceresi ise
      // müşterinin gönderdiği andan sayılır ve gelecekteki bir saate uzatılamaz.
      const sentAt = new Date(Math.min(m.at.getTime(), Date.now()));
      let msg;
      try {
        msg = await tx.conversationMessage.create({
          data: { tenantId: conn.tenantId, conversationId: conv.id, direction: "IN", author: "CUSTOMER", text: m.text.slice(0, 4000), providerMessageId: m.providerMessageId, status: "DELIVERED" },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
        throw e;
      }
      conv = await tx.conversation.update({
        where: { id: conv.id },
        data: { lastInboundAt: sentAt, lastMessageAt: new Date(), unread: { increment: 1 }, ...(m.name ? { displayName: m.name } : {}) },
      });
      let optedOut = false;
      if (m.isText && OPT_OUT.test(m.text.trim()) && conv.customerId) {
        const r = await tx.customer.updateMany({ where: { id: conv.customerId, marketingConsent: true }, data: { marketingConsent: false } });
        if (r.count) {
          optedOut = true;
          await tx.conversationMessage.create({ data: { tenantId: conn.tenantId, conversationId: conv.id, direction: "OUT", author: "SYSTEM", text: "Müşteri ticari ileti iznini geri çekti (RET). Kampanya mesajları artık gönderilmeyecek.", status: "SKIPPED" } });
          await this.audit.log(tx, { tenantId: conn.tenantId, action: "customer.marketing_opt_out", entity: "Customer", entityId: conv.customerId, metadata: { channel: conn.channel } });
        }
      }
      return { conversation: conv, message: msg, optedOut };
    });
  }

  /**
   * Meta teslim durumları (gönderildi/iletildi/okundu/başarısız).
   * Webhook işletmeye özeldir ve imza sırrını işletme kendisi girer; bu yüzden güncelleme yalnız o işletmenin
   * kayıtlarına RLS altında uygulanır (başka işletmenin mesaj durumu değiştirilemez).
   */
  async applyStatus(tenantId: string, providerMessageId: string, status: "SENT" | "DELIVERED" | "READ" | "FAILED", error?: string) {
    const data = { status, ...(status === "FAILED" ? { error: error ?? "Teslim edilemedi" } : {}) };
    return this.prisma.withTenant({ tenantId, userId: "" }, async (tx) => {
      const n = await tx.notification.updateMany({ where: { tenantId, providerMessageId }, data });
      const m = await tx.conversationMessage.updateMany({ where: { tenantId, providerMessageId }, data });
      return n.count + m.count;
    });
  }

  /**
   * Konuşmaya serbest metin gönderir (personel veya yapay zekâ). 24 saat penceresi kapalıysa gönderilmez.
   * Test modunda mesaj Meta'ya gitmez; kayıtta bu açıkça görülür (simulated).
   */
  async send(tenantId: string, conversationId: string, text: string, author: MessageAuthor, staffUserId?: string) {
    const { conv, conn, msg } = await this.prisma.withTenant(this.ctx(tenantId), async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, include: { connection: true } });
      if (!conv) throw new NotFoundException("Konuşma bulunamadı");
      if (!windowOpen(conv.lastInboundAt)) {
        throw new ConflictException({ message: "Müşterinin son mesajının üzerinden 24 saat geçti; Meta kuralları gereği yalnızca onaylı şablon mesajı gönderilebilir.", code: "WINDOW_CLOSED" });
      }
      if (conv.connection.status !== "CONNECTED") throw new ConflictException("Kanal bağlantısı aktif değil");
      const msg = await tx.conversationMessage.create({
        data: { tenantId, conversationId, direction: "OUT", author, text, staffUserId: staffUserId ?? null, status: "QUEUED" },
      });
      return { conv, conn: conv.connection, msg };
    });
    let result: { status: "SENT" | "FAILED" | "SKIPPED"; providerMessageId?: string; error?: string };
    try {
      const { messageId } =
        conn.channel === "WHATSAPP"
          ? await this.meta.sendWhatsAppText(waCreds(conn), conv.externalUserId, text)
          : await this.meta.sendInstagramText(igCreds(conn), conv.externalUserId, text);
      result = { status: "SENT", providerMessageId: messageId };
    } catch (e) {
      if (e instanceof MetaDisabledError) result = { status: "SKIPPED", error: e.message };
      else if (e instanceof MetaApiError) result = { status: "FAILED", error: e.message };
      else {
        this.logger.error(`Gönderim hatası: ${(e as Error).message}`);
        result = { status: "FAILED", error: "Beklenmeyen gönderim hatası" };
      }
    }
    return this.prisma.withTenant(this.ctx(tenantId), async (tx) => {
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
      return tx.conversationMessage.update({ where: { id: msg.id }, data: { status: result.status, providerMessageId: result.providerMessageId ?? null, error: result.error ?? null } });
    });
  }

  /* ----------------------------- Panel ----------------------------- */

  static view<T extends { providerMessageId: string | null }>(m: T) {
    return { ...m, simulated: !!m.providerMessageId?.startsWith("mock.") };
  }

  /** Menü rozeti için: okunmamış konuşmalar ve personelin yanıtını bekleyenler (yapay zekâ devretti ya da personel devraldı). */
  summary(t: TenantInfo) {
    return this.prisma.withTenant(t, async (tx) => {
      const [unread, needsStaff] = await Promise.all([
        tx.conversation.count({ where: { unread: { gt: 0 } } }),
        tx.conversation.count({ where: { unread: { gt: 0 }, mode: "HUMAN" } }),
      ]);
      return { unread, needsStaff };
    });
  }

  list(t: TenantInfo, q: { mode?: ConversationMode; unread?: boolean }) {
    return this.prisma.withTenant(t, async (tx) => {
      const rows = await tx.conversation.findMany({
        where: { ...(q.mode ? { mode: q.mode } : {}), ...(q.unread ? { unread: { gt: 0 } } : {}) },
        orderBy: { lastMessageAt: "desc" },
        take: 100,
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, author: true, createdAt: true } }, connection: { select: { displayName: true } } },
      });
      const customers = await tx.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
      return rows.map(({ messages, state: _s, ...c }) => ({
        ...c,
        lastMessage: messages[0] ?? null,
        customer: customers.find((x) => x.id === c.customerId) ?? null,
        windowOpen: windowOpen(c.lastInboundAt),
      }));
    });
  }

  get(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const c = await tx.conversation.findUnique({ where: { id }, include: { connection: { select: { channel: true, displayName: true, aiAutoReply: true, status: true } } } });
      if (!c) throw new NotFoundException("Konuşma bulunamadı");
      const [messages, customer] = await Promise.all([
        tx.conversationMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 300 }),
        c.customerId ? tx.customer.findUnique({ where: { id: c.customerId }, select: { id: true, firstName: true, lastName: true, phone: true, marketingConsent: true } }) : null,
      ]);
      if (c.unread) await tx.conversation.update({ where: { id }, data: { unread: 0 } });
      const { state: _s, ...rest } = c;
      return { ...rest, unread: 0, customer, windowOpen: windowOpen(c.lastInboundAt), messages: messages.map(InboxService.view) };
    });
  }

  async staffReply(t: TenantInfo, id: string, text: string) {
    // Personel yazınca yapay zekâ bu konuşmada susar (çift yanıt olmaz).
    await this.setMode(t, id, "HUMAN", "Personel yanıtladı");
    return InboxService.view(await this.send(t.tenantId, id, text, "STAFF", t.userId));
  }

  setMode(t: TenantInfo, id: string, mode: ConversationMode, reason?: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const c = await tx.conversation.findUnique({ where: { id } });
      if (!c) throw new NotFoundException("Konuşma bulunamadı");
      if (c.mode === mode) return { id, mode };
      await tx.conversation.update({ where: { id }, data: { mode, handoffReason: mode === "HUMAN" ? reason ?? "Personel devraldı" : null, ...(mode === "AI" ? { state: Prisma.DbNull } : {}) } });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "conversation.mode_changed", entity: "Conversation", entityId: id, metadata: { mode } });
      return { id, mode };
    });
  }

  linkCustomer(t: TenantInfo, id: string, customerId: string | null) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.conversation.findUnique({ where: { id } }))) throw new NotFoundException("Konuşma bulunamadı");
      if (customerId && !(await tx.customer.findUnique({ where: { id: customerId } }))) throw new NotFoundException("Müşteri bulunamadı");
      return tx.conversation.update({ where: { id }, data: { customerId }, select: { id: true, customerId: true } });
    });
  }
}

/** Şablon bildirimi (hatırlatma vb.) gönderildiğinde müşterinin konuşmasına kaydedilir; yanıt gelirse bağlam korunur. */
export async function recordTemplateInConversation(tx: Tx, conn: ChannelConnection, to: string, text: string, providerMessageId: string, customerId?: string | null) {
  const externalUserId = toE164(to);
  const conv =
    (await tx.conversation.findUnique({ where: { connectionId_externalUserId: { connectionId: conn.id, externalUserId } } })) ??
    (await tx.conversation.create({ data: { tenantId: conn.tenantId, connectionId: conn.id, channel: conn.channel, externalUserId, customerId: customerId ?? null } }));
  await tx.conversationMessage.create({ data: { tenantId: conn.tenantId, conversationId: conv.id, direction: "OUT", author: "SYSTEM", text, providerMessageId, status: "SENT" } });
  await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), ...(customerId && !conv.customerId ? { customerId } : {}) } });
}
