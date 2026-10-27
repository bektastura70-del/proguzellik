import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadEnv } from "./config/env";

/** Uygulama ve testler için ortak HTTP ayarları. */
export function configureApp(app: INestApplication) {
  const env = loadEnv();
  const express = app as NestExpressApplication;
  express.set("trust proxy", 1);
  express.disable("x-powered-by");
  app.enableCors({ origin: env.WEB_ORIGIN.split(","), credentials: false });
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.enableShutdownHooks();
  return app;
}
