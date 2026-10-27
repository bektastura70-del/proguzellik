import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { loadEnv, productionIssues } from "./config/env";

async function bootstrap() {
  const env = loadEnv();
  const logger = new Logger("Bootstrap");
  if (env.NODE_ENV === "production") {
    const issues = productionIssues(env);
    issues.filter((i) => i.level === "warn").forEach((i) => logger.warn(i.message));
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      errors.forEach((i) => logger.error(i.message));
      throw new Error("Canlı ortam yapılandırması güvenli değil; uygulama başlatılmadı (bkz. docs/deployment.md)");
    }
  }
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  await app.listen(env.API_PORT);
  logger.log(`API ${env.API_PORT} portunda (${env.NODE_ENV})`);
}

void bootstrap();
