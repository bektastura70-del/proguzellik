import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppProvider } from "./whatsapp.provider";

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
  ) {}

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

  async process(job: Job<{ notificationId: string }>) {
    const db = this.prisma.platform;
    const n = await db.notification.findUnique({ where: { id: job.data.notificationId } });
    if (!n) {
      // Transaction henüz tamamlanmamış olabilir; birkaç kez yeniden denenir, sonra bırakılır.
      if (job.attemptsMade + 1 >= MAX_ATTEMPTS) return "missing";
      throw new Error("Bildirim kaydı henüz yok");
    }
    if (n.status !== "QUEUED") return "skipped";
    if (n.appointmentId && n.template !== "randevu_iptal") {
      const appt = await db.appointment.findUnique({ where: { id: n.appointmentId }, select: { status: true } });
      if (!appt || !["BOOKED", "CONFIRMED"].includes(appt.status)) {
        await db.notification.update({ where: { id: n.id }, data: { status: "SKIPPED" } });
        return "skipped";
      }
    }
    const payload = n.payload as { params: string[] };
    try {
      const { messageId } = await this.provider.sendTemplate({ to: n.recipient, template: n.template as never, params: payload.params });
      await db.notification.update({
        where: { id: n.id },
        data: { status: "SENT", providerMessageId: messageId, sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
      return "sent";
    } catch (e) {
      const last = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      await db.notification.update({
        where: { id: n.id },
        data: { attempts: { increment: 1 }, error: (e as Error).message.slice(0, 500), ...(last ? { status: "FAILED" } : {}) },
      });
      throw e;
    }
  }
}
