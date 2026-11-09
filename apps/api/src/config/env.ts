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
  // İşletmelerin kendi Meta (WhatsApp/Instagram) hesapları: "mock" Meta'ya hiç istek atmaz (yerelde sahte doğrulama/gönderim,
  // canlıda tamamen kapalı). "live" gerçek Graph API çağrıları yapar; API konteynerinin internete çıkışı gerekir.
  META_MODE: z.enum(["mock", "live"]).default("mock"),
  META_GRAPH_VERSION: z.string().default("v21.0"),
  INSTAGRAM_GRAPH_VERSION: z.string().default("v26.0"),
  // Toplu kampanya (ticari ileti) gönderimi. Tanımsızsa canlıda kapalı: İYS entegrasyonu yok.
  MARKETING_MESSAGES: z.enum(["0", "1"]).optional(),
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
  // "iyzico": iyzico Abonelik + ödeme formu. Bu sürümde yalnız SANDBOX adresine izin verilir; canlıda (NODE_ENV=production) yine kapalıdır.
  PAYMENT_MODE: z.enum(["mock", "iyzico"]).default("mock"),
  IYZICO_API_KEY: z.string().optional(),
  IYZICO_SECRET_KEY: z.string().optional(),
  IYZICO_BASE_URL: z.string().default("https://sandbox-api.iyzipay.com"),
  /** Bildirim (webhook) imzası doğrulaması için iyzico üye işyeri numarası */
  IYZICO_MERCHANT_ID: z.string().optional(),
  /** Ödeme sonucu iyzico'nun döneceği API adresi (ör. https://alanadi/api). Tanımsızsa APP_URL + /api kullanılır. */
  IYZICO_CALLBACK_BASE: z.string().optional(),
  /**
   * Canlı sunucuda (NODE_ENV=production) iyzico SANDBOX pilotu: yalnız bu işletme kimliklerinde (virgülle) ödeme ekranı açılır.
   * Boşsa canlıda online ödeme kapalıdır. Sandbox'ta gerçek para çekilmez.
   */
  IYZICO_PILOT_TENANTS: z.string().optional(),
  // e-Fatura/e-Arşiv: yetkili entegratör bağlanana kadar "none" (fatura yalnızca taslak/kayıt olarak tutulur).
  EINVOICE_PROVIDER: z.enum(["none"]).default("none"),
  // Zamanlanmış görevler
  JOBS_ENABLED: z.enum(["0", "1"]).default("1"),
  JOBS_CRON: z.string().default("0 3 * * *"),
  BILLING_GRACE_DAYS: z.coerce.number().min(0).max(60).default(7),
  TRUST_PROXY: z.enum(["0", "1"]).default("1"),
  // Yeni işletme kaydı. Tanımsızsa: canlıda (NODE_ENV=production) kapalı, diğer ortamlarda açık.
  REGISTRATION_ENABLED: z.enum(["0", "1"]).optional(),
  /**
   * Kayıt kapalıyken sitede deneme BAŞVURU formu (SaaS sahibi onaylayınca işletme açılır).
   * Tanımsızsa: canlıda kapalı (sayfa eskisi gibi yalnız iletişim bilgisi gösterir), diğer ortamlarda açık.
   */
  TRIAL_APPLICATIONS_ENABLED: z.enum(["0", "1"]).optional(),
  /**
   * Tanımsız/boş (önerilen): SaaS sahibinin onayladığı fiyatlar sitede ve işletme panelinde görünür; canlıda online satın alma kapalı.
   * 1 = ayrıca online satın alma ve otomatik yenileme açık. 0 = acil durum: onaylı olsa bile tüm tutarlar gizlenir.
   */
  PRICING_PUBLIC: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["0", "1"]).optional()),
  /**
   * PWA V1.0 ana anahtarı (müşteri portalı, salon PWA'sı, işletme PWA'sı, Web Push). Tanımsızsa canlıda kapalı, diğer ortamlarda açık.
   * Açık olsa bile her özellik işletme başına ayrıca (SaaS sahibi panelinden) açılmalıdır; varsayılan kapalıdır.
   */
  PWA_ENABLED: z.enum(["0", "1"]).optional(),
  /** Web Push gönderimi: off = gönderilmez; mock = ağ isteği yok, gönderildi sayılır (yerel/test); live = VAPID ile gerçek gönderim. Tanımsızsa canlıda off, diğer ortamlarda mock. */
  WEB_PUSH_MODE: z.enum(["off", "mock", "live"]).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  /**
   * Yenilenme hatırlatması ana anahtarı: hizmetin tekrar süresi dolmadan müşteriye uygulama bildirimi + e-posta.
   * Tanımsızsa her ortamda KAPALI. Açık olsa bile işletme kendi ayarından ayrıca açmalıdır.
   */
  RENEWAL_REMINDERS: z.enum(["0", "1"]).optional(),
  /** İşletmelerin abonelik/ödeme için yazacağı kurumsal adres (şirket ayarlarında e-posta girilmişse o kullanılır) */
  SUPPORT_EMAIL: z.string().email().default("info@proguzellik.com"),
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

/**
 * Acil durum anahtarı: PRICING_PUBLIC=0 ise herkese açık yanıtlarda hiçbir tutar gösterilmez.
 * Tanımsızken tutar gösterimi paket başına SaaS sahibinin onayladığı fiyat sürümüne bağlıdır.
 */
export const pricesHidden = (env: Pick<Env, "PRICING_PUBLIC">) => env.PRICING_PUBLIC === "0";

/** Online satın alma/otomatik yenileme açık mı? Canlıda yalnızca PRICING_PUBLIC=1 ile; kapalıyken satın alma ve otomatik tahsilat yapılamaz. */
export const pricingPublic = (env: Pick<Env, "PRICING_PUBLIC" | "NODE_ENV">) =>
  env.PRICING_PUBLIC ? env.PRICING_PUBLIC === "1" : env.NODE_ENV !== "production";

/** Herkese açık işletme kaydı açık mı? Canlıda yalnızca REGISTRATION_ENABLED=1 ile açılır. */
export const registrationEnabled = (env: Pick<Env, "REGISTRATION_ENABLED" | "NODE_ENV">) =>
  env.REGISTRATION_ENABLED ? env.REGISTRATION_ENABLED === "1" : env.NODE_ENV !== "production";

/** Deneme başvuru formu açık mı? Canlıda yalnızca TRIAL_APPLICATIONS_ENABLED=1 ile. Kayıt açıkken form yerine kendi kendine kayıt kullanılır. */
export const trialApplicationsEnabled = (env: Pick<Env, "TRIAL_APPLICATIONS_ENABLED" | "REGISTRATION_ENABLED" | "NODE_ENV">) =>
  !registrationEnabled(env) && (env.TRIAL_APPLICATIONS_ENABLED ? env.TRIAL_APPLICATIONS_ENABLED === "1" : env.NODE_ENV !== "production");

/**
 * Davet e-postası gerçekten iletilebilir mi? Canlıda yalnızca SMTP ile. Aksi hâlde davet "teslim bekliyor"
 * durumunda kalır ve bağlantı (belirteç) hiç üretilmez.
 */
export const inviteDeliveryEnabled = (env: Pick<Env, "EMAIL_MODE" | "NODE_ENV">) => env.EMAIL_MODE === "smtp" || env.NODE_ENV !== "production";

/** PWA V1.0 özellikleri bu ortamda açılabilir mi? Canlıda yalnızca PWA_ENABLED=1 ile. */
export const pwaEnabled = (env: Pick<Env, "PWA_ENABLED" | "NODE_ENV">) =>
  env.PWA_ENABLED ? env.PWA_ENABLED === "1" : env.NODE_ENV !== "production";

/** Yenilenme hatırlatması bu ortamda açık mı? Yalnızca RENEWAL_REMINDERS=1 ile (varsayılan kapalı). */
export const renewalRemindersOn = (env: Pick<Env, "RENEWAL_REMINDERS">) => env.RENEWAL_REMINDERS === "1";

/** Bu işletme yenilenme hatırlatmasını kullanabilir mi: ortam açık + SaaS sahibi izin vermiş (pilot). */
export const renewalAvailable = (t: { renewalRemindersAllowed: boolean }) => renewalRemindersOn(loadEnv()) && t.renewalRemindersAllowed;

/** Etkin Web Push kipi. Canlıda açıkça "live" seçilmedikçe ve VAPID anahtarları yoksa gönderim yapılmaz. */
export const webPushMode = (env: Pick<Env, "WEB_PUSH_MODE" | "NODE_ENV" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT">): "off" | "mock" | "live" => {
  const mode = env.WEB_PUSH_MODE ?? (env.NODE_ENV === "production" ? "off" : "mock");
  if (mode === "live" && !(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)) return "off";
  // Test sağlayıcısı canlıda sahte "gönderildi" kaydı üretmesin.
  if (mode === "mock" && env.NODE_ENV === "production") return "off";
  return mode;
};

/** Canlıda iyzico pilotu açık işletmeler (geçerli UUID'ler). */
export const iyzicoPilotTenants = (env: Pick<Env, "IYZICO_PILOT_TENANTS">) =>
  (env.IYZICO_PILOT_TENANTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f-]{36}$/.test(s));

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
  if (env.PAYMENT_MODE === "iyzico") {
    const pilots = iyzicoPilotTenants(env);
    if (pilots.length) warn(`PAYMENT_MODE=iyzico: iyzico SANDBOX pilotu yalnız ${pilots.length} işletmede açık (gerçek para çekilmez)`);
    else warn("PAYMENT_MODE=iyzico ama IYZICO_PILOT_TENANTS boş: canlıda online ödeme kapalı");
    if (!env.IYZICO_API_KEY || !env.IYZICO_SECRET_KEY) err("PAYMENT_MODE=iyzico için IYZICO_API_KEY ve IYZICO_SECRET_KEY gerekli");
    if (!env.IYZICO_MERCHANT_ID) warn("IYZICO_MERCHANT_ID yok: iyzico bildirimleri (webhook) reddedilir; günlük görev durumu yine eşitler");
  }
  if (env.PAYMENT_MODE === "mock") warn("PAYMENT_MODE=mock: canlıda online ödeme kapalı; abonelikler yalnızca SaaS sahibi panelinden manuel tanımlanır");
  if (env.MARKETING_MESSAGES === "1") warn("MARKETING_MESSAGES=1: işletmeler toplu kampanya mesajı gönderebilir (İYS kaydı işletmelerin sorumluluğunda)");
  if (env.META_MODE === "mock") warn("META_MODE=mock: işletmelerin WhatsApp/Instagram bağlantıları doğrulanamaz, mesaj alınıp gönderilmez");
  if (env.META_MODE === "live" && env.AI_MODE === "mock") warn("META_MODE=live, AI_MODE=mock: gelen mesajlara yapay zekâ yanıt vermez, tümü personel gelen kutusuna düşer");
  if (env.AI_MODE === "anthropic" && !raw.ANTHROPIC_API_KEY) err("AI_MODE=anthropic için ANTHROPIC_API_KEY gerekli");
  if (env.JOBS_ENABLED !== "1") warn("JOBS_ENABLED=0: günlük abonelik görevi bu süreçte çalışmaz (başka bir süreçte çalıştığından emin olun)");
  if (env.PRICING_PUBLIC === "1") warn("PRICING_PUBLIC=1: paket fiyatları herkese açık ve satışta kullanılır");
  if (env.PRICING_PUBLIC === "0") warn("PRICING_PUBLIC=0: onaylı paket fiyatları dahil tüm tutarlar sitede ve işletme panelinde gizli");
  if (env.REGISTRATION_ENABLED === "1") warn("REGISTRATION_ENABLED=1: herkese açık işletme kaydı açık");
  if (raw.DISABLE_RATE_LIMIT === "1") err("DISABLE_RATE_LIMIT canlıda kullanılamaz");
  if (env.TRIAL_APPLICATIONS_ENABLED === "1") warn("TRIAL_APPLICATIONS_ENABLED=1: sitede deneme başvuru formu açık (onay SaaS sahibinde)");
  if (env.PWA_ENABLED === "1") warn("PWA_ENABLED=1: PWA özellikleri SaaS sahibi panelinden işletme başına açılabilir");
  if (env.WEB_PUSH_MODE === "live") {
    for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const) if (!env[k]) err(`WEB_PUSH_MODE=live için ${k} gerekli`);
    if (env.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT)) err("VAPID_SUBJECT mailto: veya https:// ile başlamalı");
    warn("WEB_PUSH_MODE=live: Web Push bildirimleri gerçek cihazlara gönderilir (API/işçi konteynerinin internete çıkışı gerekir)");
  }
  if (env.RENEWAL_REMINDERS === "1") warn("RENEWAL_REMINDERS=1: işletmeler yenilenme hatırlatmasını açabilir (müşteriye ticari ileti izni olanlara uygulama bildirimi + e-posta)");
  if (env.WEB_PUSH_MODE === "mock") warn("WEB_PUSH_MODE=mock canlıda geçersizdir; Web Push gönderilmez");
  return issues;
}
