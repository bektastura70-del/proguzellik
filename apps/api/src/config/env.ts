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
  QUEUE_PREFIX: z.string().default("proguzellik"),
  NOTIFICATIONS_WORKER: z.enum(["0", "1"]).default("1"),
  // WhatsApp: varsayılan "mock" (mesaj gönderilmez). "cloud" yalnızca gerçek hesap bilgileriyle açılmalı.
  WHATSAPP_MODE: z.enum(["mock", "cloud"]).default("mock"),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  // Yapay zekâ asistanı: varsayılan "mock" (kural tabanlı). "anthropic" Claude API kullanır.
  AI_MODE: z.enum(["mock", "anthropic"]).default("mock"),
  AI_MODEL: z.string().default("claude-opus-5-5"),
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
