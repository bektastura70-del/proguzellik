import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Paralel çalışmalar (ayrı klasörlerde) birbirinin test verisini silmesin diye: PG_TEST_DB=proguzellik_test_<ad> */
const requested = process.env.PG_TEST_DB;
if (requested && !/^proguzellik_test(_[a-z0-9]+)?$/.test(requested)) throw new Error("PG_TEST_DB yalnızca proguzellik_test_<ad> olabilir");
export const TEST_DB = requested || "proguzellik_test";

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
  process.env.ASSISTANT_AI_MODE = "mock";
  // Sahte istemcili sağlayıcı testleri için model adı (gerçek API çağrılmaz). Kota testleri modu kendisi açar.
  process.env.AI_MODEL = "claude-haiku-5-5";
  process.env.AI_QUOTA_MODE = "off";
  process.env.AI_GLOBAL_PAUSE = "0";
  // Yerel .env'de PAYMENT_MODE=iyzico (sandbox) olabilir; iyzico testleri sağlayıcıyı kendileri değiştirir.
  process.env.PAYMENT_MODE = "mock";
}
