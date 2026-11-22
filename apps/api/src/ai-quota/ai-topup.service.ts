import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AiCreditPurchase, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { aiTopupEnabled, appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { approvedVersionsOf, priceForNewSale, withVat } from "../billing/plan-pricing";
import { IyzicoClient, IyzicoError, IyzicoPaymentFormResult } from "../billing/iyzico/iyzico.client";
import { IyzicoBillingService } from "../billing/iyzico/iyzico-billing.service";
import { creditForNet } from "./ai-pricing";
import { AiQuotaService, remainingPercent } from "./ai-quota.service";

/** Ek paket tutar kuralları (KDV hariç TL). Plan bölüm 4: hazır tutarlar + 50 TL'nin katı serbest tutar. */
export const TOPUP_PRESETS = [250, 500, 1000, 2000];
export const TOPUP_MIN = 250;
export const TOPUP_MAX = 10_000;
export const TOPUP_STEP = 50;
/** Ek paket satış koşulları sürümü (web: content/legal/ai-ek-paket.ts, /yapay-zeka-ek-paket-kosullari); kayda yazılır. */
export const TOPUP_TERMS_VERSION = "ai-ek-paket-1.0";
export const AI_TOPUP_CALLBACK_PATH = "/api/odeme/iyzico/ai-paket";

export interface TopupBilling {
  fullName: string;
  identityNumber: string;
  gsmNumber: string;
  city: string;
  address: string;
}

/** iyzico'da gerçekten tahsil edilen (kalem toplamı); kayıt yoksa beklenen tutar. */
const paidOf = (p: AiCreditPurchase) => {
  const txs = (p.paymentTransactionIds as { paidPrice: number }[] | null) ?? [];
  return txs.length ? txs.reduce((a, t) => a.plus(new Prisma.Decimal(t.paidPrice)), new Prisma.Decimal(0)) : p.grossAmount;
};
const amountEq = (a: number | string | Prisma.Decimal | undefined, b: Prisma.Decimal) => a !== undefined && new Prisma.Decimal(a).toDecimalPlaces(2).equals(b.toDecimalPlaces(2));

/**
 * Yapay zekâ ek paketi: tek seferlik iyzico Ödeme Formu. Ödeme bizim hesabımıza düşer;
 * KDV hariç tutarın creditRatio'su (varsayılan yarısı) cüzdana iç değer olarak yüklenir. Salon birim/para görmez,
 * yalnız "aylık hakkın yaklaşık N katı" ve bar önizlemesi görür.
 */
@Injectable()
export class AiTopupService {
  private readonly logger = new Logger("AiTopup");

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: IyzicoClient,
    private readonly billing: IyzicoBillingService,
    private readonly quota: AiQuotaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** Satış açık mı: bayrak + iyzico + pilot listesi. */
  private available(tenantId: string) {
    return aiTopupEnabled(loadEnv()) && this.billing.enabled && this.billing.allowedFor(tenantId);
  }

  private async eligibility(tenantId: string) {
    const t = await this.prisma.platform.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, status: true, plan: { select: { features: true, aiMonthlyCreditKurus: true } } } });
    const aiPlan = t.plan.features.includes("AI_ASSISTANT") && t.plan.aiMonthlyCreditKurus > 0;
    return { tenant: t, ok: aiPlan && t.status === "ACTIVE", aiPlan };
  }

  /** KDV oranı: Akıllı paketin onaylı fiyat sürümünden (sabit yazılmaz). */
  private async vatRate() {
    const price = priceForNewSale(await approvedVersionsOf(this.prisma.platform, ["SMART"]), new Date());
    if (!price) throw new ConflictException({ message: "KDV oranı belirlenemedi (Akıllı paketin onaylı fiyatı yok)", code: "PRICE_NOT_APPROVED" });
    return price.vatRate;
  }

  private assertAmount(net: number) {
    if (!Number.isInteger(net) || net < TOPUP_MIN || net > TOPUP_MAX || net % TOPUP_STEP !== 0) {
      throw new BadRequestException(`Tutar ${TOPUP_MIN} ile ${TOPUP_MAX.toLocaleString("tr-TR")} TL arasında ve ${TOPUP_STEP} TL'nin katı olmalı`);
    }
  }

  /** Birimsiz önizleme: aylık hakkın yaklaşık kaç katı ve bar yaklaşık nereye gelir. */
  private async preview(tenantId: string, creditKurus: number) {
    const w = await this.quota.wallet(tenantId);
    const after = { ...w, purchasedRemainingKurus: Math.max(0, w.purchasedRemainingKurus) + creditKurus, purchasedPeakKurus: Math.max(w.purchasedPeakKurus, Math.max(0, w.purchasedRemainingKurus)) + creditKurus };
    return { monthsEquivalent: await this.quota.monthsEquivalent(tenantId, creditKurus), percentNow: remainingPercent(w), percentAfter: remainingPercent(after) };
  }

  private async quoteFor(tenantId: string, net: number) {
    this.assertAmount(net);
    const settings = await this.quota.settings();
    if (!settings) throw new ServiceUnavailableException("Ek paket şu an satışta değil");
    const vatRate = await this.vatRate();
    const n = new Prisma.Decimal(net);
    const v = withVat(n, vatRate);
    const creditKurus = creditForNet(n, settings.creditRatio);
    return { net: v.net, vat: v.vat, gross: v.gross, vatRate, creditKurus, ...(await this.preview(tenantId, creditKurus)) };
  }

  /** Ek paket ekranı: tutarlar, KDV dökümü, birimsiz etki ve geçmiş alımlar. */
  async options(t: TenantInfo) {
    const el = await this.eligibility(t.tenantId);
    const purchases = await this.prisma.platform.aiCreditPurchase.findMany({ where: { tenantId: t.tenantId, status: { in: ["COMPLETED", "REFUNDED", "PENDING"] } }, orderBy: { createdAt: "desc" }, take: 20 });
    const history = purchases.map((p) => ({ id: p.id, createdAt: p.createdAt, grossAmount: p.grossAmount.toFixed(2), status: p.status, sandbox: p.environment === "sandbox", refundedAmount: p.refundedAmount.toFixed(2) }));
    if (!el.aiPlan) return { available: false as const, reason: "Ek paket yalnız Akıllı pakette alınabilir", history };
    if (!el.ok) return { available: false as const, reason: "Ek paket için aboneliğinizin aktif olması gerekir", history };
    if (!this.available(t.tenantId)) return { available: false as const, reason: "Ek paket satışı henüz açık değil", history };
    const quotes = [];
    for (const net of TOPUP_PRESETS) quotes.push(this.view(net, await this.quoteFor(t.tenantId, net)));
    return { available: true as const, presets: quotes, min: TOPUP_MIN, max: TOPUP_MAX, step: TOPUP_STEP, termsVersion: TOPUP_TERMS_VERSION, history };
  }

  async quote(t: TenantInfo, net: number) {
    return this.view(net, await this.quoteFor(t.tenantId, net));
  }

  /** Salona dönen teklif: para yalnız ödeme tutarı olarak (yasal zorunluluk); iç değer (kuruş) dönmez. */
  private view(net: number, q: Awaited<ReturnType<AiTopupService["quoteFor"]>>) {
    return { amount: net, netAmount: q.net.toFixed(2), vat: q.vat.toFixed(2), vatRate: q.vatRate.toFixed(2), grossAmount: q.gross.toFixed(2), monthsEquivalent: q.monthsEquivalent, percentNow: q.percentNow, percentAfter: q.percentAfter };
  }

  private callbackUrl() {
    const env = loadEnv();
    return `${(env.IYZICO_CALLBACK_BASE ?? appUrl(env)).replace(/\/$/, "")}${AI_TOPUP_CALLBACK_PATH}`;
  }

  async startCheckout(t: TenantInfo, b: { amount: number; billing: TopupBilling; termsVersion: string }, ip: string) {
    if (!this.available(t.tenantId)) throw new ServiceUnavailableException({ message: "Ek paket satışı henüz açık değil", code: "AI_TOPUP_DISABLED" });
    if (b.termsVersion !== TOPUP_TERMS_VERSION) throw new ConflictException({ message: "Sözleşme metni güncellendi; sayfayı yenileyip yeniden onaylayın", code: "TERMS_OUTDATED" });
    const el = await this.eligibility(t.tenantId);
    if (!el.ok) throw new ForbiddenException("Ek paket yalnız aktif Akıllı pakette alınabilir");
    const db = this.prisma.platform;
    const user = await db.user.findUniqueOrThrow({ where: { id: t.userId } });
    if (!user.emailVerifiedAt) throw new ForbiddenException({ message: "Ödeme yapmadan önce e-posta adresinizi doğrulayın", code: "EMAIL_NOT_VERIFIED" });
    const q = await this.quoteFor(t.tenantId, b.amount);
    const env = this.client.environment!;
    const conversationId = `pgai-${randomUUID()}`;
    const purchase = await db.aiCreditPurchase.create({
      data: { tenantId: t.tenantId, userId: t.userId, environment: env, conversationId, netAmount: q.net, vatRate: q.vatRate, grossAmount: q.gross, creditKurus: q.creditKurus, termsVersion: b.termsVersion },
    });
    const parts = b.billing.fullName.trim().split(/\s+/);
    const surname = parts.length > 1 ? parts.pop()! : parts[0];
    const name = parts.join(" ") || surname;
    const gsm = b.billing.gsmNumber.replace(/[\s()-]/g, "").replace(/^0/, "+90").replace(/^90/, "+90").replace(/^5/, "+905");
    let form: { token: string; checkoutFormContent: string };
    try {
      form = await this.client.initPaymentForm({
        conversationId,
        basketId: purchase.id,
        price: q.gross.toFixed(2),
        callbackUrl: this.callbackUrl(),
        buyer: { id: t.userId, name, surname, email: user.email, gsmNumber: gsm, identityNumber: b.billing.identityNumber, ip, city: b.billing.city.trim(), country: "Turkey", registrationAddress: b.billing.address.trim() },
        billingAddress: { contactName: b.billing.fullName.trim(), city: b.billing.city.trim(), country: "Turkey", address: `${el.tenant.name}, ${b.billing.address.trim()}` },
        item: { id: purchase.id, name: "Yapay zekâ ek kullanım paketi", category: "Yazılım hizmeti" },
      });
    } catch (e) {
      await db.aiCreditPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 300) } });
      throw new BadGatewayException("Ödeme formu açılamadı. Kartınızdan ücret alınmadı; lütfen daha sonra tekrar deneyin.");
    }
    await db.aiCreditPurchase.update({ where: { id: purchase.id }, data: { token: form.token } });
    await this.audit.logPlatform({
      tenantId: t.tenantId,
      actorId: t.userId,
      action: "ai.topup_started",
      metadata: { env, purchaseId: purchase.id, net: q.net.toFixed(2), gross: q.gross.toFixed(2), creditKurus: q.creditKurus, termsAccepted: { version: b.termsVersion, at: new Date().toISOString() } },
    });
    return { checkoutFormContent: form.checkoutFormContent, amount: q.gross.toFixed(2), netAmount: q.net.toFixed(2), vatRate: q.vatRate.toFixed(2) };
  }

  /**
   * Ödeme formundan dönüş. Sonuç iyzico'dan sorgulanır ve doğrulanır: ödeme başarılı, dolandırıcılık kontrolü onaylı,
   * oturum/sepet bizim, tutar ve para birimi aynı. Değer cüzdana tek işlemde ve bir kez yazılır.
   */
  async completeCallback(token: string): Promise<{ ok: boolean; message: string; pending?: boolean }> {
    const db = this.prisma.platform;
    const p = await db.aiCreditPurchase.findUnique({ where: { token } });
    if (!p) return { ok: false, message: "Ödeme oturumu bulunamadı" };
    if (p.status !== "PENDING") return this.resultOf(p);
    if (this.client.environment !== p.environment) return { ok: false, message: "Online ödeme şu an kapalı" };
    let r: IyzicoPaymentFormResult;
    try {
      r = await this.client.retrievePaymentForm(token, p.conversationId);
    } catch (e) {
      if (e instanceof IyzicoError && e.errorCode !== "NOT_CONFIGURED") return this.fail(p, e.message || "Ödeme alınamadı");
      throw e;
    }
    if (r.conversationId && r.conversationId !== p.conversationId) return this.fail(p, "Ödeme oturumu eşleşmedi");
    if (r.paymentStatus !== "SUCCESS") {
      // Sonuç henüz yoksa (form yarıda) bekler; başarısızsa kapanır.
      if (!r.paymentId && (!r.paymentStatus || r.paymentStatus.startsWith("INIT"))) return { ok: false, pending: true, message: "Ödemeniz doğrulanıyor; birkaç dakika sonra sayfayı yenileyin" };
      return this.fail(p, r.errorMessage || "Ödeme alınamadı");
    }
    const txIds = (r.itemTransactions ?? []).map((i) => ({ itemId: i.itemId, paymentTransactionId: i.paymentTransactionId, paidPrice: i.paidPrice }));
    const reject = async (msg: string, action: string) => {
      await this.audit.logPlatform({ tenantId: p.tenantId, action, metadata: { purchaseId: p.id, expected: p.grossAmount.toFixed(2), price: r.price ?? null, paidPrice: r.paidPrice ?? null, currency: r.currency ?? null, basketId: r.basketId ?? null, paymentId: r.paymentId ?? null } });
      // Aynı gün iptal edilir (para iadesi); olmazsa SaaS sahibi panelden iade eder.
      let cancelled = false;
      if (r.paymentId) {
        cancelled = await this.client
          .cancelPayment({ paymentId: r.paymentId, conversationId: p.conversationId, ip: "127.0.0.1" })
          .then(() => true)
          .catch(async (e) => {
            this.logger.error(`İptal edilemedi (${p.id}): ${(e as Error).message}`);
            await this.audit.logPlatform({ tenantId: p.tenantId, action: "ai.topup_cancel_failed", metadata: { purchaseId: p.id, paymentId: r.paymentId, error: (e as Error).message } });
            return false;
          });
      }
      const paid = new Prisma.Decimal(r.paidPrice ?? txIds.reduce((a, t) => a + Number(t.paidPrice), 0));
      return this.fail(p, cancelled ? `${msg} (ödeme iptal edildi)` : msg, {
        iyzicoPaymentId: r.paymentId ?? null,
        paymentTransactionIds: txIds,
        ...(cancelled ? { refundedAmount: paid, refundedAt: new Date() } : {}),
      });
    };
    if (r.basketId !== p.id) return reject("Ödeme bu satın almaya ait değil; ücret iade edilecek", "ai.topup_basket_mismatch");
    if ((r.currency ?? "TRY") !== "TRY" || !amountEq(r.paidPrice, p.grossAmount) || !amountEq(r.price, p.grossAmount)) {
      return reject("Tahsil edilen tutar beklenenden farklı; paket yüklenmedi, ücret iade edilecek", "ai.topup_amount_mismatch");
    }
    if (r.fraudStatus === 0) {
      await db.aiCreditPurchase.update({ where: { id: p.id }, data: { iyzicoPaymentId: r.paymentId ?? null, paymentTransactionIds: txIds } });
      return { ok: false, pending: true, message: "Ödemeniz güvenlik incelemesinde; onaylanınca paket yüklenir" };
    }
    if (r.fraudStatus !== 1) return reject("Ödeme güvenlik kontrolünden geçmedi", "ai.topup_fraud_rejected");

    const done = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-topup:" + p.id}))::text`;
      const fresh = await tx.aiCreditPurchase.findUniqueOrThrow({ where: { id: p.id } });
      if (fresh.status !== "PENDING") return fresh;
      await this.quota.creditPurchase(tx, { tenantId: p.tenantId, purchaseId: p.id, creditKurus: p.creditKurus, actorId: p.userId });
      const u = await tx.aiCreditPurchase.update({ where: { id: p.id }, data: { status: "COMPLETED", completedAt: new Date(), iyzicoPaymentId: r.paymentId ?? null, paymentTransactionIds: txIds, error: null } });
      await tx.auditLog.create({ data: { tenantId: p.tenantId, actorId: p.userId, action: "ai.topup_completed", entity: "AiCreditPurchase", entityId: p.id, metadata: { env: p.environment, net: p.netAmount.toFixed(2), gross: p.grossAmount.toFixed(2), vatRate: p.vatRate.toFixed(2), creditKurus: p.creditKurus, paymentId: r.paymentId ?? null } } });
      return u;
    });
    if (done.status === "COMPLETED" && done.completedAt && Date.now() - done.completedAt.getTime() < 60_000) await this.notify(done).catch((e) => this.logger.error(`E-posta: ${(e as Error).message}`));
    return this.resultOf(done);
  }

  private resultOf(p: AiCreditPurchase) {
    if (p.status === "COMPLETED" || p.status === "REFUNDED") return { ok: p.status === "COMPLETED", message: p.status === "COMPLETED" ? "Ek paket yüklendi" : "Ödeme iade edildi" };
    if (p.status === "PENDING") return { ok: false, pending: true, message: "Ödemeniz doğrulanıyor" };
    return { ok: false, message: p.error ?? "Ödeme alınamadı" };
  }

  private async fail(p: AiCreditPurchase, msg: string, extra: Prisma.AiCreditPurchaseUpdateManyMutationInput = {}) {
    await this.prisma.platform.aiCreditPurchase.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED", error: msg.slice(0, 300), ...extra } });
    const now = await this.prisma.platform.aiCreditPurchase.findUniqueOrThrow({ where: { id: p.id } });
    return this.resultOf(now);
  }

  private async notify(p: AiCreditPurchase) {
    const db = this.prisma.platform;
    const [tenant, owner] = await Promise.all([
      db.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true } }),
      db.membership.findFirst({ where: { tenantId: p.tenantId, role: "OWNER", isActive: true }, include: { user: { select: { email: true } } } }),
    ]);
    if (!tenant || !owner) return;
    const amount = `${Number(p.grossAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`;
    await this.email.send(owner.user.email, { name: "ai_credit_purchased", vars: { salon: tenant.name, amount, link: `${appUrl(loadEnv())}/panel/abonelik` } }, { dedupeKey: `ai-topup:${p.id}`, tenantId: p.tenantId });
  }

  /** Günlük görev: dönüşü kaybolan ödemeler iyzico'dan sorgulanıp tamamlanır; sonuçsuz eski oturumlar kapanır. */
  async reconcilePending(now = new Date()) {
    const db = this.prisma.platform;
    const pending = await db.aiCreditPurchase.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, take: 200 });
    const errors: string[] = [];
    let completed = 0;
    let expired = 0;
    for (const p of pending) {
      try {
        if (!p.token) {
          await this.fail(p, "Ödeme formu açılamadı");
          expired++;
          continue;
        }
        const r = await this.completeCallback(p.token);
        if (r.ok) completed++;
        else if (r.pending && now.getTime() - p.createdAt.getTime() > 2 * 86_400_000 && !p.iyzicoPaymentId) {
          await this.fail(p, "Ödeme tamamlanmadı");
          expired++;
        }
      } catch (e) {
        errors.push(`ai-topup ${p.id}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { aiTopupsCompleted: completed, aiTopupsExpired: expired, errors };
  }

  /** SaaS sahibi: ek paket alımları. */
  async purchases() {
    const rows = await this.prisma.platform.aiCreditPurchase.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { tenant: { select: { name: true, slug: true } } } });
    const wallets = await this.prisma.platform.aiWallet.findMany({ where: { tenantId: { in: [...new Set(rows.map((r) => r.tenantId))] } } });
    return rows.map((p) => {
      const w = wallets.find((x) => x.tenantId === p.tenantId);
      const paidTotal = paidOf(p);
      // Ücret alınmış ama paket yüklenmemiş (reddedilmiş) alım: iptal tutmadıysa iade gerekir.
      const needsRefund = p.status === "FAILED" && !!p.iyzicoPaymentId && paidTotal.gt(p.refundedAmount);
      const creditLeft = Math.max(0, p.creditKurus - p.refundedCreditKurus);
      // Kullanılmamış pay (yaklaşık): ek bakiyede kalan, bu alımın değerini aşamaz.
      const unusedKurus = Math.min(creditLeft, Math.max(0, w?.purchasedRemainingKurus ?? 0));
      return {
        id: p.id, tenant: p.tenant, createdAt: p.createdAt, status: p.status, sandbox: p.environment === "sandbox",
        netAmount: p.netAmount.toFixed(2), grossAmount: p.grossAmount.toFixed(2), refundedAmount: p.refundedAmount.toFixed(2),
        creditTl: (p.creditKurus / 100).toFixed(2), unusedCreditTl: (unusedKurus / 100).toFixed(2),
        // Kullanılmamış pay oranında önerilen iade (KDV dahil)
        needsRefund,
        suggestedRefund: needsRefund ? paidTotal.minus(p.refundedAmount).toFixed(2) : p.status !== "COMPLETED" ? "0.00" : p.creditKurus > 0 ? p.grossAmount.mul(unusedKurus).div(p.creditKurus).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN).minus(p.refundedAmount).clampedTo(0, p.grossAmount).toFixed(2) : "0.00",
        error: p.error,
      };
    });
  }

  /**
   * SaaS sahibinin başlattığı iade: iyzico'da para iadesi yapılır ve iade oranında değer cüzdandan geri alınır.
   * Tutar KDV dahildir; ödenen tutardan önceki iadeler düşülerek sınırlanır.
   */
  async refund(purchaseId: string, amount: number, actorId: string, ip: string) {
    const db = this.prisma.platform;
    // Kilit, iyzico çağrısını da kapsar: iki tıklama aynı tutarı iki kez iade edemez.
    return db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-refund:" + purchaseId}))::text`;
        const p = await tx.aiCreditPurchase.findUnique({ where: { id: purchaseId } });
        if (!p) throw new NotFoundException("Satın alma bulunamadı");
        const txs = (p.paymentTransactionIds as { paymentTransactionId: string; paidPrice: number }[] | null) ?? [];
        // Yüklenmemiş ama ücreti alınmış (reddedilmiş) alım da iade edilebilir; cüzdandan bir şey düşülmez.
        const unloaded = p.status === "FAILED" && !!p.iyzicoPaymentId;
        if (p.status !== "COMPLETED" && !unloaded) throw new ConflictException("Bu alım için iade yapılamaz");
        if (!txs.length) throw new ConflictException("iyzico işlem kimliği yok; iade iyzico panelinden yapılmalı");
        if (this.client.environment !== p.environment) throw new ServiceUnavailableException("iyzico ortamı bu alımla eşleşmiyor");
        const price = new Prisma.Decimal(amount).toDecimalPlaces(2);
        const open = (unloaded ? paidOf(p) : p.grossAmount).minus(p.refundedAmount);
        if (!price.gt(0) || price.gt(open)) throw new BadRequestException(`İade edilebilir tutar en fazla ${Prisma.Decimal.max(open, 0).toFixed(2)} TL`);
        // Sepette tek kalem var (ek paket); yine de kalemlere sırayla dağıtılır.
        let left = price;
        for (const t of txs) {
          if (!left.gt(0)) break;
          const part = Prisma.Decimal.min(left, new Prisma.Decimal(t.paidPrice));
          try {
            await this.client.refundPayment({ paymentTransactionId: t.paymentTransactionId, price: part.toFixed(2), conversationId: p.conversationId, ip });
          } catch (e) {
            await this.audit.logPlatform({ tenantId: p.tenantId, actorId, action: "ai.topup_refund_failed", metadata: { purchaseId: p.id, price: part.toFixed(2), error: (e as Error).message } });
            throw new BadGatewayException(`iyzico iadeyi kabul etmedi: ${(e as Error).message}`);
          }
          left = left.minus(part);
        }
        // Para iyzico'da iade edildi: kayıt işlemi geri alınsa da iz kalsın (ayrı bağlantı).
        await this.audit.logPlatform({ tenantId: p.tenantId, actorId, action: "ai.topup_refund_sent", metadata: { purchaseId: p.id, price: price.toFixed(2) } });
        const creditBack = unloaded ? 0 : Math.ceil((p.creditKurus * Number(price)) / Number(p.grossAmount));
        const taken = creditBack > 0 ? await this.quota.debitRefund(tx, { tenantId: p.tenantId, purchaseId: p.id, creditKurus: creditBack, actorId, key: `ai-refund-${p.id}-${randomUUID()}` }) : 0;
        const inc = await tx.aiCreditPurchase.update({ where: { id: p.id }, data: { refundedAmount: { increment: price }, refundedCreditKurus: { increment: taken }, refundedAt: new Date() } });
        const u = !unloaded && inc.refundedAmount.gte(inc.grossAmount) ? await tx.aiCreditPurchase.update({ where: { id: p.id }, data: { status: "REFUNDED" } }) : inc;
        await tx.auditLog.create({ data: { tenantId: p.tenantId, actorId, ip, action: "ai.topup_refunded", entity: "AiCreditPurchase", entityId: p.id, metadata: { price: price.toFixed(2), creditTakenKurus: taken, creditWanted: creditBack, unloaded } } });
        return { id: u.id, status: u.status, refundedAmount: u.refundedAmount.toFixed(2), creditTakenTl: (taken / 100).toFixed(2) };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }
}
