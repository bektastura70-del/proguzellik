/** E2E ortamı: geliştirme verisine dokunmamak için ayrı veritabanı ve portlar. */
export const E2E_DB = "proguzellik_e2e";
export const API_PORT = 4200;
export const WEB_PORT = 3200;
export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const PASSWORD = "E2eDemo12345";

const host = "127.0.0.1:5435";
export const apiEnv: Record<string, string> = {
  DATABASE_URL: `postgresql://proguzellik:proguzellik_dev@${host}/${E2E_DB}`,
  APP_DATABASE_URL: `postgresql://app_tenant:app_tenant_dev@${host}/${E2E_DB}`,
  PLATFORM_DATABASE_URL: `postgresql://app_platform:app_platform_dev@${host}/${E2E_DB}`,
  REDIS_URL: "redis://127.0.0.1:6381",
  QUEUE_PREFIX: "proguzellik-e2e",
  JWT_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef",
  API_PORT: String(API_PORT),
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  WHATSAPP_MODE: "mock",
  AI_MODE: "mock",
  SKIP_ENV_FILE: "1",
  SEED_PASSWORD: PASSWORD,
  MFA_ENCRYPTION_KEY: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
  APP_URL: `http://localhost:${WEB_PORT}`,
  EMAIL_MODE: "mock",
  // Fiyat gizleme testi: PRICING_PUBLIC=0 pnpm test:e2e site
  ...(process.env.PRICING_PUBLIC ? { PRICING_PUBLIC: process.env.PRICING_PUBLIC } : {}),
  // Kayıt kapalıyken deneme başvurusu testi: REGISTRATION_ENABLED=0 pnpm test:e2e trial-applications
  ...(process.env.REGISTRATION_ENABLED ? { REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED } : {}),
  ...(process.env.TRIAL_APPLICATIONS_ENABLED ? { TRIAL_APPLICATIONS_ENABLED: process.env.TRIAL_APPLICATIONS_ENABLED } : {}),
  TRUST_PROXY: "0",
};

/** E2E veritabanında SQL çalıştırır (yalnızca test doğrulamaları için). */
export const E2E_PSQL = `docker exec -i proguzellik-postgres psql -U proguzellik -d ${E2E_DB} -tA`;
