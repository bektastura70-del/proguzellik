import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  APP_DATABASE_URL: z.string().url(),
  PLATFORM_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6381"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET en az 32 karakter olmalı"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** apps/api/.env dosyasını (varsa) yükler ve ortam değişkenlerini doğrular. */
export function loadEnv(): Env {
  if (cached) return cached;
  const file = resolve(__dirname, "../../.env");
  if (!process.env.SKIP_ENV_FILE && existsSync(file)) {
    process.loadEnvFile(file);
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Geçersiz ortam değişkenleri: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
