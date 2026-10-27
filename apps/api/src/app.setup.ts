import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";
import { loadEnv } from "./config/env";

/** Uygulama ve testler için ortak HTTP ayarları. */
export function configureApp(app: INestApplication) {
  const env = loadEnv();
  const express = app as NestExpressApplication;
  // Yalnızca güvenilir ters vekil arkasında (TRUST_PROXY=1) istemci IP'si X-Forwarded-For'dan alınır.
  express.set("trust proxy", env.TRUST_PROXY === "1" ? 1 : false);
  express.disable("x-powered-by");
  app.enableCors({ origin: env.WEB_ORIGIN.split(","), credentials: false });
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
