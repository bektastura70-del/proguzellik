/*
 * Mükerrer müşteri kayıtları: rapor (varsayılan, hiçbir şey değiştirmez) ve tek tek birleştirme.
 *
 *   node dist/cli/customer-duplicates.js [--salon <slug>]                 → rapor (salt okunur)
 *   node dist/cli/customer-duplicates.js --salon <slug> --birlestir --ana <müşteriId> --sil <müşteriId> \
 *        --not "Salon sahibi aynı kişi olduğunu teyit etti" --onayla      → birleştirme (tek transaction)
 *
 * Birleştirmeden ÖNCE yedek alın (infra/production/backup.sh) ve salon sahibine kayıtların aynı kişi olduğunu teyit ettirin.
 * "ad-soyad" grupları aynı kişi olmayabilir: teyitsiz birleştirmeyin.
 */
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../config/env";
import { findDuplicates, maskPhone, mergeCustomers, MergeError } from "./customer-duplicates.lib";

export function parseArgs(argv: string[]) {
  const out: { salon?: string; merge: boolean; keep?: string; drop?: string; note?: string; confirm: boolean } = { merge: false, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--salon") out.salon = argv[++i];
    else if (a === "--birlestir") out.merge = true;
    else if (a === "--ana") out.keep = argv[++i];
    else if (a === "--sil") out.drop = argv[++i];
    else if (a === "--not") out.note = argv[++i];
    else if (a === "--onayla") out.confirm = true;
    else throw new MergeError(`Bilinmeyen argüman: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const platform = new PrismaClient({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  const tenantDb = new PrismaClient({ datasourceUrl: env.APP_DATABASE_URL });
  try {
    if (!args.merge) {
      const groups = await findDuplicates(platform, { tenantSlug: args.salon });
      if (!groups.length) console.log("Mükerrer kayıt bulunmadı.");
      for (const g of groups) {
        console.log(`\n[${g.tenantSlug}] olası mükerrer (${g.reason})${g.reason === "ad-soyad" ? " — telefonlar farklı, salon teyit etmeden birleştirmeyin" : ""}`);
        for (const c of g.customers) {
          console.log(
            `  ${c.id === g.keepId ? "ANA " : "    "}${c.id}  ${c.name}  tel ${maskPhone(c.phone)}  e-posta ${c.email ? "var" : "yok"}  kaynak ${c.source ?? "—"}  ` +
              `${c.createdAt.toISOString().slice(0, 10)}  randevu ${c.appointments} · paket ${c.packages} · satış ${c.sales} · kasa ${c.transactions}`,
          );
        }
      }
      console.log("\nBu rapor hiçbir kaydı değiştirmedi.");
      return;
    }
    if (!args.salon || !args.keep || !args.drop || !args.note) throw new MergeError("--salon, --ana, --sil ve --not gerekli");
    if (!args.confirm) throw new MergeError("Birleştirme geri alınamaz: yedek aldıktan sonra --onayla ekleyin");
    const t = await platform.tenant.findUnique({ where: { slug: args.salon }, select: { id: true } });
    if (!t) throw new MergeError("Salon bulunamadı");
    const r = await mergeCustomers(tenantDb, { tenantId: t.id, keepId: args.keep, mergeId: args.drop, note: args.note });
    console.log(`Birleştirildi. Taşınan: ${JSON.stringify(r.moved)}`);
    for (const w of r.warnings) console.log(`UYARI: ${w}`);
  } finally {
    await Promise.all([platform.$disconnect(), tenantDb.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof MergeError ? `HATA: ${e.message}` : e);
    process.exit(1);
  });
}
