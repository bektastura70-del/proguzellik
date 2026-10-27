import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { apiEnv, E2E_DB } from "./env";

const API_DIR = resolve(__dirname, "../api");
const psql = (db: string, sql: string) =>
  execSync(`docker exec -i proguzellik-postgres psql -U proguzellik -d ${db} -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();

/**
 * Yalnızca proguzellik_e2e veritabanını hazırlar: yoksa oluşturur, migration uygular,
 * önceki E2E çalışmasının verisini temizler ve uydurma demo verisini yükler.
 * Geliştirme veritabanına (proguzellik) dokunmaz.
 */
export default async function globalSetup() {
  if (!psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${E2E_DB}'`)) {
    psql("postgres", `CREATE DATABASE ${E2E_DB}`);
  }
  const env = { ...process.env, ...apiEnv };
  execSync("npx prisma migrate deploy", { cwd: API_DIR, env, stdio: "pipe" });
  const tables = psql(E2E_DB, `SELECT string_agg(format('%I', tablename), ', ') FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','Plan')`);
  if (tables) psql(E2E_DB, `TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  execSync("node prisma/seed.cjs", { cwd: API_DIR, env, stdio: "pipe" });
}
