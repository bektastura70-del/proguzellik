import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { SubscriptionsService } from "../billing/subscriptions.service";
import { loadEnv } from "../config/env";
import { PaymentReminderService } from "../platform/finance/payment-reminder.service";
import { RenewalService } from "../notifications/renewal.service";
import { RetentionService } from "../notifications/retention.service";
import { PrismaService } from "../prisma/prisma.service";
import { LowStockService } from "../stock/low-stock.service";
import { purgeTrialApplications } from "../platform/trial-application.service";
import { purgePurchaseRequests } from "../billing/purchase.service";

export const DAILY_JOB = "subscription-lifecycle";
const STALE_RUNNING_MS = 60 * 60_000;

/** İstanbul saatine göre gün anahtarı (YYYY-MM-DD) */
export const istanbulDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Günlük görev çalıştırıcısı.
 * - JobRun (name, runKey) benzersizliği: aynı gün ikinci çalıştırma atlanır (force hariç).
 * - Yarıda kalan (RUNNING, 1 saatten eski) veya başarısız çalıştırma tekrar denenebilir.
 * - Asıl iş adımları da kendi içinde tekrar çalıştırmaya dayanıklıdır.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Jobs");
  private queue?: Queue;
  private worker?: Worker;
  private connections: IORedis[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
    private readonly reminders: PaymentReminderService,
    private readonly retention: RetentionService,
    private readonly renewal: RenewalService,
    private readonly lowStock: LowStockService,
  ) {}

  async onModuleInit() {
    const env = loadEnv();
    if (env.JOBS_ENABLED !== "1") return;
    const conn = () => {
      const c = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.connections.push(c);
      return c;
    };
    this.queue = new Queue("jobs", { connection: conn(), prefix: env.QUEUE_PREFIX });
    // Birden fazla API örneği çalışsa da zamanlayıcı tektir (aynı kimlikle upsert).
    await this.queue.upsertJobScheduler(DAILY_JOB, { pattern: env.JOBS_CRON, tz: "Europe/Istanbul" }, { name: DAILY_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    this.worker = new Worker("jobs", async (job) => (job.name === DAILY_JOB ? this.runDaily() : undefined), { connection: conn(), prefix: env.QUEUE_PREFIX, concurrency: 1 });
    this.worker.on("failed", (job, err) => this.logger.error(`Görev başarısız (${job?.name}): ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  async runDaily(opts: { now?: Date; force?: boolean } = {}) {
    const now = opts.now ?? new Date();
    const runKey = istanbulDay(now);
    const db = this.prisma.platform;
    let run;
    try {
      run = await db.jobRun.create({ data: { name: DAILY_JOB, runKey, status: "RUNNING" } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      const prev = await db.jobRun.findUniqueOrThrow({ where: { name_runKey: { name: DAILY_JOB, runKey } } });
      const stale = prev.status === "RUNNING" && Date.now() - prev.startedAt.getTime() > STALE_RUNNING_MS;
      if (!opts.force && prev.status === "SUCCESS") return { skipped: true, reason: "Bugün zaten çalıştı", runKey, previous: prev.result };
      if (!opts.force && prev.status === "RUNNING" && !stale) return { skipped: true, reason: "Şu anda çalışıyor", runKey };
      // Başarısız/yarıda kalmış ya da zorla: aynı kaydı yeniden başlat (koşullu, yarışa karşı).
      const u = await db.jobRun.updateMany({
        where: { id: prev.id, status: prev.status, startedAt: prev.startedAt },
        data: { status: "RUNNING", startedAt: new Date(), finishedAt: null, error: null },
      });
      if (u.count === 0) return { skipped: true, reason: "Başka bir süreç başlattı", runKey };
      run = prev;
    }
    try {
      const lifecycle = await this.subs.runLifecycle(now);
      const pay = await this.reminders.sendOverdue(now);
      // Doğrulanmamış, süresi dolmuş deneme başvuruları saklanmaz (veri minimizasyonu)
      const expiredSignups = (await db.signupRequest.deleteMany({ where: { expiresAt: { lt: now } } })).count;
      // Deneme başvuruları: doğrulanmamış ve süresi dolmuş olanlar ile eski reddedilenler silinir
      const applications = await purgeTrialApplications(db, now);
      // Siteden satın alma: süresi dolmuş bekleyen kayıtlar silinir (ödemesi iyzico'da doğrulanmayı bekleyenler 8 güne kadar korunur)
      const expiredPurchases = await purgePurchaseRequests(db, now);
      // Paket bitişi / tekrar randevu hatırlatmaları (işletmelerin WhatsApp numarasından)
      const ret = await this.retention.run(now);
      // Yenilenme hatırlatmaları (uygulama bildirimi + e-posta; RENEWAL_REMINDERS=1 ve işletme ayarı açıksa)
      const ren = await this.renewal.run(now);
      // Kritik stok e-postası (işletme sahibi ve yöneticilere; ayarlardan kapatılabilir)
      const low = await this.lowStock.run(now);
      const result = {
        ...lifecycle,
        paymentReminders: pay.paymentReminders,
        expiredSignups,
        expiredPurchases,
        ...applications,
        packageReminders: ret.packageReminders,
        rebookReminders: ret.rebookReminders,
        renewalReminders: ren.renewalReminders,
        lowStockEmails: low.lowStockEmails,
        errors: [...lifecycle.errors, ...pay.paymentReminderErrors, ...ret.errors, ...ren.errors, ...low.errors],
      };
      await db.jobRun.update({
        where: { id: run.id },
        data: { status: result.errors.length ? "PARTIAL" : "SUCCESS", finishedAt: new Date(), result: result as unknown as Prisma.InputJsonValue },
      });
      this.logger.log(`${DAILY_JOB} ${runKey}: ${JSON.stringify(result)}`);
      return { skipped: false, runKey, result };
    } catch (e) {
      await db.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message.slice(0, 1000) } });
      throw e;
    }
  }

  recentRuns() {
    return this.prisma.platform.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 });
  }
}
