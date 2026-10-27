/*
 * Kontrollü veritabanı migration'ı. Normal API başlangıcından AYRIDIR: API asla migration çalıştırmaz.
 *
 *   node dist/cli/migrate.js status            # salt okunur: bekleyen migration'ları listeler
 *   node dist/cli/migrate.js deploy --confirm  # bekleyenleri uygular (önce yedek alın)
 *
 * Yalnızca migration sahibi rolüyle (DATABASE_URL) çalışır; bu değişken API sürecine verilmez.
 * Seed (demo verisi) hiçbir koşulda çalıştırılmaz.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export class MigrateUsageError extends Error {}

export function planMigrate(argv: string[], env: NodeJS.ProcessEnv) {
  const [cmd, ...rest] = argv;
  if (cmd !== "status" && cmd !== "deploy") throw new MigrateUsageError("Kullanım: migrate.js status | deploy --confirm");
  const unknown = rest.filter((a) => a !== "--confirm");
  if (unknown.length) throw new MigrateUsageError(`Bilinmeyen argüman: ${unknown.join(" ")}`);
  if (!env.DATABASE_URL) throw new MigrateUsageError("DATABASE_URL (migration sahibi rolü) tanımlı değil");
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new MigrateUsageError("DATABASE_URL geçerli bir adres değil");
  }
  if (/^app_(tenant|platform)$/.test(decodeURIComponent(url.username))) {
    throw new MigrateUsageError("Migration uygulama rolleriyle çalıştırılamaz; sahibi rolü kullanın");
  }
  if (cmd === "deploy" && !rest.includes("--confirm")) {
    throw new MigrateUsageError("deploy için --confirm gerekli (önce yedek alındığından emin olun)");
  }
  return { cmd, target: `${url.hostname}:${url.port || 5432}${url.pathname}` };
}

function main() {
  const plan = planMigrate(process.argv.slice(2), process.env);
  const schema = resolve(__dirname, "../../prisma/schema.prisma");
  const cli = require.resolve("prisma/build/index.js");
  console.log(`Migration ${plan.cmd}: ${plan.target}`);
  const r = spawnSync(process.execPath, [cli, "migrate", plan.cmd, "--schema", schema], { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`HATA  ${(e as Error).message}`);
    process.exit(1);
  }
}
