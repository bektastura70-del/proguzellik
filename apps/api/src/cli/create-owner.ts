/*
 * İlk platform (SaaS) sahibini oluşturur; demo verisi oluşturmaz, tekrar çalıştırıldığında çoğaltmaz.
 *
 *   node dist/cli/create-owner.js --email sahip@ornek.com --name "Ad Soyad" [--additional]
 *
 * Parola komut satırından ALINMAZ (geçmişte ve süreç listesinde görünür):
 *  - Terminalde çalıştırılırsa gizli olarak iki kez sorulur.
 *  - Otomasyonda standart girdiden tek satır okunur:  ... < parola-dosyasi   (dosya sonra silinmeli)
 *  - Ya da OWNER_PASSWORD ortam değişkeni (yalnızca geçici, tek seferlik kabuk için).
 * İlk girişte 2FA kurulumu zorunludur (MFA_ENFORCE_PLATFORM=1).
 */
import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { loadEnv } from "../config/env";
import { createPlatformOwner, OwnerSetupError } from "./create-owner.lib";

export function parseArgs(argv: string[]) {
  const out: { email?: string; name?: string; additional: boolean } = { additional: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--additional") out.additional = true;
    else if (a === "--password" || a.startsWith("--password=")) throw new OwnerSetupError("Parola komut satırında verilemez; gizli istem, stdin veya OWNER_PASSWORD kullanın.");
    else throw new OwnerSetupError(`Bilinmeyen argüman: ${a}`);
  }
  if (!out.email || !out.name) throw new OwnerSetupError('Kullanım: create-owner --email <e-posta> --name "<Ad Soyad>" [--additional]');
  return out as { email: string; name: string; additional: boolean };
}

function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

async function readPassword(): Promise<string> {
  if (process.env.OWNER_PASSWORD) {
    const p = process.env.OWNER_PASSWORD;
    delete process.env.OWNER_PASSWORD;
    return p;
  }
  if (!process.stdin.isTTY) return readStdinLine();
  const p1 = await askHidden("Parola: ");
  const p2 = await askHidden("Parola (tekrar): ");
  if (p1 !== p2) throw new OwnerSetupError("Parolalar eşleşmiyor");
  return p1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const password = await readPassword();
  const db = new PrismaClient({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  try {
    const r = await createPlatformOwner(db, { email: args.email, fullName: args.name, password }, { allowAdditional: args.additional });
    console.log(
      r.status === "created"
        ? `Platform sahibi oluşturuldu: ${r.email}. İlk girişte 2FA kurulumu istenecek.`
        : `Platform sahibi zaten var: ${r.email}. Değişiklik yapılmadı.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`HATA  ${e instanceof OwnerSetupError ? e.message : (e as Error).message}`);
    process.exit(1);
  });
}
