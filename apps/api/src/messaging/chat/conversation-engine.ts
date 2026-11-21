import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ChannelConnection, Prisma } from "@prisma/client";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { toZoned } from "../../common/time";
import { aiAllowedForTenant, loadEnv } from "../../config/env";
import { AiQuotaService } from "../../ai-quota/ai-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { InboundSink } from "../inbound-sink";
import { InboxService, windowOpen } from "../inbox.service";
import { ChatAgent, ChatTurn, consentValid, usageOfError } from "./chat-agent";
import { PushPlanner } from "../../notifications/push/push.planner";
import { ChatTools } from "./chat-tools";

export const CHAT_QUEUE = "conversations";
/** Arka arkaya gelen mesajlar tek yanıtta toplanır. */
const DEBOUNCE_MS = 1500;
/** Bir konuşmada saatte en fazla bu kadar yapay zekâ yanıtı; aşılırsa personele devredilir. */
const MAX_AI_REPLIES_PER_HOUR = 20;

/** Metin, randevunun oluşturulduğunu/onaylandığını söylüyor mu? ("onaylandıktan" gibi uzantılar sayılmaz) */
export function claimsBooking(text: string): boolean {
  return /randevu[^.!?\n]{0,60}(oluşturuldu|oluşturdum|oluşturulmuştur|onaylandı|onaylanmıştır|kaydedildi|kaydettim|alındı|aldım)(?![a-zçğıöşü])/.test(text.toLocaleLowerCase("tr-TR"));
}
const HISTORY = 20;
/** Modele giden her mesaj bu uzunluğa kırpılır (istem 100K token sınırının altında kalır). */
const MAX_TURN_CHARS = 1000;
/** Kullanım hakkı bitince müşteriye konuşmada bir kez giden sabit metin (yapay zekâ üretmez). */
export const QUOTA_NOTICE = "Mesajınız ekibimize iletildi, en kısa sürede size dönüş yapılacak.";

const LABEL = { STAFF: "Salon personeli", SYSTEM: "Salonun otomatik bildirimi", AI: "", CUSTOMER: "" } as const;

/**
 * Gelen müşteri mesajını yapay zekâyla yanıtlar. Yanıt verilmeyen durumlar:
 * kanalda yapay zekâ kapalı, işletme yurt dışı aktarım onayı vermemiş, paket Akıllı değil, konuşma personelde,
 * 24 saat penceresi kapalı. Yapay zekâ emin olmadığında konuşmayı personele devreder.
 */
@Injectable()
export class ConversationEngine {
  private readonly logger = new Logger("ConversationEngine");

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly tools: ChatTools,
    private readonly agent: ChatAgent,
    private readonly push: PushPlanner,
    private readonly quota: AiQuotaService,
  ) {}

  private ctx(tenantId: string) {
    return { tenantId, userId: "" };
  }

  async handle(tenantId: string, conversationId: string, messageId: string): Promise<string> {
    const pre = await this.prisma.withTenant(this.ctx(tenantId), async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, include: { connection: true } });
      if (!conv) return { skip: "missing" as const };
      const latest = await tx.conversationMessage.findFirst({ where: { conversationId, direction: "IN" }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
      // Daha yeni bir müşteri mesajı varsa onun işi yanıtlar (çift yanıt olmaz).
      if (!latest || latest.id !== messageId) return { skip: "superseded" as const };
      // İş yeniden denenirse aynı mesaja ikinci kez yanıt verilmez.
      const answered = await tx.conversationMessage.count({ where: { conversationId, direction: "OUT", author: "AI", createdAt: { gte: latest.createdAt } } });
      if (answered) return { skip: "answered" as const };
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true, timezone: true, status: true, plan: { select: { features: true } } } });
      return { conv, tenant };
    });
    if ("skip" in pre) return pre.skip!;
    const { conv, tenant } = pre;
    const c: ChannelConnection = conv.connection;

    // Yapay zekâ yanıt vermeyecekse (konuşma personelde ya da yapay zekâ kapalı) müşteri mesajı personele bildirilir.
    if (conv.mode !== "AI") {
      await this.notifyStaff(tenantId, conversationId);
      return "human";
    }
    if (!c.aiAutoReply || !consentValid(c, this.agent.name === "anthropic" || this.agent.name === "openai" ? this.agent.name : null) || c.status !== "CONNECTED") {
      await this.notifyStaff(tenantId, conversationId);
      return "ai_off";
    }
    if (!tenant.plan.features.includes("AI_ASSISTANT") || !["TRIAL", "ACTIVE"].includes(tenant.status)) {
      await this.notifyStaff(tenantId, conversationId);
      return "ai_off";
    }
    if (!windowOpen(conv.lastInboundAt)) return "window_closed";

    const env = loadEnv();
    if (this.agent.name === "disabled" || env.AI_GLOBAL_PAUSE === "1") {
      await this.handoff(tenantId, conversationId, "Yapay zekâ yanıtları bu sunucuda kapalı");
      return "handoff";
    }
    // Pilot: canlıda gerçek yapay zekâ yalnız listedeki işletmelerde çalışır.
    if (this.agent.name !== "mock" && !aiAllowedForTenant(env, tenant.slug)) {
      await this.notifyStaff(tenantId, conversationId);
      return "ai_off";
    }
    const gate = await this.quota.gate(tenantId, conversationId);
    if (!gate.ok) {
      if (gate.reason === "quota_exhausted") await this.quotaNotice(tenantId, conversationId);
      await this.handoff(tenantId, conversationId, gate.message);
      return gate.reason;
    }
    const recent = await this.prisma.withTenant(this.ctx(tenantId), (tx) =>
      tx.conversationMessage.count({ where: { conversationId, author: "AI", createdAt: { gt: new Date(Date.now() - 3_600_000) } } }),
    );
    if (recent >= MAX_AI_REPLIES_PER_HOUR) {
      await this.handoff(tenantId, conversationId, "Yapay zekâ yanıt sınırına ulaşıldı");
      return "handoff";
    }

    const rows = await this.prisma.withTenant(this.ctx(tenantId), (tx) =>
      tx.conversationMessage.findMany({ where: { conversationId, NOT: { author: "SYSTEM", status: "SKIPPED" } }, orderBy: { createdAt: "desc" }, take: HISTORY }),
    );
    const history = toTurns(rows.reverse().map((r) => ({ ...r, text: r.text.slice(0, MAX_TURN_CHARS) })));
    if (!history.length) return "empty";

    const z = toZoned(new Date(), tenant.timezone);
    const now = new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, dateStyle: "full", timeStyle: "short" }).format(new Date());
    const ctx = { tenantId, conversationId, channel: conv.channel, externalUserId: conv.externalUserId, customerId: conv.customerId };

    // Randevunun gerçekten oluşup oluşmadığını model değil sunucu bilir: yalnızca araç sonucu geçerlidir.
    let booked: string | undefined;
    const trace: string[] = [];
    let out;
    try {
      out = await this.agent.reply({
        salonName: tenant.name,
        now,
        today: z.date,
        channel: conv.channel,
        history,
        runTool: async (n, i) => {
          const r = await this.tools.run(ctx, n, i);
          if (r.booked) booked = r.booked;
          trace.push(r.ok ? `${n}:tamam` : `${n}:hata(${(r.error ?? "").slice(0, 60)})`);
          return r;
        },
      });
    } catch (e) {
      const usage = usageOfError(e);
      if (usage) await this.recordUsage(tenantId, conversationId, messageId, usage, "error");
      this.logger.error(`Yapay zekâ hatası (${conversationId}): ${(e as Error).message.slice(0, 200)}`);
      await this.handoff(tenantId, conversationId, "Yapay zekâ şu anda yanıt veremedi");
      return "error";
    }
    const result = out.handoff ? "handoff" : out.text ? "replied" : "no_text";
    if (out.usage) await this.recordUsage(tenantId, conversationId, messageId, out.usage, result);
    this.logger.log(`Yapay zekâ (${conversationId}): araçlar [${trace.join(", ") || "yok"}], randevu ${booked ? "oluştu" : "oluşmadı"}`);
    // Model "randevu oluşturuldu" dese de araç randevuyu oluşturmadıysa müşteriye yanlış söz verilmez; personele devredilir.
    if (out.text && !booked && claimsBooking(out.text)) {
      this.logger.warn(`Yapay zekâ randevu oluşmadan oluşturuldu dedi (${conversationId}); yanıt değiştirildi`);
      out = { text: "Randevu talebinizi aldım ancak sisteme henüz kaydedemedim. Ekibimiz en kısa sürede sizinle iletişime geçecek.", handoff: "Yapay zekâ randevu oluşmadan oluşturuldu dedi", tools: out.tools, usage: out.usage };
    }
    // Yanıt hazırlanırken personel konuşmayı devraldıysa yapay zekâ yazmaz.
    const still = await this.prisma.withTenant(this.ctx(tenantId), (tx) => tx.conversation.findUnique({ where: { id: conversationId }, select: { mode: true } }));
    if (still?.mode !== "AI") return "human";
    if (out.text) await this.inbox.send(tenantId, conversationId, out.text.slice(0, 1000), "AI");
    if (out.handoff) {
      await this.handoff(tenantId, conversationId, out.handoff);
      return "handoff";
    }
    return out.text ? "replied" : "no_text";
  }

  /** Kullanım kaydı ve hak düşümü. Hata yanıt akışını bozmaz (kayıt kaybı günlüğe yazılır). */
  private async recordUsage(tenantId: string, conversationId: string, messageId: string, usage: NonNullable<ReturnType<typeof usageOfError>>, outcome: string) {
    try {
      await this.quota.record({ tenantId, conversationId, messageId, usage, outcome });
    } catch (e) {
      this.logger.error(`Yapay zekâ kullanımı kaydedilemedi (${conversationId}): ${(e as Error).message.slice(0, 200)}`);
    }
  }

  /** Hak bittiğinde müşteriye konuşmada bir kez sabit bilgilendirme. */
  private async quotaNotice(tenantId: string, conversationId: string) {
    try {
      const sent = await this.prisma.withTenant(this.ctx(tenantId), (tx) => tx.conversationMessage.count({ where: { conversationId, author: "SYSTEM", text: QUOTA_NOTICE } }));
      if (!sent) await this.inbox.send(tenantId, conversationId, QUOTA_NOTICE, "SYSTEM");
    } catch (e) {
      this.logger.error(`Kota bilgilendirmesi gönderilemedi (${conversationId}): ${(e as Error).message.slice(0, 200)}`);
    }
  }

  /** Telefon bildirimi (salon uygulaması + Web Push açıksa). Hata yanıt akışını bozmaz. */
  private async notifyStaff(tenantId: string, conversationId: string) {
    try {
      await this.prisma.withTenant(this.ctx(tenantId), (tx) => this.push.planConversation(tx, conversationId));
    } catch (e) {
      this.logger.error(`Personel bildirimi planlanamadı (${conversationId}): ${(e as Error).message.slice(0, 200)}`);
    }
  }

  private async handoff(tenantId: string, conversationId: string, reason: string) {
    await this.prisma.withTenant(this.ctx(tenantId), async (tx) =>
      tx.conversation.update({ where: { id: conversationId }, data: { mode: "HUMAN", handoffReason: reason.slice(0, 300), state: Prisma.DbNull } }),
    );
    await this.notifyStaff(tenantId, conversationId);
  }
}

/** Konuşma kayıtlarını modele gidecek sıraya çevirir; ilk tur her zaman müşteri olur. */
export function toTurns(rows: { direction: "IN" | "OUT"; author: "CUSTOMER" | "AI" | "STAFF" | "SYSTEM"; text: string }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const before: string[] = [];
  for (const r of rows) {
    if (r.direction === "IN") {
      const prefix = before.length && !turns.length ? `(Önceki mesajlar: ${before.join(" | ")})\n` : "";
      before.length = 0;
      turns.push({ role: "user", text: prefix + r.text });
    } else {
      const label = LABEL[r.author];
      const text = label ? `[${label}] ${r.text}` : r.text;
      if (!turns.length) before.push(text);
      else turns.push({ role: "assistant", text });
    }
  }
  return turns;
}

/** BullMQ kuyruğu: webhook hızlı yanıt verir, yapay zekâ işi burada yürür. */
@Injectable()
export class ConversationQueue extends InboundSink implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ConversationQueue");
  private queue!: Queue;
  private worker?: Worker;
  private connections: IORedis[] = [];

  constructor(private readonly engine: ConversationEngine) {
    super();
  }

  private connect() {
    const c = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.connections.push(c);
    return c;
  }

  async onModuleInit() {
    const env = loadEnv();
    this.queue = new Queue(CHAT_QUEUE, { connection: this.connect(), prefix: env.QUEUE_PREFIX });
    if (env.NOTIFICATIONS_WORKER === "1") {
      this.worker = new Worker(CHAT_QUEUE, (job) => this.process(job), { connection: this.connect(), prefix: env.QUEUE_PREFIX, concurrency: 3 });
      this.worker.on("failed", (job, err) => this.logger.warn(`Sohbet işi başarısız (${job?.id}): ${err.message}`));
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  async inbound(conn: ChannelConnection, conversationId: string, messageId: string) {
    if (!conn.aiAutoReply) return;
    await this.queue
      .add("reply", { tenantId: conn.tenantId, conversationId, messageId }, { jobId: `ai-${messageId}`, delay: DEBOUNCE_MS, attempts: 2, backoff: { type: "fixed", delay: 3000 }, removeOnComplete: 1000, removeOnFail: 1000 })
      .catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
  }

  process(job: Job<{ tenantId: string; conversationId: string; messageId: string }>) {
    return this.engine.handle(job.data.tenantId, job.data.conversationId, job.data.messageId);
  }
}
