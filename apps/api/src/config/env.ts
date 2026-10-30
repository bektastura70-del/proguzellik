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
  // Kimlik doğrulama / oturum
  MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "MFA_ENCRYPTION_KEY 64 karakter hex olmalı"),
  MFA_ENFORCE_PLATFORM: z.enum(["0", "1"]).default("1"),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(72).default(8),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(1440).default(120),
  // E-posta: "mock" gönderim yapmaz (kayıt + log); "smtp" SMTP_URL ile gönderir.
  EMAIL_MODE: z.enum(["mock", "smtp"]).default("mock"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("ProGüzellik <no-reply@proguzellik.local>"),
  APP_URL: z.string().optional(),
  // Ödeme: yalnızca test sağlayıcısı uygulanmıştır; canlıda (NODE_ENV=production) online ödeme her zaman kapalıdır.
  PAYMENT_MODE: z.enum(["mock"]).default("mock"),
  // e-Fatura/e-Arşiv: yetkili entegratör bağlanana kadar "none" (fatura yalnızca taslak/kayıt olarak tutulur).
  EINVOICE_PROVIDER: z.enum(["none"]).default("none"),
  // Zamanlanmış görevler
  JOBS_ENABLED: z.enum(["0", "1"]).default("1"),
  JOBS_CRON: z.string().default("0 3 * * *"),
  BILLING_GRACE_DAYS: z.coerce.number().min(0).max(60).default(7),
  TRUST_PROXY: z.enum(["0", "1"]).default("1"),
  // Yeni işletme kaydı. Tanımsızsa: canlıda (NODE_ENV=production) kapalı, diğer ortamlarda açık.
  REGISTRATION_ENABLED: z.enum(["0", "1"]).optional(),
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

/** Herkese açık işletme kaydı açık mı? Canlıda yalnızca REGISTRATION_ENABLED=1 ile açılır. */
export const registrationEnabled = (env: Pick<Env, "REGISTRATION_ENABLED" | "NODE_ENV">) =>
  env.REGISTRATION_ENABLED ? env.REGISTRATION_ENABLED === "1" : env.NODE_ENV !== "production";

/**
 * Davet e-postası gerçekten iletilebilir mi? Canlıda yalnızca SMTP ile. Aksi hâlde davet "teslim bekliyor"
 * durumunda kalır ve bağlantı (belirteç) hiç üretilmez.
 */
export const inviteDeliveryEnabled = (env: Pick<Env, "EMAIL_MODE" | "NODE_ENV">) => env.EMAIL_MODE === "smtp" || env.NODE_ENV !== "production";

export const appUrl = (env: Env) => (env.APP_URL ?? env.WEB_ORIGIN.split(",")[0]).replace(/\/$/, "");

/**
 * Canlı ortam kontrolleri. "error" olanlar uygulamanın açılmasını engeller.
 */
export function productionIssues(env: Env, raw: NodeJS.ProcessEnv = process.env) {
  const issues: { level: "error" | "warn"; message: string }[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warn", message });
  if (/^(e2e|test|dev|change)/i.test(env.JWT_SECRET) || new Set(env.JWT_SECRET).size < 12) err("JWT_SECRET zayıf görünüyor; `openssl rand -hex 32` ile üretin");
  for (const k of ["APP_DATABASE_URL", "PLATFORM_DATABASE_URL"] as const) {
    if (/_dev@|:postgres@|proguzellik_dev/.test(env[k])) err(`${k} geliştirme parolası içeriyor`);
    if (/127\.0\.0\.1|localhost/.test(env[k])) warn(`${k} yerel bir veritabanını gösteriyor`);
  }
  if (raw.DATABASE_URL) warn("DATABASE_URL (migration sahibi) uygulama sürecinde tanımlı olmamalı; yalnızca migration adımında verin");
  for (const o of env.WEB_ORIGIN.split(",")) if (!o.startsWith("https://")) err(`WEB_ORIGIN https olmalı: ${o}`);
  if (env.APP_URL && !env.APP_URL.startsWith("https://")) err("APP_URL https olmalı");
  if (env.MFA_ENFORCE_PLATFORM !== "1") err("MFA_ENFORCE_PLATFORM=1 olmalı (SaaS sahibi hesapları için 2FA zorunlu)");
  if (env.EMAIL_MODE === "mock") warn("EMAIL_MODE=mock: parola sıfırlama ve doğrulama e-postaları gönderilmez");
  if (env.EMAIL_MODE === "smtp" && !env.SMTP_URL) err("EMAIL_MODE=smtp için SMTP_URL gerekli");
  if (env.WHATSAPP_MODE === "mock") warn("WHATSAPP_MODE=mock: WhatsApp mesajları gönderilmez");
  if (env.WHATSAPP_MODE === "cloud") {
    for (const k of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"] as const) if (!env[k]) err(`${k} gerekli`);
  }
  if (env.PAYMENT_MODE === "mock") warn("PAYMENT_MODE=mock: canlıda online ödeme kapalı; abonelikler yalnızca SaaS sahibi panelinden manuel tanımlanır");
  if (env.AI_MODE === "anthropic" && !raw.ANTHROPIC_API_KEY) err("AI_MODE=anthropic için ANTHROPIC_API_KEY gerekli");
  if (env.JOBS_ENABLED !== "1") warn("JOBS_ENABLED=0: günlük abonelik görevi bu süreçte çalışmaz (başka bir süreçte çalıştığından emin olun)");
  if (env.REGISTRATION_ENABLED === "1") warn("REGISTRATION_ENABLED=1: herkese açık işletme kaydı açık");
  if (raw.DISABLE_RATE_LIMIT === "1") err("DISABLE_RATE_LIMIT canlıda kullanılamaz");
  return issues;
}
