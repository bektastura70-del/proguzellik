import { Injectable, Logger } from "@nestjs/common";
import { AiBillingSettings, AiCreditBucket, AiCreditEntryType, AiWallet, Prisma } from "@prisma/client";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiUsage, costMicroUsd, debitKurus } from "./ai-pricing";

type Db = Prisma.TransactionClient;

/** Cüzdanda bu değerden (kuruş) az kalınca yeni yanıt başlatılmaz: bir yanıtın tahmini en yüksek değeri. */
export const AI_RESERVE_KURUS = 300;
/** Ek bakiyenin geçerlilik süresi (son satın alımdan itibaren). */
export const PURCHASE_VALID_MONTHS = 12;

export type QuotaGate =
  | { ok: true }
  | { ok: false; reason: "quota_exhausted" | "daily_cap" | "conversation_cap" | "settings_missing" | "no_ai_plan"; message: string };

/** Ay ekleme (ayın son günü taşmaz: 31 Ocak + 1 ay = 28/29 Şubat). */
export function addMonths(d: Date, n: number) {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** anchor'dan itibaren aylık dönemlerden now'u içeren dönem. */
export function periodFor(anchor: Date, now: Date) {
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (addMonths(anchor, k) > now) k -= 1;
  if (k < 0) k = 0;
  return { start: addMonths(anchor, k), end: addMonths(anchor, k + 1) };
}

/** Salona gösterilecek yaklaşık yüzde (5'in katı). Para/birim dönmez. */
export function remainingPercent(w: Pick<AiWallet, "monthlyGrantKurus" | "monthlyRemainingKurus" | "purchasedRemainingKurus" | "purchasedPeakKurus">) {
  const total = w.monthlyGrantKurus + w.purchasedPeakKurus;
  if (total <= 0) return 0;
  const left = Math.max(0, w.monthlyRemainingKurus) + Math.max(0, w.purchasedRemainingKurus);
  const p = Math.min(100, (left / total) * 100);
  // Az da olsa hak varsa 0 gösterilmez (yanıltıcı olmasın).
  const r = Math.round(p / 5) * 5;
  return left > 0 && r === 0 ? 5 : r;
}

const istanbulDayStart = (d: Date) => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${day}T00:00:00+03:00`);
};

/**
 * Yapay zekâ kullanım hakkı. Değerler iç birimdir (kuruş); salona yalnız yüzde gösterilir.
 * Düşüm = gerçek token maliyeti × kur × kur tamponu × çarpan. Cüzdana giren değer sabit olduğundan
 * en kötü durumda bile gerçek harcama, salonun ödediğinden azdır.
 * Tüm yazmalar platform bağlantısıyla ve işletme başına kilitle (pg_advisory_xact_lock) yapılır.
 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger("AiQuota");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  get mode() {
    return loadEnv().AI_QUOTA_MODE;
  }

  settings(): Promise<AiBillingSettings | null> {
    return this.prisma.platform.aiBillingSettings.findUnique({ where: { id: 1 } });
  }

  /** Bu dönem için hak (kuruş): Akıllı ACTIVE → paket değeri; Akıllı TRIAL → deneme değeri; aksi 0. */
  private async expectedGrant(db: Db, tenantId: string, settings: AiBillingSettings | null) {
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true, plan: { select: { aiMonthlyCreditKurus: true, features: true } } } });
    if (!t || !t.plan.features.includes("AI_ASSISTANT") || t.plan.aiMonthlyCreditKurus <= 0) return 0;
    if (t.status === "ACTIVE") return t.plan.aiMonthlyCreditKurus;
    if (t.status === "TRIAL") return Math.min(settings?.trialCreditKurus ?? 0, t.plan.aiMonthlyCreditKurus);
    return 0;
  }

  private lock(db: Db, tenantId: string) {
    return db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-wallet:" + tenantId}))::text`;
  }

  private entry(db: Db, e: { tenantId: string; bucket: AiCreditBucket; type: AiCreditEntryType; amountKurus: number; key: string; periodStart?: Date; usageEventId?: string; purchaseId?: string; actorId?: string | null; note?: string }) {
    return db.aiCreditLedger.create({
      data: { tenantId: e.tenantId, bucket: e.bucket, type: e.type, amountKurus: e.amountKurus, idempotencyKey: e.key, periodStart: e.periodStart ?? null, usageEventId: e.usageEventId ?? null, purchaseId: e.purchaseId ?? null, actorId: e.actorId ?? null, note: e.note ?? null },
    });
  }

  /**
   * Cüzdanı açar ya da günceller (işlem içinde, kilit alınmış olmalı): dönem geçtiyse kalan aylık hak sona erer ve yeni dönem hakkı yazılır;
   * dönem içinde paket yükseldiyse (ör. deneme → Akıllı) fark eklenir; süresi dolan ek bakiye sona erer.
   */
  private async refresh(db: Db, tenantId: string, now: Date, settings: AiBillingSettings | null): Promise<AiWallet> {
    const expected = await this.expectedGrant(db, tenantId, settings);
    let w = await db.aiWallet.findUnique({ where: { tenantId } });
    if (!w) {
      const sub = await db.subscription.findFirst({ where: { tenantId, status: "ACTIVE" }, orderBy: { currentPeriodStart: "desc" }, select: { currentPeriodStart: true } });
      const anchor = sub && sub.currentPeriodStart <= now ? sub.currentPeriodStart : now;
      const p = periodFor(anchor, now);
      w = await db.aiWallet.create({ data: { tenantId, anchorAt: anchor, periodStart: p.start, periodEnd: p.end, monthlyGrantKurus: 0, monthlyRemainingKurus: 0 } });
    }
    const data: Prisma.AiWalletUpdateInput = {};
    let monthlyRemaining = w.monthlyRemainingKurus;
    let monthlyGrant = w.monthlyGrantKurus;
    let purchased = w.purchasedRemainingKurus;
    let periodStart = w.periodStart;
    if (now >= w.periodEnd) {
      const p = periodFor(w.anchorAt, now);
      if (monthlyRemaining !== 0) await this.entry(db, { tenantId, bucket: "MONTHLY", type: "MONTHLY_EXPIRE", amountKurus: -monthlyRemaining, key: `ai-expire-${tenantId}-${w.periodStart.toISOString()}`, periodStart: w.periodStart });
      monthlyRemaining = 0;
      monthlyGrant = 0;
      periodStart = p.start;
      Object.assign(data, { periodStart: p.start, periodEnd: p.end, warned80At: null, warned100At: null, purchasedPeakKurus: Math.max(0, purchased) });
    }
    if (expected > monthlyGrant) {
      const add = expected - monthlyGrant;
      await this.entry(db, { tenantId, bucket: "MONTHLY", type: "MONTHLY_GRANT", amountKurus: add, key: `ai-grant-${tenantId}-${periodStart.toISOString()}-${expected}`, periodStart });
      monthlyGrant = expected;
      monthlyRemaining += add;
      Object.assign(data, { warned80At: null, warned100At: null });
    }
    if (w.purchasedExpiresAt && w.purchasedExpiresAt <= now && purchased > 0) {
      await this.entry(db, { tenantId, bucket: "PURCHASED", type: "PURCHASE_EXPIRE", amountKurus: -purchased, key: `ai-pexpire-${tenantId}-${w.purchasedExpiresAt.toISOString()}` });
      purchased = 0;
      Object.assign(data, { purchasedExpiresAt: null });
    }
    if (monthlyRemaining === w.monthlyRemainingKurus && monthlyGrant === w.monthlyGrantKurus && purchased === w.purchasedRemainingKurus && Object.keys(data).length === 0) return w;
    return db.aiWallet.update({ where: { tenantId }, data: { ...data, monthlyRemainingKurus: monthlyRemaining, monthlyGrantKurus: monthlyGrant, purchasedRemainingKurus: purchased } });
  }

  /** Cüzdanı günceller ve döndürür (kendi işlemiyle). */
  async wallet(tenantId: string, now = new Date()) {
    const settings = await this.settings();
    return this.prisma.platform.$transaction(async (tx) => {
      await this.lock(tx, tenantId);
      return this.refresh(tx, tenantId, now, settings);
    });
  }

  /**
   * Model çağrılmadan önce: hak var mı, salon günlük tavanı ve konuşma token tavanı aşıldı mı?
   * Tavanlar her modda (ayar varsa); hak bitince engelleme yalnız AI_QUOTA_MODE=enforce.
   */
  async gate(tenantId: string, conversationId: string, now = new Date()): Promise<QuotaGate> {
    const mode = this.mode;
    // Maliyet tavanları (salon günlük, konuşma) ayar girildiyse her modda uygulanır; hak bitince engelleme yalnız enforce'ta.
    const settings = await this.settings();
    if (!settings) {
      if (mode === "enforce") return { ok: false, reason: "settings_missing", message: "Yapay zekâ kullanım ayarları eksik" };
      return { ok: true };
    }
    const db = this.prisma.platform;
    const day = await db.aiUsageEvent.aggregate({ where: { tenantId, createdAt: { gte: istanbulDayStart(now) } }, _sum: { costMicroUsd: true } });
    if ((day._sum.costMicroUsd ?? 0) >= settings.tenantDailyMaxUsd.mul(1_000_000).toNumber()) {
      return { ok: false, reason: "daily_cap", message: "Yapay zekâ günlük kullanım sınırına ulaşıldı" };
    }
    const conv = await db.aiUsageEvent.aggregate({ where: { conversationId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true } });
    const tokens = (conv._sum.inputTokens ?? 0) + (conv._sum.outputTokens ?? 0) + (conv._sum.cacheReadTokens ?? 0) + (conv._sum.cacheWriteTokens ?? 0);
    if (tokens >= settings.conversationMaxTokens) return { ok: false, reason: "conversation_cap", message: "Bu konuşmada yapay zekâ kullanım sınırına ulaşıldı" };
    if (mode !== "enforce") return { ok: true };
    const w = await this.wallet(tenantId, now);
    if (w.monthlyGrantKurus <= 0 && w.purchasedRemainingKurus <= 0 && w.purchasedPeakKurus <= 0) return { ok: false, reason: "no_ai_plan", message: "Yapay zekâ kullanım hakkı tanımlı değil" };
    if (Math.max(0, w.monthlyRemainingKurus) + Math.max(0, w.purchasedRemainingKurus) < AI_RESERVE_KURUS) {
      return { ok: false, reason: "quota_exhausted", message: "Yapay zekâ kullanım hakkı doldu" };
    }
    return { ok: true };
  }

  /**
   * Bir yanıtın kullanımını kaydeder ve (off değilse) hakkından düşer: önce aylık hak, kalanı ek bakiyeden.
   * Fiyatı bilinmeyen modelde maliyet 0 yazılır ve uyarı günlüğe düşer (enforce'ta model zaten tabloda olmalı).
   */
  async record(p: { tenantId: string; conversationId?: string | null; messageId?: string | null; usage: AiUsage; outcome: string; kind?: "chat" | "assistant" }, now = new Date()) {
    if (p.usage.calls === 0) return null;
    const micro = costMicroUsd(p.usage);
    if (micro === null) this.logger.error(`Fiyatı bilinmeyen model: ${p.usage.model} (AI_PRICE_USD_PER_MTOK tanımlayın)`);
    const settings = this.mode === "off" ? null : await this.settings();
    const debit = settings ? debitKurus(micro ?? 0, settings) : 0;
    const db = this.prisma.platform;
    const res = await db.$transaction(async (tx) => {
      const ev = await tx.aiUsageEvent.create({
        data: {
          tenantId: p.tenantId,
          conversationId: p.conversationId ?? null,
          messageId: p.messageId ?? null,
          kind: p.kind ?? "chat",
          provider: p.usage.provider,
          model: p.usage.model,
          calls: p.usage.calls,
          inputTokens: p.usage.inputTokens,
          outputTokens: p.usage.outputTokens,
          cacheReadTokens: p.usage.cacheReadTokens,
          cacheWriteTokens: p.usage.cacheWriteTokens,
          costMicroUsd: micro ?? 0,
          debitKurus: debit,
          outcome: p.outcome.slice(0, 40),
        },
      });
      if (debit <= 0) return { event: ev, wallet: null };
      await this.lock(tx, p.tenantId);
      const w = await this.refresh(tx, p.tenantId, now, settings);
      const fromMonthly = Math.min(debit, Math.max(0, w.monthlyRemainingKurus));
      const rest = debit - fromMonthly;
      // Aylık hak bittiyse ve ek bakiye yoksa küçük eksi aylık hakka yazılır (dönem sonunda sıfırlanır).
      const restBucket: AiCreditBucket = w.purchasedRemainingKurus > 0 || w.monthlyGrantKurus === 0 ? "PURCHASED" : "MONTHLY";
      if (fromMonthly > 0) await this.entry(tx, { tenantId: p.tenantId, bucket: "MONTHLY", type: "USAGE_DEBIT", amountKurus: -fromMonthly, key: `ai-usage-${ev.id}-m`, usageEventId: ev.id, periodStart: w.periodStart });
      if (rest > 0) await this.entry(tx, { tenantId: p.tenantId, bucket: restBucket, type: "USAGE_DEBIT", amountKurus: -rest, key: `ai-usage-${ev.id}-${restBucket === "MONTHLY" ? "m2" : "p"}`, usageEventId: ev.id, periodStart: w.periodStart });
      const wallet = await tx.aiWallet.update({
        where: { tenantId: p.tenantId },
        data: {
          monthlyRemainingKurus: w.monthlyRemainingKurus - fromMonthly - (restBucket === "MONTHLY" ? rest : 0),
          purchasedRemainingKurus: w.purchasedRemainingKurus - (restBucket === "PURCHASED" ? rest : 0),
        },
      });
      return { event: ev, wallet };
    });
    if (res.wallet && this.mode === "enforce") await this.warnIfNeeded(res.wallet, now).catch((e) => this.logger.error(`Uyarı e-postası: ${(e as Error).message}`));
    return res.event;
  }

  /** %80 ve %100 uyarıları (dönem başına bir kez): salon sahibine e-posta. */
  private async warnIfNeeded(w: AiWallet, now: Date) {
    const pct = remainingPercent(w);
    const left = Math.max(0, w.monthlyRemainingKurus) + Math.max(0, w.purchasedRemainingKurus);
    const empty = left < AI_RESERVE_KURUS;
    const low = pct <= 20;
    if (!(empty && !w.warned100At) && !(low && !w.warned80At)) return;
    const db = this.prisma.platform;
    const field = empty ? "warned100At" : "warned80At";
    const u = await db.aiWallet.updateMany({ where: { tenantId: w.tenantId, [field]: null }, data: empty ? { warned100At: now, warned80At: w.warned80At ?? now } : { warned80At: now } });
    if (u.count === 0) return;
    const tenant = await db.tenant.findUnique({ where: { id: w.tenantId }, select: { name: true } });
    const to = await this.ownerEmail(w.tenantId);
    if (!to || !tenant) return;
    const link = `${appUrl(loadEnv())}/panel/abonelik`;
    await this.email.send(to, empty ? { name: "ai_quota_empty", vars: { salon: tenant.name, link } } : { name: "ai_quota_low", vars: { salon: tenant.name, link } }, {
      dedupeKey: `${empty ? "ai-empty" : "ai-low"}:${w.tenantId}:${w.periodStart.toISOString()}`,
      tenantId: w.tenantId,
    });
  }

  private async ownerEmail(tenantId: string) {
    const m = await this.prisma.platform.membership.findFirst({ where: { tenantId, role: "OWNER", isActive: true }, include: { user: { select: { email: true } } } });
    return m?.user.email ?? null;
  }

  /** Ek paket ödemesi doğrulandı: değer ek bakiyeye yazılır (işlem içinde; aynı satın alma iki kez yazılmaz). */
  async creditPurchase(tx: Db, p: { tenantId: string; purchaseId: string; creditKurus: number; actorId?: string | null }, now = new Date()) {
    await this.lock(tx, p.tenantId);
    const settings = await tx.aiBillingSettings.findUnique({ where: { id: 1 } });
    const w = await this.refresh(tx, p.tenantId, now, settings);
    await this.entry(tx, { tenantId: p.tenantId, bucket: "PURCHASED", type: "PURCHASE_CREDIT", amountKurus: p.creditKurus, key: `ai-purchase-${p.purchaseId}`, purchaseId: p.purchaseId, actorId: p.actorId ?? null });
    const purchased = w.purchasedRemainingKurus + p.creditKurus;
    return tx.aiWallet.update({
      where: { tenantId: p.tenantId },
      data: {
        purchasedRemainingKurus: purchased,
        purchasedPeakKurus: Math.max(w.purchasedPeakKurus + p.creditKurus, purchased),
        purchasedExpiresAt: addMonths(now, PURCHASE_VALID_MONTHS),
        warned80At: null,
        warned100At: null,
      },
    });
  }

  /** İade: satın alınan değer (ya da kalan kadarı) ek bakiyeden düşülür. Düşülen değer döner. */
  async debitRefund(tx: Db, p: { tenantId: string; purchaseId: string; creditKurus: number; actorId: string; key: string }, now = new Date()) {
    await this.lock(tx, p.tenantId);
    const settings = await tx.aiBillingSettings.findUnique({ where: { id: 1 } });
    const w = await this.refresh(tx, p.tenantId, now, settings);
    const amount = Math.min(p.creditKurus, Math.max(0, w.purchasedRemainingKurus));
    if (amount > 0) await this.entry(tx, { tenantId: p.tenantId, bucket: "PURCHASED", type: "REFUND_DEBIT", amountKurus: -amount, key: p.key, purchaseId: p.purchaseId, actorId: p.actorId });
    await tx.aiWallet.update({ where: { tenantId: p.tenantId }, data: { purchasedRemainingKurus: w.purchasedRemainingKurus - amount, purchasedPeakKurus: Math.max(0, w.purchasedPeakKurus - amount) } });
    return amount;
  }

  /**
   * Salon paneli için durum: yalnız yaklaşık yüzde ve durum metni. Para, kuruş, konuşma sayısı DÖNMEZ.
   */
  async status(tenantId: string, now = new Date()) {
    const t = await this.prisma.platform.tenant.findUnique({ where: { id: tenantId }, select: { plan: { select: { features: true, aiMonthlyCreditKurus: true } } } });
    const available = !!t && t.plan.features.includes("AI_ASSISTANT") && t.plan.aiMonthlyCreditKurus > 0;
    if (!available) return { available: false as const };
    const w = await this.wallet(tenantId, now);
    const percent = remainingPercent(w);
    const left = Math.max(0, w.monthlyRemainingKurus) + Math.max(0, w.purchasedRemainingKurus);
    const state = left < AI_RESERVE_KURUS ? "empty" : percent <= 20 ? "low" : "ok";
    const renewsInDays = Math.max(0, Math.ceil((w.periodEnd.getTime() - now.getTime()) / 86_400_000));
    return {
      available: true as const,
      // off: ölçüm yok (bar gösterilmez); shadow: bar düşer ama yanıtlar kesilmez; enforce: hak bitince kesilir.
      tracking: this.mode !== "off",
      enforced: this.mode === "enforce",
      percent: state === "empty" ? 0 : percent,
      state,
      renewsInDays,
      renewsAt: w.periodEnd.toISOString(),
      hasExtra: w.purchasedRemainingKurus > 0,
    };
  }

  /**
   * Ek paketin etkisi (birimsiz): paket değeri / aylık hak, yarım katlara yuvarlanmış.
   * Ör. 1 = "yaklaşık 1 aylık", 0.5 = "yaklaşık yarım aylık".
   */
  async monthsEquivalent(tenantId: string, creditKurus: number) {
    const t = await this.prisma.platform.tenant.findUnique({ where: { id: tenantId }, select: { plan: { select: { aiMonthlyCreditKurus: true } } } });
    const monthly = t?.plan.aiMonthlyCreditKurus ?? 0;
    if (monthly <= 0) return null;
    return Math.max(0.5, Math.round((creditKurus / monthly) * 2) / 2);
  }

  /** Günlük görev: dönemi geçen cüzdanlar yenilenir (aylık hak yazılır, eskisi sona erer). */
  async runDaily(now = new Date()) {
    const db = this.prisma.platform;
    const due = await db.aiWallet.findMany({ where: { OR: [{ periodEnd: { lte: now } }, { purchasedExpiresAt: { lte: now } }] }, select: { tenantId: true } });
    const errors: string[] = [];
    let renewed = 0;
    for (const w of due) {
      try {
        await this.wallet(w.tenantId, now);
        renewed++;
      } catch (e) {
        errors.push(`ai-wallet ${w.tenantId}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { aiWalletsRenewed: renewed, errors };
  }

  /** SaaS sahibi paneli: dönem kullanımı ve gerçek maliyet. */
  async overview(now = new Date()) {
    const db = this.prisma.platform;
    const settings = await this.settings();
    const monthStart = new Date(now.getTime() - 30 * 86_400_000);
    const dayStart = istanbulDayStart(now);
    const [byTenant, today, purchases, wallets] = await Promise.all([
      db.aiUsageEvent.groupBy({ by: ["tenantId"], where: { createdAt: { gte: monthStart } }, _sum: { costMicroUsd: true, debitKurus: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, calls: true }, _count: { _all: true } }),
      db.aiUsageEvent.aggregate({ where: { createdAt: { gte: dayStart } }, _sum: { costMicroUsd: true }, _count: { _all: true } }),
      db.aiCreditPurchase.groupBy({ by: ["tenantId"], where: { status: "COMPLETED", completedAt: { gte: monthStart } }, _sum: { netAmount: true, creditKurus: true }, _count: { _all: true } }),
      db.aiWallet.findMany(),
    ]);
    const ids = [...new Set([...byTenant.map((r) => r.tenantId), ...wallets.map((w) => w.tenantId)])];
    const tenants = await db.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true, planCode: true } });
    const outcomes = await db.aiUsageEvent.groupBy({ by: ["tenantId", "outcome"], where: { createdAt: { gte: monthStart } }, _count: { _all: true } });
    const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
    const tl = (micro: number) => (settings ? new Prisma.Decimal(micro).div(1_000_000).mul(settings.usdTry).toFixed(2) : null);
    const rows = tenants.map((t) => {
      const u = byTenant.find((r) => r.tenantId === t.id);
      const pu = purchases.find((r) => r.tenantId === t.id);
      const w = wallets.find((x) => x.tenantId === t.id);
      const micro = u?._sum.costMicroUsd ?? 0;
      const replies = u?._count._all ?? 0;
      const handoffs = outcomes.filter((o) => o.tenantId === t.id && o.outcome !== "replied").reduce((a, o) => a + o._count._all, 0);
      return {
        tenantId: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.planCode,
        replies,
        calls: u?._sum.calls ?? 0,
        tokens: (u?._sum.inputTokens ?? 0) + (u?._sum.outputTokens ?? 0) + (u?._sum.cacheReadTokens ?? 0) + (u?._sum.cacheWriteTokens ?? 0),
        costUsd: usd(micro),
        costTl: tl(micro),
        avgCostUsdPerReply: replies ? usd(Math.round(micro / replies)) : null,
        debitTl: ((u?._sum.debitKurus ?? 0) / 100).toFixed(2),
        handoffRate: replies ? Math.round((handoffs / replies) * 100) : 0,
        topupCount: pu?._count._all ?? 0,
        topupNetTl: pu?._sum.netAmount?.toFixed(2) ?? "0.00",
        percentLeft: w ? remainingPercent(w) : null,
        monthlyLeftTl: w ? (w.monthlyRemainingKurus / 100).toFixed(2) : null,
        extraLeftTl: w ? (w.purchasedRemainingKurus / 100).toFixed(2) : null,
      };
    });
    const totalMicro = byTenant.reduce((a, r) => a + (r._sum.costMicroUsd ?? 0), 0);
    const totalTopup = purchases.reduce((a, r) => a.add(r._sum.netAmount ?? 0), new Prisma.Decimal(0));
    return {
      mode: this.mode,
      settings: settings && { usdTry: settings.usdTry.toFixed(4), fxBuffer: settings.fxBuffer.toFixed(3), markup: settings.markup.toFixed(3), creditRatio: settings.creditRatio.toFixed(3), trialCreditKurus: settings.trialCreditKurus, tenantDailyMaxUsd: settings.tenantDailyMaxUsd.toFixed(4), conversationMaxTokens: settings.conversationMaxTokens, updatedAt: settings.updatedAt },
      settingsStale: settings ? now.getTime() - settings.updatedAt.getTime() > 7 * 86_400_000 : true,
      last30Days: { costUsd: usd(totalMicro), costTl: tl(totalMicro), replies: byTenant.reduce((a, r) => a + r._count._all, 0), topupNetTl: totalTopup.toFixed(2) },
      today: { costUsd: usd(today._sum.costMicroUsd ?? 0), replies: today._count._all },
      tenants: rows.sort((a, b) => Number(b.costUsd) - Number(a.costUsd)),
    };
  }

  async updateSettings(b: { usdTry: number; fxBuffer: number; markup: number; creditRatio: number; trialCreditKurus: number; tenantDailyMaxUsd: number; conversationMaxTokens: number }, actorId: string) {
    const data = { ...b, usdTry: new Prisma.Decimal(b.usdTry), fxBuffer: new Prisma.Decimal(b.fxBuffer), markup: new Prisma.Decimal(b.markup), creditRatio: new Prisma.Decimal(b.creditRatio), tenantDailyMaxUsd: new Prisma.Decimal(b.tenantDailyMaxUsd), updatedById: actorId };
    const db = this.prisma.platform;
    const s = await db.aiBillingSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await db.auditLog.create({ data: { actorId, action: "ai.settings_updated", metadata: { ...b } } });
    return s;
  }
}
