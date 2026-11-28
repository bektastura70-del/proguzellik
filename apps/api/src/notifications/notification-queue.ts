import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { waCreds } from "../messaging/channels.service";
import { recordTemplateInConversation } from "../messaging/inbox.service";
import { renderTemplate } from "../messaging/templates";
import { MetaDisabledError, MetaGateway } from "../messaging/meta.gateway";
import { EmailService } from "../email/email.service";
import { EmailTemplate } from "../email/templates";
import { BOOKING_EMAIL_NEEDS_ACTIVE, BOOKING_EMAIL_TEMPLATES } from "./booking-email.constants";
import { WebPushDelivery } from "./push/web-push.delivery";
import { RENEWAL_TEMPLATE, renewalEmailVars, renewalSkipReason } from "./renewal-checks";
import { WhatsAppNotConfiguredError, WhatsAppProvider } from "./whatsapp.provider";

export const QUEUE_NAME = "notifications";
const MAX_ATTEMPTS = 5;

/** BullMQ kuyruğu ve işçisi: bildirimleri zamanında, yeniden denemeli gönderir. */
@Injectable()
export class NotificationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("NotificationQueue");
  private queue!: Queue;
  private worker?: Worker;
  private connections: IORedis[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: WhatsAppProvider,
    private readonly meta: MetaGateway,
    @Optional() private readonly webPush?: WebPushDelivery,
    @Optional() private readonly email?: EmailService,
  ) {}

  /**
   * İşletmenin kendi doğrulanmış WhatsApp numarası varsa mesaj oradan gider;
   * yoksa (eski) platform geneli sağlayıcı kullanılır.
   */
  private async send(tenantId: string, to: string, template: string, params: string[]) {
    const conn = await this.prisma.platform.channelConnection.findUnique({ where: { tenantId_channel: { tenantId, channel: "WHATSAPP" } } });
    if (conn?.status === "CONNECTED") return { ...(await this.meta.sendWhatsAppTemplate(waCreds(conn), to, template, params)), conn };
    return { ...(await this.provider.sendTemplate({ to, template: template as never, params })), conn: null };
  }

  private connect() {
    const c = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.connections.push(c);
    return c;
  }

  async onModuleInit() {
    const env = loadEnv();
    this.queue = new Queue(QUEUE_NAME, { connection: this.connect(), prefix: env.QUEUE_PREFIX });
    if (env.NOTIFICATIONS_WORKER === "1") {
      this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), {
        connection: this.connect(),
        prefix: env.QUEUE_PREFIX,
        concurrency: 5,
      });
      this.worker.on("failed", (job, err) => this.logger.warn(`Bildirim işi başarısız (${job?.id}): ${err.message}`));
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  async enqueue(notificationId: string, runAt: Date) {
    const delay = Math.max(500, runAt.getTime() - Date.now());
    await this.queue.add(
      "send",
      { notificationId },
      { jobId: notificationId, delay, attempts: MAX_ATTEMPTS, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
  }

  /** E-posta kanalı: SMTP yoksa SKIPPED; geçici hata yeniden denenir, son denemede FAILED. */
  private async sendRenewalEmail(n: { id: string; tenantId: string; recipient: string } & Parameters<typeof renewalEmailVars>[1], last: boolean) {
    const db = this.prisma.platform;
    if (!this.email) return "skipped";
    const vars = await renewalEmailVars(db, n);
    const r = await this.email.send(n.recipient, { name: "renewal_reminder", vars }, { tenantId: n.tenantId });
    if ("sent" in r) {
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
      return "sent";
    }
    if ("failed" in r && r.code === "EMAIL_NOT_CONFIGURED") {
      await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", attempts: { increment: 1 }, error: "E-posta (SMTP) yapılandırılmadı" } });
      return "not_configured";
    }
    await db.notification.update({ where: { id: n.id }, data: { attempts: { increment: 1 }, error: "E-posta gönderilemedi", ...(last ? { status: "FAILED" } : {}) } });
    throw new Error("E-posta gönderilemedi");
  }

  /**
   * Randevu e-postası (işletmeye yeni randevu/iptal, müşteriye onay). Yeni randevu ve müşteri onayı,
   * randevu bu arada iptal edildiyse gönderilmez. SMTP yoksa SKIPPED; geçici hata yeniden denenir.
   */
  private async sendBookingEmail(n: { id: string; tenantId: string; recipient: string; template: string; appointmentId: string | null; payload: unknown }, last: boolean) {
    const db = this.prisma.platform;
    if (!this.email) return "skipped";
    if (n.appointmentId && BOOKING_EMAIL_NEEDS_ACTIVE.includes(n.template)) {
      const appt = await db.appointment.findUnique({ where: { id: n.appointmentId }, select: { status: true } });
      if (!appt || !["BOOKED", "CONFIRMED"].includes(appt.status)) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Randevu artık planlı değil" } });
        return "skipped";
      }
    }
    const tpl = (n.payload as { email?: EmailTemplate }).email;
    if (!tpl) {
      await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", error: "E-posta içeriği yok" } });
      return "failed";
    }
    const r = await this.email.send(n.recipient, tpl, { tenantId: n.tenantId });
    if ("sent" in r) {
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
      return "sent";
    }
    if ("failed" in r && r.code === "EMAIL_NOT_CONFIGURED") {
      await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", attempts: { increment: 1 }, error: "E-posta (SMTP) yapılandırılmadı" } });
      return "not_configured";
    }
    await db.notification.update({ where: { id: n.id }, data: { attempts: { increment: 1 }, error: "E-posta gönderilemedi", ...(last ? { status: "FAILED" } : {}) } });
    throw new Error("E-posta gönderilemedi");
  }

  async process(job: Job<{ notificationId: string }>) {
    const db = this.prisma.platform;
    const n = await db.notification.findUnique({ where: { id: job.data.notificationId } });
    if (!n) {
      // Transaction henüz tamamlanmamış olabilir; birkaç kez yeniden denenir, sonra bırakılır.
      if (job.attemptsMade + 1 >= MAX_ATTEMPTS) return "missing";
      throw new Error("Bildirim kaydı henüz yok");
    }
    if (n.status !== "QUEUED") return "skipped";
    if (n.template === RENEWAL_TEMPLATE) {
      // Yenilenme hatırlatması: koşullar gönderim anında yeniden denetlenir (izin, vazgeçme, yeni randevu, tarih).
      const reason = await renewalSkipReason(db, n);
      if (reason) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: reason } });
        return "skipped";
      }
      if (n.channel === "EMAIL") return this.sendRenewalEmail(n, job.attemptsMade + 1 >= MAX_ATTEMPTS);
    }
    if (n.channel === "EMAIL") {
      if (BOOKING_EMAIL_TEMPLATES.includes(n.template)) return this.sendBookingEmail(n, job.attemptsMade + 1 >= MAX_ATTEMPTS);
      // Tanınmayan e-posta kaydı asla WhatsApp yoluna düşmemeli.
      await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Bilinmeyen e-posta şablonu" } });
      return "skipped";
    }
    if (n.channel === "WEBPUSH") {
      if (!this.webPush) return "skipped";
      return this.webPush.deliver(n, job.attemptsMade + 1 >= MAX_ATTEMPTS);
    }
    if (n.appointmentId && n.template !== "randevu_iptal") {
      const appt = await db.appointment.findUnique({ where: { id: n.appointmentId }, select: { status: true, startsAt: true } });
      if (!appt || !["BOOKED", "CONFIRMED"].includes(appt.status)) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED" } });
        return "skipped";
      }
      // Planlandıktan sonra saat değiştiyse (eski saatli metin) gönderilmez; yeni hatırlatma ayrıca planlanmıştır.
      const plannedFor = (n.payload as { startsAt?: string }).startsAt;
      if (plannedFor && plannedFor !== appt.startsAt.toISOString()) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Randevu saati değişti" } });
        return "skipped";
      }
    }
    if (n.template === "paket_hatirlatma" && n.dedupeKey) {
      // Planlandıktan sonra paket kullanıldı/iptal edildi ya da randevu alındıysa gönderilmez.
      const pkg = await db.customerPackage.findUnique({
        where: { id: n.dedupeKey.split(":")[1] },
        select: { status: true, appointments: { where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: new Date() } }, select: { id: true } } },
      });
      if (!pkg || pkg.status !== "ACTIVE" || pkg.appointments.length > 0) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Paket artık hatırlatma gerektirmiyor" } });
        return "skipped";
      }
    }
    if (n.kind === "MARKETING") {
      // Ticari ileti: rıza gönderim anında yeniden kontrol edilir (geri çekilmiş olabilir).
      const c = n.customerId ? await db.customer.findUnique({ where: { id: n.customerId }, select: { marketingConsent: true, anonymizedAt: true } }) : null;
      if (!c?.marketingConsent || c.anonymizedAt) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Ticari ileti izni yok" } });
        return "skipped";
      }
    }
    const payload = n.payload as { params: string[] };
    try {
      const { messageId, conn } = await this.send(n.tenantId, n.recipient, n.template, payload.params);
      await db.notification.update({
        where: { id: n.id },
        data: { status: "SENT", providerMessageId: messageId, sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
      if (conn) {
        // Müşteri bu mesaja yanıt verirse gelen kutusunda ve yapay zekâda bağlam olsun.
        await this.prisma
          .withTenant({ tenantId: n.tenantId, userId: "" }, (tx) => recordTemplateInConversation(tx, conn, n.recipient, renderTemplate(n.template, payload.params), messageId, n.customerId))
          .catch((e) => this.logger.warn(`Konuşmaya kaydedilemedi: ${(e as Error).message}`));
      }
      return "sent";
    } catch (e) {
      if (e instanceof WhatsAppNotConfiguredError || e instanceof MetaDisabledError) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", attempts: { increment: 1 }, error: e.message } });
        return "not_configured";
      }
      const last = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      await db.notification.update({
        where: { id: n.id },
        data: { attempts: { increment: 1 }, error: (e as Error).message.slice(0, 500), ...(last ? { status: "FAILED" } : {}) },
      });
      throw e;
    }
  }
}
