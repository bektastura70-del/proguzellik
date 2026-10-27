/* Günlük abonelik görevini tek seferlik çalıştırır (cron/Kubernetes CronJob için): node dist/cli/run-daily.js [--force] */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { JobsService } from "../jobs/jobs.service";

async function main() {
  process.env.JOBS_ENABLED = "0";
  process.env.NOTIFICATIONS_WORKER = "0";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const r = await app.get(JobsService).runDaily({ force: process.argv.includes("--force") });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
