import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyTestEnv, TEST_DB } from "./test-env";

/** Test veritabanını (yoksa) oluşturur ve bekleyen migrationları uygular. Veri silmez; testler kendi verilerini temizler. */
export default async function globalSetup() {
  applyTestEnv();
  const ownerUrl = new URL(process.env.DATABASE_URL!);
  if (!ownerUrl.port || ownerUrl.pathname !== `/${TEST_DB}`) {
    throw new Error("Testler yalnızca yerel test veritabanında çalışır");
  }
  const admin = new URL(ownerUrl);
  admin.pathname = "/postgres";
  const db = new PrismaClient({ datasourceUrl: admin.toString() });
  const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
  if (rows.length === 0) await db.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  await db.$disconnect();

  execSync("npx prisma migrate deploy", {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env },
    stdio: "pipe",
  });
}
