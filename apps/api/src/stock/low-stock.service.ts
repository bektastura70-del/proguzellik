import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const MAX_LINES = 30;

/** ISO hafta anahtarı (YYYY-Www): aynı kritik liste en fazla haftada bir e-postalanır. */
export const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
};

/**
 * Kritik stok e-postası (günlük görev). Stok paketi olan, aktif/denemedeki ve ayarı açık işletmelerde
 * kritik seviyedeki (stok ≤ kritik seviye, kritik seviye > 0) ürünler sahip ve yöneticilere gönderilir.
 * Yeni bir ürün kritik seviyeye düştüğünde liste değişir ve hemen e-posta gider; aynı liste haftada bir hatırlatılır.
 */
@Injectable()
export class LowStockService {
  private readonly logger = new Logger("LowStock");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async run(now = new Date()) {
    const db = this.prisma.platform;
    const out = { lowStockEmails: 0, errors: [] as string[] };
    const tenants = await db.tenant.findMany({
      where: { status: { in: ["ACTIVE", "TRIAL"] }, lowStockEmailEnabled: true, plan: { features: { has: "STOCK" } } },
      select: { id: true, name: true },
    });
    const link = `${appUrl(loadEnv())}/panel/stok`;
    for (const t of tenants) {
      try {
        const products = await db.product.findMany({
          where: { tenantId: t.id, isActive: true, minQty: { gt: 0 } },
          select: { id: true, name: true, stockQty: true, minQty: true, unit: true },
          orderBy: { name: "asc" },
        });
        const low = products.filter((p) => D(p.stockQty).lessThanOrEqualTo(p.minQty));
        if (!low.length) continue;
        const hash = createHash("sha256").update(low.map((p) => p.id).sort().join(",")).digest("hex").slice(0, 16);
        const items = low
          .slice(0, MAX_LINES)
          .map((p) => `${p.name}: ${D(p.stockQty).toString()} ${p.unit} (kritik ${D(p.minQty).toString()})`)
          .concat(low.length > MAX_LINES ? [`… ve ${low.length - MAX_LINES} ürün daha`] : []);
        const members = await db.membership.findMany({
          where: { tenantId: t.id, isActive: true, role: { in: ["OWNER", "MANAGER"] }, user: { isActive: true } },
          select: { userId: true, user: { select: { email: true } } },
        });
        for (const m of members) {
          const res = await this.email.send(
            m.user.email,
            { name: "low_stock_alert", vars: { salon: t.name, count: low.length, items: items.join("\n"), link } },
            { dedupeKey: `low-stock:${t.id}:${m.userId}:${isoWeek(now)}:${hash}`, tenantId: t.id },
          );
          if (!("skipped" in res)) out.lowStockEmails++;
        }
      } catch (e) {
        const msg = `low-stock ${t.id}: ${(e as Error).message}`;
        this.logger.error(msg);
        out.errors.push(msg);
      }
    }
    return out;
  }
}
