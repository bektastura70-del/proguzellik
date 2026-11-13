/*
 * Gerçek veri içermeyen demo salonu (mağaza incelemesi için) oluşturur. Tekrar çalıştırıldığında çoğaltmaz.
 *
 *   node dist/cli/create-demo-salon.js [--slug demo-salon] [--owner-email demo-isletme@proguzellik.com] [--reset-password]
 *
 * Parola rastgele üretilir ve YALNIZCA standart çıktıya bir kez yazılır (oluşturulduğunda veya --reset-password ile).
 * Çıktıyı ekrana/sohbete değil, yalnızca sahibinin okuyabildiği bir dosyaya yönlendirin:  ... > dosya (chmod 600)
 */
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../config/env";
import { createDemoSalon, DemoSetupError } from "./create-demo-salon.lib";

export function parseArgs(argv: string[]) {
  const out: { slug?: string; ownerEmail?: string; resetPassword: boolean } = { resetPassword: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") out.slug = argv[++i];
    else if (a === "--owner-email") out.ownerEmail = argv[++i];
    else if (a === "--reset-password") out.resetPassword = true;
    else throw new DemoSetupError(`Bilinmeyen argüman: ${a}`);
  }
  return out;
}

async function main() {
  const { resetPassword, ...input } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const platform = new PrismaClient({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  const tenant = new PrismaClient({ datasourceUrl: env.APP_DATABASE_URL });
  try {
    const r = await createDemoSalon({ platform, tenant }, Object.fromEntries(Object.entries(input).filter(([, v]) => v)), { resetPassword });
    console.log(`DURUM=${r.status === "created" ? "olusturuldu" : "zaten-var"}`);
    console.log(`SALON_ADRESI=/r/${r.slug}`);
    console.log(`ISLETME_EPOSTA=${r.ownerEmail}`);
    if (r.password) console.log(`ISLETME_PAROLA=${r.password}`);
  } finally {
    await Promise.all([platform.$disconnect(), tenant.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`HATA  ${e instanceof DemoSetupError ? e.message : (e as Error).message}`);
    process.exit(1);
  });
}
