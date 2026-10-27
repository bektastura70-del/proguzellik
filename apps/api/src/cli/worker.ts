/*
 * Arka plan işçisi: WhatsApp bildirim kuyruğu + günlük abonelik görevi (BullMQ). HTTP dinlemez.
 *   node dist/cli/worker.js
 * Canlıda API'de JOBS_ENABLED=0 ve NOTIFICATIONS_WORKER=0 olur; işler yalnızca bu süreçte çalışır.
 * Sağlık: her 30 sn veritabanı ve Redis yoklanır, başarılıysa /tmp/worker-heartbeat güncellenir.
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import IORedis from "ioredis";
import { writeFileSync } from "node:fs";
import { AppModule } from "../app.module";
import { loadEnv, productionIssues } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";

async function main() {
  process.env.JOBS_ENABLED = "1";
  process.env.NOTIFICATIONS_WORKER = "1";
  const env = loadEnv();
  const logger = new Logger("Worker");
  if (env.NODE_ENV === "production") {
    const errors = productionIssues(env).filter((i) => i.level === "error");
    if (errors.length) {
      errors.forEach((i) => logger.error(i.message));
      throw new Error("Canlı ortam yapılandırması güvenli değil; işçi başlatılmadı");
    }
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const prisma = app.get(PrismaService);
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });

  const beat = async () => {
    try {
      await prisma.platform.$queryRaw`SELECT 1`;
      await redis.ping();
      writeFileSync(HEARTBEAT_FILE, String(Date.now()));
    } catch (e) {
      logger.warn(`Sağlık yoklaması başarısız: ${(e as Error).message}`);
    }
  };
  await beat();
  const timer = setInterval(beat, 30_000);
  logger.log("İşçi çalışıyor (bildirimler + günlük görev)");

  const stop = async () => {
    clearInterval(timer);
    await redis.quit().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
