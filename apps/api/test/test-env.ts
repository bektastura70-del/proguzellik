import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const TEST_DB = "proguzellik_test";

/** .env'i yükler ve tüm veritabanı adreslerini test veritabanına yönlendirir. */
export function applyTestEnv() {
  const file = resolve(__dirname, "../.env");
  if (existsSync(file) && !process.env.__TEST_ENV_APPLIED) process.loadEnvFile(file);
  for (const key of ["DATABASE_URL", "APP_DATABASE_URL", "PLATFORM_DATABASE_URL"]) {
    const url = process.env[key];
    if (!url) throw new Error(`${key} tanımlı değil`);
    const u = new URL(url);
    u.pathname = `/${TEST_DB}`;
    process.env[key] = u.toString();
  }
  process.env.__TEST_ENV_APPLIED = "1";
  process.env.SKIP_ENV_FILE = "1";
  process.env.DISABLE_RATE_LIMIT = "1";
  process.env.NODE_ENV = "test";
  process.env.QUEUE_PREFIX = "proguzellik-test";
  process.env.WHATSAPP_MODE = "mock";
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
  process.env.AI_MODE = "mock";
}
