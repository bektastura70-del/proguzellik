import { BadGatewayException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { BillingCycle, Plan, Prisma, PurchaseRequest, Subscription } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../audit/audit.service";
import { TenantInfo } from "../../common/decorators";
import { MARKETING_VERSION, slugify } from "../../auth/auth.service";
import { appUrl, iyzicoAllTenants, iyzicoPilotTenants, loadEnv, pricingPublic } from "../../config/env";
import { randomToken } from "../../security/crypto";
import { EmailService } from "../../email/email.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentProvider } from "../payment-provider";
import { approvedVersionsOf, cycleAmount, priceForNewSale, withVat } from "../plan-pricing";
import { IyzicoClient, IyzicoError, IyzicoOrder, IyzicoSubscriptionDetail, verifyIyzicoSubscriptionSignature } from "./iyzico.client";

export const IYZICO = "iyzico";
/** Yıllık pakette tam iade süresi (Teslimat ve İade 1.1, seçenek C). */
export const YEARLY_REFUND_DAYS = 14;
const addCycle = (d: Date, cycle: BillingCycle) => {
  const n = new Date(d);
  if (cycle === "MONTHLY") n.setUTCMonth(n.getUTCMonth() + 1);
  else n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

export interface IyzicoBillingInput {
  planCode: string;
  billingCycle: BillingCycle;
  /** Fatura bilgileri iyzico'ya iletilir, bizde saklanmaz. */
  billing: { fullName: string; identityNumber: string; gsmNumber: string; city: string; address: string };
  /** Mesafeli Satış Sözleşmesi ve Teslimat/İade Şartları onayı (sunucuda denetim kaydına yazılır) */
  acceptedTerms: true;
  /** Otomatik yenileme ve anında ifa (cayma hakkı yok) onayları; denetim kaydına yazılır */
  acceptedRenewal: true;
  acceptedInstantPerformance: true;
  termsVersion: string;
}

export type IyzicoBillingInfo = IyzicoBillingInput["billing"];

/** Ödeme formunun dönüş adresi: mevcut işletmenin paneli ya da siteden satın alma sonucu. */
export const CALLBACK_PATHS = { panel: "/api/odeme/iyzico/donus", purchase: "/api/odeme/iyzico/satin-al" } as const;

export interface WebhookBody {
  orderReferenceCode?: string;
  customerReferenceCode?: string;
  subscriptionReferenceCode?: string;
  iyziReferenceCode?: string;
  iyziEventType?: string;
}

/** Ödeme sayfasında onaylanan belgeler ve ayrı onaylar (sürüm: web IYZICO_DOCS_DATES). */
const TERMS_DOCS = ["on-bilgilendirme-formu", "mesafeli-satis-sozlesmesi", "teslimat-ve-iade-sartlari"];
const TERMS_CONSENTS = ["otomatik_yenileme", "aninda_ifa_cayma_yok"];

/**
 * iyzico Abonelik akışı:
 *  1) startCheckout: onaylı fiyat sürümü için iyzico ödeme planı (KDV dahil) bulunur/açılır, ödeme formu başlatılır.
 *  2) completeCallback: iyzico formu bize token ile döner; sonucu iyzico API'sinden SORGULAYIP doğrularız, abonelik açılır.
 *  3) handleWebhook / syncSubscription: aylık/yıllık çekimler bildirimle gelir; bildirim gövdesine güvenilmez, durum API'den okunur.
 * Kart bilgisi hiçbir aşamada sunucumuza gelmez.
 */
@Injectable()
export class IyzicoBillingService {
  private readonly logger = new Logger("IyzicoBilling");

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: IyzicoClient,
    private readonly payments: PaymentProvider,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** iyzico ödemesi bu süreçte açık mı (PAYMENT_MODE=iyzico, sandbox anahtarları girilmiş, canlı değil). */
  get enabled() {
    return this.payments.name === IYZICO && this.payments.acceptsPayments && this.client.environment != null;
  }

  /** Canlıda (pilot) yalnız listedeki işletmeler ödeme ekranını açabilir; geliştirmede hepsi. */
  allowedFor(tenantId: string) {
    const env = loadEnv();
    if (env.NODE_ENV !== "production") return true;
    return iyzicoAllTenants(env) || iyzicoPilotTenants(env).includes(tenantId.toLowerCase());
  }

  private assertEnabled() {
    if (!this.enabled) throw new ServiceUnavailableException({ message: "Online ödeme henüz aktif değil. Paket için bizimle iletişime geçin.", code: "ONLINE_PAYMENT_DISABLED" });
    if (!pricingPublic(loadEnv())) throw new ServiceUnavailableException({ message: "Paket fiyatları henüz açıklanmadı. Paket için bizimle iletişime geçin.", code: "PRICING_NOT_ANNOUNCED" });
  }

  private callbackUrl(kind: keyof typeof CALLBACK_PATHS) {
    const env = loadEnv();
    return `${(env.IYZICO_CALLBACK_BASE ?? appUrl(env)).replace(/\/$/, "")}${CALLBACK_PATHS[kind]}`;
  }

  /** Satılabilir paket + onaylı fiyat + dönem tutarı (KDV hariç ve dahil). */
  async saleQuote(planCode: string, cycle: BillingCycle) {
    const db = this.prisma.platform;
    const plan = await db.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive || !plan.isPublic) throw new NotFoundException("Paket bulunamadı");
    const price = priceForNewSale(await approvedVersionsOf(db, [plan.code]), new Date());
    if (!price) throw new ConflictException({ message: "Bu paketin onaylı fiyatı yok. Paket için bizimle iletişime geçin.", code: "PRICE_NOT_APPROVED" });
    const net = cycleAmount(price, cycle);
    if (!net.gt(0)) throw new ConflictException("Bu pakette bu ödeme dönemi yok");
    return { plan, price, net, gross: withVat(net, price.vatRate).gross };
  }

  /** iyzico ödeme formunu açar ve oturumu kaydeder (işletmeye ya da satın alma kaydına bağlı). */
  private async openForm(p: {
    owner: { tenantId: string; userId: string } | { purchaseRequestId: string };
    email: string;
    businessName: string;
    quote: Awaited<ReturnType<IyzicoBillingService["saleQuote"]>>;
    cycle: BillingCycle;
    billing: IyzicoBillingInfo;
    callback: keyof typeof CALLBACK_PATHS;
  }) {
    const env = this.client.environment!;
    const { plan, price, net, gross } = p.quote;
    // iyzico ürün/plan oluşturamazsa (ör. 100001: Abonelik ürünü hesapta açık değil) kullanıcı 500 yerine anlaşılır mesaj görür.
    const link = await this.planLink(env, plan, price, p.cycle).catch(async (e: unknown) => {
      if (!(e instanceof IyzicoError)) throw e;
      this.logger.error(`iyzico abonelik planı hazırlanamadı (${env}): ${e.message}`);
      await this.audit.logPlatform({ action: "iyzico.plan_failed", metadata: { env, plan: plan.code, cycle: p.cycle, error: e.message } });
      throw new BadGatewayException("Ödeme sistemi şu an abonelik başlatamıyor. Kartınızdan ücret alınmadı; lütfen daha sonra tekrar deneyin veya bizimle iletişime geçin.");
    });
    const conversationId = `pg-${randomUUID()}`;
    const parts = p.billing.fullName.trim().split(/\s+/);
    const surname = parts.length > 1 ? parts.pop()! : parts[0];
    const name = parts.join(" ") || surname;
    const gsm = p.billing.gsmNumber.replace(/[\s()-]/g, "").replace(/^0/, "+90").replace(/^90/, "+90").replace(/^5/, "+905");
    let form: { token: string; checkoutFormContent: string; tokenExpireTime?: number };
    try {
      form = await this.client.initCheckout({
        conversationId,
        callbackUrl: this.callbackUrl(p.callback),
        pricingPlanReferenceCode: link.pricingPlanReferenceCode,
        customer: {
          name,
          surname,
          email: p.email,
          gsmNumber: gsm,
          identityNumber: p.billing.identityNumber,
          billingAddress: { contactName: p.billing.fullName.trim(), city: p.billing.city.trim(), country: "Turkey", address: `${p.businessName}, ${p.billing.address.trim()}` },
        },
      });
    } catch (e) {
      throw new BadGatewayException((e as Error).message || "iyzico ödeme formu açılamadı");
    }
    await this.prisma.platform.iyzicoCheckout.create({
      data: {
        ...p.owner,
        environment: env,
        conversationId,
        token: form.token,
        planCode: plan.code,
        billingCycle: p.cycle,
        planPriceId: price.id,
        netAmount: net,
        vatRate: price.vatRate,
        grossAmount: gross,
        pricingPlanReferenceCode: link.pricingPlanReferenceCode,
      },
    });
    return { conversationId, env, result: { checkoutFormContent: form.checkoutFormContent, tokenExpireTime: form.tokenExpireTime ?? null, amount: gross.toFixed(2), netAmount: net.toFixed(2), vatRate: price.vatRate.toFixed(2) } };
  }

  /**
   * Siteden doğrudan satın alma: işletme henüz yok, oturum satın alma kaydına bağlanır.
   * Ön koşullar (e-posta doğrulandı, hesap/telefon çakışması yok, bayrak açık) PurchaseService'te denetlenir.
   */
  async startPurchaseCheckout(req: PurchaseRequest, billing: IyzicoBillingInfo, termsVersion: string, ip?: string) {
    this.assertEnabled();
    const quote = await this.saleQuote(req.planCode, req.billingCycle);
    if (quote.plan.maxStaff < 1) throw new ConflictException("Bu paket satışta değil");
    const { conversationId, env, result } = await this.openForm({ owner: { purchaseRequestId: req.id }, email: req.email, businessName: req.businessName, quote, cycle: req.billingCycle, billing, callback: "purchase" });
    await this.audit.logPlatform({ action: "purchase.checkout_started", ip, entity: "PurchaseRequest", entityId: req.id, metadata: { env, plan: quote.plan.code, cycle: req.billingCycle, gross: quote.gross.toFixed(2), conversationId, termsAccepted: { version: termsVersion, at: new Date().toISOString(), docs: TERMS_DOCS, consents: TERMS_CONSENTS } } });
    return result;
  }

  /** Onaylı fiyat sürümü + dönem için iyzico ödeme planı (bir kez açılır, sonra yeniden kullanılır). */
  private async planLink(env: "sandbox" | "live", plan: { code: string; name: string }, price: { id: string; version: number | null; monthlyPrice: Prisma.Decimal; yearlyPrice: Prisma.Decimal; vatRate: Prisma.Decimal }, cycle: BillingCycle) {
    const db = this.prisma.platform;
    const gross = withVat(cycleAmount(price, cycle), price.vatRate).gross;
    const found = await db.iyzicoPlanLink.findUnique({ where: { environment_planPriceId_billingCycle: { environment: env, planPriceId: price.id, billingCycle: cycle } } });
    if (found) {
      if (!found.grossAmount.eq(gross)) throw new ConflictException("iyzico planının tutarı onaylı fiyatla uyuşmuyor; SaaS sahibine bildirin");
      return found;
    }
    return db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`iyzico-plan:${env}:${price.id}:${cycle}`}))::text`;
        const again = await tx.iyzicoPlanLink.findUnique({ where: { environment_planPriceId_billingCycle: { environment: env, planPriceId: price.id, billingCycle: cycle } } });
        if (again) return again;
        const sibling = await tx.iyzicoPlanLink.findFirst({ where: { environment: env, planCode: plan.code } });
        const productRef = sibling?.productReferenceCode ?? (await this.productFor(plan.name));
        const cycleName = cycle === "MONTHLY" ? "Aylık" : "Yıllık";
        const p = await this.pricingPlanFor(productRef, { name: `${plan.name} ${cycleName} v${price.version ?? 0}`, price: gross.toFixed(2), interval: cycle });
        const link = await tx.iyzicoPlanLink.create({
          data: { environment: env, planCode: plan.code, planPriceId: price.id, billingCycle: cycle, productReferenceCode: productRef, pricingPlanReferenceCode: p.referenceCode, grossAmount: gross },
        });
        await tx.auditLog.create({ data: { action: "iyzico.plan_created", metadata: { env, plan: plan.code, cycle, planPriceId: price.id, gross: gross.toFixed(2), ref: p.referenceCode } } });
        return link;
      },
      { timeout: 30_000 },
    );
  }

  /** Paketin iyzico ürünü: yoksa açılır; iyzico "zaten var" derse (kaydı bizde olmayan ürün) adıyla bulunup kullanılır. */
  private async productFor(planName: string) {
    const name = `ProGüzellik ${planName}`;
    try {
      return (await this.client.createProduct(name, `ProGüzellik ${planName} paketi`)).referenceCode;
    } catch (e) {
      if (!(e instanceof IyzicoError) || e.errorCode !== "201001") throw e;
      const found = await this.client.findProduct(name);
      if (!found) throw e;
      return found.referenceCode;
    }
  }

  /**
   * Ödeme planı açılır; iyzico aynı adla plan olduğunu söylerse (kaydı bizde yok) yalnız tutar ve dönem
   * birebir aynıysa kullanılır, aksi hâlde yanlış tutar çekilmesin diye hata verilir.
   */
  private async pricingPlanFor(productRef: string, p: { name: string; price: string; interval: BillingCycle }) {
    try {
      return await this.client.createPricingPlan(productRef, p);
    } catch (e) {
      if (!(e instanceof IyzicoError) || e.errorCode !== "201051") throw e;
      const found = await this.client.findPricingPlan(productRef, p.name);
      if (!found || found.interval !== p.interval || !amountEq(found.price, new Prisma.Decimal(p.price))) {
        throw new ConflictException("iyzico'da aynı adla farklı tutarlı bir ödeme planı var; SaaS sahibine bildirin");
      }
      return { referenceCode: found.referenceCode };
    }
  }

  async startCheckout(t: TenantInfo, b: IyzicoBillingInput) {
    this.assertEnabled();
    if (!this.allowedFor(t.tenantId)) throw new ServiceUnavailableException({ message: "Online ödeme henüz aktif değil. Paket için bizimle iletişime geçin.", code: "ONLINE_PAYMENT_DISABLED" });
    const db = this.prisma.platform;
    const user = await db.user.findUniqueOrThrow({ where: { id: t.userId } });
    if (!user.emailVerifiedAt) throw new ForbiddenException({ message: "Ödeme yapmadan önce e-posta adresinizi doğrulayın", code: "EMAIL_NOT_VERIFIED" });
    const quote = await this.saleQuote(b.planCode, b.billingCycle);
    const { plan } = quote;
    const activeStaff = await db.staffMember.count({ where: { tenantId: t.tenantId, isActive: true } });
    if (activeStaff > plan.maxStaff) throw new ConflictException(`${plan.name} paketi en fazla ${plan.maxStaff} aktif personel destekler (şu an ${activeStaff}).`);
    const active = await db.subscription.findFirst({ where: { tenantId: t.tenantId, status: "ACTIVE" } });
    if (active) {
      throw new ConflictException({
        message: active.source === "MANUAL" ? "Paketiniz yönetici tarafından tanımlandı; değişiklik için bizimle iletişime geçin." : "Zaten aktif bir aboneliğiniz var. Paket değişikliği için bizimle iletişime geçin.",
        code: "SUBSCRIPTION_ACTIVE",
      });
    }
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: t.tenantId } });
    const { conversationId, env, result } = await this.openForm({ owner: { tenantId: t.tenantId, userId: t.userId }, email: user.email, businessName: tenant.name, quote, cycle: b.billingCycle, billing: b.billing, callback: "panel" });
    await this.audit.logPlatform({ tenantId: t.tenantId, actorId: t.userId, action: "iyzico.checkout_started", metadata: { env, plan: plan.code, cycle: b.billingCycle, gross: quote.gross.toFixed(2), conversationId, termsAccepted: { version: b.termsVersion, at: new Date().toISOString(), docs: TERMS_DOCS, consents: TERMS_CONSENTS } } });
    return result;
  }

  /**
   * iyzico ödeme formundan dönüş. Token yalnız bizim açtığımız bekleyen oturumla eşleşirse işlenir;
   * sonuç iyzico API'sinden okunur ve tutar/plan doğrulanır. Aynı token ikinci kez gelirse ilk sonuç döner.
   */
  async completeCallback(token: string): Promise<{ ok: boolean; message: string; pending?: boolean }> {
    const db = this.prisma.platform;
    const co = await db.iyzicoCheckout.findUnique({ where: { token } });
    if (!co) return { ok: false, message: "Ödeme oturumu bulunamadı" };
    if (co.status === "COMPLETED") return { ok: true, message: "Ödeme alındı" };
    if (co.status === "FAILED") return { ok: false, message: co.error ?? "Ödeme alınamadı" };
    if (!this.enabled || this.client.environment !== co.environment) return { ok: false, message: "Online ödeme şu an kapalı" };

    let result: Awaited<ReturnType<IyzicoClient["retrieveCheckout"]>>;
    try {
      result = await this.client.retrieveCheckout(token);
    } catch (e) {
      if (e instanceof IyzicoError && e.errorCode !== "NOT_CONFIGURED") return this.failCheckout(co.id, co.tenantId, e.message || "Ödeme alınamadı");
      throw e;
    }
    // iyzico'da bir abonelik oluştuysa ve biz açmıyorsak: referans saklanır ve iyzico'da iptal edilir (çekim sürmesin).
    const reject = async (msg: string) => {
      if (result.referenceCode) await this.safeCancel(result.referenceCode, co.tenantId);
      return this.failCheckout(co.id, co.tenantId, msg, result.referenceCode);
    };
    if (result.pricingPlanReferenceCode !== co.pricingPlanReferenceCode) return reject("Ödeme planı eşleşmedi");
    if (result.subscriptionStatus !== "ACTIVE") return reject("Abonelik başlatılamadı");
    const detail = await this.client.getSubscription(result.referenceCode);
    const paid = paidOrders(detail).sort((a, b) => (a.startPeriod ?? 0) - (b.startPeriod ?? 0))[0];
    if (!paid) {
      // Çekim henüz sonuçlanmadıysa oturum açık kalır; günlük görev ve bildirim sonra tamamlar.
      if (detail.orders.some((o) => o.orderStatus === "WAITING")) {
        await db.iyzicoCheckout.update({ where: { id: co.id }, data: { subscriptionReferenceCode: result.referenceCode } });
        return { ok: false, pending: true, message: "Ödemeniz doğrulanıyor; birkaç dakika sonra sayfayı yenileyin" };
      }
      return reject("İlk ödeme alınamadı");
    }
    if (!amountEq(paid.price, co.grossAmount)) {
      await this.audit.logPlatform({ tenantId: co.tenantId, action: "iyzico.amount_mismatch", metadata: { expected: co.grossAmount.toFixed(2), got: paid.price, ref: result.referenceCode } });
      return reject("Tahsil edilen tutar beklenenden farklı; abonelik açılmadı, iade için bizimle iletişime geçin");
    }

    const now = new Date();
    const start = paid.startPeriod ? new Date(paid.startPeriod) : now;
    const end = paid.endPeriod ? new Date(paid.endPeriod) : addCycle(start, co.billingCycle);
    const plan = await db.plan.findUniqueOrThrow({ where: { code: co.planCode } });
    if (co.purchaseRequestId) {
      return this.completePurchase({ ...co, purchaseRequestId: co.purchaseRequestId }, plan, { ref: result.referenceCode, customerRef: result.customerReferenceCode ?? null, orderRef: paid.referenceCode, start, end });
    }
    const tenantId = co.tenantId;
    if (!tenantId) return reject("Ödeme oturumu bir işletmeye bağlı değil");
    const outcome = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"subscription:" + tenantId}))::text`;
      const fresh = await tx.iyzicoCheckout.findUniqueOrThrow({ where: { id: co.id } });
      if (fresh.status !== "PENDING") return { already: fresh.status === "COMPLETED", replaced: [] as Subscription[] };
      const active = await tx.subscription.findFirst({ where: { tenantId: tenantId, status: "ACTIVE" } });
      if (active) return { conflict: true as const, replaced: [] as Subscription[] };
      // Önceki ödenmemiş (PAST_DUE) abonelikler kapanır; iyzico tarafındakiler aşağıda iptal edilir.
      const replaced = await tx.subscription.findMany({ where: { tenantId: tenantId, status: "PAST_DUE" } });
      await tx.subscription.updateMany({ where: { tenantId: tenantId, status: "PAST_DUE" }, data: { status: "CANCELLED" } });
      const sub = await tx.subscription.create({
        data: {
          tenantId: tenantId,
          planCode: co.planCode,
          billingCycle: co.billingCycle,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          provider: IYZICO,
          providerRef: result.referenceCode,
          planPriceId: co.planPriceId,
          priceAmount: co.netAmount,
          vatRate: co.vatRate,
        },
      });
      await tx.subscriptionPayment.create({
        data: { tenantId: tenantId, subscriptionId: sub.id, amount: co.grossAmount, netAmount: co.netAmount, vatRate: co.vatRate, status: "PAID", provider: IYZICO, providerRef: paid.referenceCode, description: `${plan.name} paketi`, idempotencyKey: `iyzico:order:${paid.referenceCode}` },
      });
      await tx.savedPaymentMethod.deleteMany({ where: { tenantId: tenantId } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", planCode: co.planCode, pastDueSince: null, limitExceededAt: null } });
      await tx.iyzicoCheckout.update({ where: { id: co.id }, data: { status: "COMPLETED", completedAt: now, subscriptionReferenceCode: result.referenceCode, customerReferenceCode: result.customerReferenceCode ?? null, subscriptionId: sub.id } });
      await tx.auditLog.create({ data: { tenantId: tenantId, actorId: co.userId, action: "subscription.activated", metadata: { provider: IYZICO, env: co.environment, plan: co.planCode, cycle: co.billingCycle, planPriceId: co.planPriceId, net: co.netAmount.toFixed(2), gross: co.grossAmount.toFixed(2), vatRate: co.vatRate.toFixed(2) } } });
      return { created: sub, replaced };
    });
    if ("conflict" in outcome) {
      // Aynı anda iki ödeme: ikinci iyzico aboneliği hemen iptal edilir, iade SaaS sahibince yapılır.
      await this.safeCancel(result.referenceCode, tenantId);
      await this.audit.logPlatform({ tenantId: tenantId, action: "iyzico.duplicate_subscription", metadata: { ref: result.referenceCode, order: paid.referenceCode, gross: co.grossAmount.toFixed(2) } });
      return this.failCheckout(co.id, tenantId, "Zaten aktif bir aboneliğiniz var; ikinci ödeme için iade sağlanacak, bizimle iletişime geçin", result.referenceCode);
    }
    for (const old of outcome.replaced) if (old.provider === IYZICO && old.providerRef) await this.safeCancel(old.providerRef, tenantId);
    if ("already" in outcome) return outcome.already ? { ok: true, message: "Ödeme alındı" } : { ok: false, message: "Ödeme alınamadı" };
    return { ok: true, message: "Ödeme alındı, aboneliğiniz başladı" };
  }

  /**
   * Siteden satın alma ödemesi doğrulandı: işletme, sahip hesabı, onay kayıtları ve abonelik tek işlemde açılır,
   * satın alma kaydı (parola özeti dahil) silinir. E-posta/telefon bu arada başka bir hesapta kullanıldıysa
   * hiçbir hesap açılmaz; iyzico aboneliği iptal edilir ve iade için kayıt düşülür.
   */
  private async completePurchase(
    co: Prisma.IyzicoCheckoutGetPayload<object> & { purchaseRequestId: string },
    plan: Plan,
    r: { ref: string; customerRef: string | null; orderRef: string; start: Date; end: Date },
  ): Promise<{ ok: boolean; message: string }> {
    const db = this.prisma.platform;
    const now = new Date();
    const outcome = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"purchase:" + co.purchaseRequestId}))::text`;
      const fresh = await tx.iyzicoCheckout.findUniqueOrThrow({ where: { id: co.id } });
      if (fresh.status !== "PENDING") return { already: fresh.status === "COMPLETED" } as const;
      const req = await tx.purchaseRequest.findUnique({ where: { id: co.purchaseRequestId } });
      if (!req) return { conflict: "Satın alma kaydı bulunamadı" } as const;
      // Deneme kaydıyla aynı kilit: aynı e-postayla eşzamanlı iki hesap açılmaz.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"signup:" + req.email}))::text`;
      if (await tx.user.findUnique({ where: { email: req.email }, select: { id: true } })) return { conflict: "Bu e-posta adresiyle başka bir hesap açılmış" } as const;
      if (await tx.tenant.findFirst({ where: { phone: req.phone, status: { not: "CANCELLED" } }, select: { id: true } })) return { conflict: "Bu telefon numarası başka bir işletmede kullanılıyor" } as const;
      let slug = slugify(req.businessName) || "isletme";
      if (await tx.tenant.findUnique({ where: { slug } })) slug = `${slug}-${randomToken().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
      const tenant = await tx.tenant.create({ data: { name: req.businessName, slug, status: "ACTIVE", planCode: co.planCode, phone: req.phone, email: req.email } });
      const user = await tx.user.create({ data: { email: req.email, passwordHash: req.passwordHash, fullName: req.fullName, phone: req.phone, emailVerifiedAt: req.verifiedAt ?? now } });
      await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
      const consent = { userId: user.id, ip: req.ip, userAgent: req.userAgent };
      await tx.userConsent.createMany({
        data: [
          { ...consent, type: "KVKK_NOTICE", granted: true, version: req.kvkkNoticeVersion, createdAt: req.createdAt },
          { ...consent, type: "TERMS", granted: true, version: req.termsVersion, createdAt: req.createdAt },
          { ...consent, type: "MARKETING", granted: req.marketingConsent, version: MARKETING_VERSION, createdAt: req.createdAt },
        ],
      });
      const sub = await tx.subscription.create({
        data: { tenantId: tenant.id, planCode: co.planCode, billingCycle: co.billingCycle, currentPeriodStart: r.start, currentPeriodEnd: r.end, provider: IYZICO, providerRef: r.ref, planPriceId: co.planPriceId, priceAmount: co.netAmount, vatRate: co.vatRate },
      });
      await tx.subscriptionPayment.create({
        data: { tenantId: tenant.id, subscriptionId: sub.id, amount: co.grossAmount, netAmount: co.netAmount, vatRate: co.vatRate, status: "PAID", provider: IYZICO, providerRef: r.orderRef, description: `${plan.name} paketi`, idempotencyKey: `iyzico:order:${r.orderRef}` },
      });
      await tx.iyzicoCheckout.update({ where: { id: co.id }, data: { status: "COMPLETED", completedAt: now, tenantId: tenant.id, userId: user.id, subscriptionReferenceCode: r.ref, customerReferenceCode: r.customerRef, subscriptionId: sub.id } });
      // Aynı e-postanın diğer bekleyen satın alma kayıtları da gereksizleşti (veri minimizasyonu).
      await tx.purchaseRequest.deleteMany({ where: { email: req.email } });
      const meta = { provider: IYZICO, env: co.environment, plan: co.planCode, cycle: co.billingCycle, planPriceId: co.planPriceId, net: co.netAmount.toFixed(2), gross: co.grossAmount.toFixed(2), vatRate: co.vatRate.toFixed(2) };
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorId: user.id, ip: req.ip, action: "tenant.registered", metadata: { via: "purchase", plan: co.planCode, requestedAt: req.createdAt.toISOString(), verifiedAt: req.verifiedAt?.toISOString() ?? null } } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorId: user.id, action: "subscription.activated", metadata: meta } });
      return { tenant, user } as const;
    });
    if ("already" in outcome) return outcome.already ? { ok: true, message: "Ödeme alındı" } : { ok: false, message: "Ödeme alınamadı" };
    if ("conflict" in outcome) {
      await this.safeCancel(r.ref, null);
      await this.audit.logPlatform({ action: "purchase.conflict_refund_needed", entity: "PurchaseRequest", entityId: co.purchaseRequestId, metadata: { reason: outcome.conflict ?? "", ref: r.ref, order: r.orderRef, gross: co.grossAmount.toFixed(2) } });
      await this.notifyPlatform(`İade gerekiyor: siteden satın alma (${co.grossAmount.toFixed(2)} TL)`, `Ödeme alındı ancak hesap açılamadı: ${outcome.conflict}. iyzico aboneliği iptal edildi (${r.ref}); sipariş ${r.orderRef} için iade yapın.`);
      return this.failCheckout(co.id, null, `${outcome.conflict}; hesap açılmadı. Ödemeniz iade edilecek, bizimle iletişime geçin.`, r.ref);
    }
    const env = loadEnv();
    const gross = co.grossAmount.toFixed(2);
    const { tenant, user } = outcome;
    try {
      await this.email.send(user.email, { name: "purchase_completed", vars: { fullName: user.fullName, salon: tenant.name, plan: plan.name, amount: gross, until: r.end.toISOString().slice(0, 10), link: `${appUrl(env)}/giris` } }, { dedupeKey: `purchase-completed:${co.id}`, tenantId: tenant.id });
      const company = await db.platformCompany.findUnique({ where: { id: 1 }, select: { email: true } });
      await this.email.send(company?.email || env.SUPPORT_EMAIL, { name: "purchase_received", vars: { salon: tenant.name, plan: plan.name, amount: gross, link: `${appUrl(env)}/platform?sekme=isletmeler` } }, { dedupeKey: `purchase-received:${co.id}` });
    } catch (e) {
      this.logger.warn(`Satın alma e-postası gönderilemedi: ${(e as Error).message}`);
    }
    return { ok: true, message: "Ödeme alındı, hesabınız açıldı" };
  }

  private async notifyPlatform(subject: string, body: string) {
    try {
      const company = await this.prisma.platform.platformCompany.findUnique({ where: { id: 1 }, select: { email: true } });
      await this.email.send(company?.email || loadEnv().SUPPORT_EMAIL, { name: "owner_notice", vars: { subject, body } });
    } catch {
      /* denetim kaydında görünür */
    }
  }

  private async failCheckout(id: string, tenantId: string | null, error: string, subscriptionReferenceCode?: string) {
    await this.prisma.platform.iyzicoCheckout.updateMany({ where: { id, status: "PENDING" }, data: { status: "FAILED", error, completedAt: new Date(), ...(subscriptionReferenceCode ? { subscriptionReferenceCode } : {}) } });
    await this.audit.logPlatform({ tenantId, action: "subscription.payment_failed", metadata: { provider: IYZICO, error, ref: subscriptionReferenceCode ?? null } });
    return { ok: false, message: error };
  }

  /**
   * Dönüşü hiç gelmeyen ödeme oturumları (sekme kapandı, bağlantı koptu): iyzico'da ödenmişse abonelik açılır.
   * Bir saatten eski ve iyzico'da tamamlanmamış oturum kapatılır. Günlük görev ve bilinmeyen abonelik bildirimi çağırır.
   */
  async reconcilePending(now = new Date(), minAgeMs = 60_000) {
    if (!this.enabled) return { completed: 0, closed: 0 };
    const db = this.prisma.platform;
    const pending = await db.iyzicoCheckout.findMany({
      where: { status: "PENDING", environment: this.client.environment!, token: { not: null }, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: new Date(now.getTime() - minAgeMs) } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let completed = 0;
    let closed = 0;
    for (const co of pending) {
      try {
        const r = await this.client.retrieveCheckout(co.token!);
        if (r.subscriptionStatus === "ACTIVE" && r.referenceCode) {
          if ((await this.completeCallback(co.token!)).ok) completed++;
        } else if (now.getTime() - co.createdAt.getTime() > 3_600_000) {
          await this.failCheckout(co.id, co.tenantId, "Ödeme tamamlanmadı");
          closed++;
        }
      } catch (e) {
        // iyzico tamamlanmamış formu hata ile bildirebilir: bir saat sonra kapatılır, öncesinde tekrar denenir.
        if (e instanceof IyzicoError && now.getTime() - co.createdAt.getTime() > 3_600_000) {
          await this.failCheckout(co.id, co.tenantId, "Ödeme tamamlanmadı");
          closed++;
        } else this.logger.warn(`Ödeme oturumu eşitlenemedi (${co.id}): ${(e as Error).message}`);
      }
    }
    return { completed, closed };
  }

  private async safeCancel(ref: string, tenantId: string | null) {
    try {
      await this.client.cancelSubscription(ref);
      await this.audit.logPlatform({ tenantId, action: "iyzico.subscription_cancelled", metadata: { ref } });
    } catch (e) {
      this.logger.error(`iyzico abonelik iptali başarısız (${ref}): ${(e as Error).message}`);
      await this.audit.logPlatform({ tenantId, action: "iyzico.cancel_failed", metadata: { ref, error: (e as Error).message } });
    }
  }

  /** İşletmenin iptal isteği: iyzico'da sonraki çekimler durdurulur, erişim dönem sonuna kadar sürer. */
  async cancelAtProvider(sub: Subscription) {
    if (!sub.providerRef) return;
    try {
      await this.client.cancelSubscription(sub.providerRef);
    } catch (e) {
      throw new BadGatewayException(`iyzico iptali yapılamadı: ${(e as Error).message}`);
    }
  }

  /**
   * Yıllık paket dönem başından itibaren YEARLY_REFUND_DAYS gün içinde iptal edilirse o dönemin bedeli iade edilir
   * (Teslimat ve İade 1.1). Para iadesi iyzico panelinden elle yapılır: burada yalnız denetim kaydı ve
   * SaaS sahibine bildirim oluşur. Erişim kuralı değişmez (dönem sonunda iptal).
   */
  async flagYearlyRefund(sub: Subscription, actorId: string | null, now = new Date()) {
    if (sub.provider !== IYZICO || sub.billingCycle !== "YEARLY") return false;
    const deadline = new Date(sub.currentPeriodStart.getTime() + YEARLY_REFUND_DAYS * 86_400_000);
    if (now.getTime() > deadline.getTime()) return false;
    const db = this.prisma.platform;
    const pay = await db.subscriptionPayment.findFirst({ where: { subscriptionId: sub.id, status: "PAID", provider: IYZICO }, orderBy: { createdAt: "desc" } });
    const tenant = await db.tenant.findUnique({ where: { id: sub.tenantId }, select: { name: true } });
    const amount = pay?.amount.toFixed(2) ?? "?";
    await this.audit.logPlatform({
      tenantId: sub.tenantId,
      actorId,
      action: "iyzico.refund_due",
      entity: "SubscriptionPayment",
      entityId: pay?.id,
      metadata: { reason: "yearly_cancel_within_14_days", order: pay?.providerRef ?? null, amount, periodStart: sub.currentPeriodStart.toISOString(), deadline: deadline.toISOString() },
    });
    await this.notifyPlatform(
      `İade gerekiyor: yıllık paket ${YEARLY_REFUND_DAYS} gün içinde iptal edildi (${amount} TL)`,
      `${tenant?.name ?? sub.tenantId} yıllık aboneliğini dönem başından itibaren ${YEARLY_REFUND_DAYS} gün içinde iptal etti. ` +
        `iyzico sipariş referansı: ${pay?.providerRef ?? "bulunamadı"}. iyzico panelinden ${amount} TL iade yapın, ` +
        `ardından Platform > İşletme > Tahsilatlar bölümünde bu ödemeyi "İade edildi" olarak işaretleyin.`,
    );
    return true;
  }

  /** Süresi dolup iptal edilen aboneliğin iyzico tarafı da durdurulur (otomatik çekim sürmesin). */
  cancelAfterLapse(sub: Subscription) {
    return sub.providerRef ? this.safeCancel(sub.providerRef, sub.tenantId) : Promise.resolve();
  }

  /**
   * Abonelik bildirimi. İmza doğrulanır (IYZICO_MERCHANT_ID gerekir), aynı bildirim bir kez işlenir,
   * durum her zaman iyzico API'sinden okunur (gövdedeki olay türüne güvenilmez).
   */
  async handleWebhook(body: WebhookBody, signature: string | undefined) {
    const env = loadEnv();
    const ref = body.subscriptionReferenceCode;
    if (!ref || !body.iyziReferenceCode || !body.iyziEventType || !body.orderReferenceCode) return { ok: false, reason: "eksik alan" };
    if (!env.IYZICO_SECRET_KEY || !env.IYZICO_MERCHANT_ID) throw new ServiceUnavailableException("iyzico bildirimi yapılandırılmadı");
    const valid =
      !!signature &&
      verifyIyzicoSubscriptionSignature(
        { merchantId: env.IYZICO_MERCHANT_ID, secretKey: env.IYZICO_SECRET_KEY, eventType: body.iyziEventType, subscriptionReferenceCode: ref, orderReferenceCode: body.orderReferenceCode, customerReferenceCode: body.customerReferenceCode ?? "" },
        signature,
      );
    if (!valid) throw new ForbiddenException("Geçersiz imza");
    const db = this.prisma.platform;
    try {
      await db.iyzicoWebhookEvent.create({ data: { iyziReferenceCode: body.iyziReferenceCode, eventType: body.iyziEventType, subscriptionReferenceCode: ref, orderReferenceCode: body.orderReferenceCode } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const prev = await db.iyzicoWebhookEvent.findUnique({ where: { iyziReferenceCode: body.iyziReferenceCode } });
        if (prev?.processedAt) return { ok: true, duplicate: true };
      } else throw e;
    }
    const result = await this.syncByRef(ref);
    await db.iyzicoWebhookEvent.update({ where: { iyziReferenceCode: body.iyziReferenceCode }, data: { processedAt: new Date(), result } });
    return { ok: true, result };
  }

  private async syncByRef(ref: string) {
    const sub = await this.prisma.platform.subscription.findFirst({ where: { provider: IYZICO, providerRef: ref }, orderBy: { createdAt: "desc" } });
    if (!sub) {
      // İlk çekim bildirimi dönüşten önce geldiyse ya da dönüş hiç gelmediyse: bekleyen oturumlar tamamlanır.
      await this.reconcilePending(new Date(), 0);
      const again = await this.prisma.platform.subscription.findFirst({ where: { provider: IYZICO, providerRef: ref }, orderBy: { createdAt: "desc" } });
      if (again) return this.syncSubscription(again);
      await this.audit.logPlatform({ action: "iyzico.webhook_unknown_subscription", metadata: { ref } });
      return "bilinmeyen abonelik";
    }
    return this.syncSubscription(sub);
  }

  /**
   * iyzico'daki aboneliği bizdeki kayıtla eşitler: başarılı her çekim bir kez ödeme kaydı olur, dönem ilerler;
   * dönem bitmiş ve ödeme alınamamışsa ödeme bekliyor (PAST_DUE) olur.
   */
  async syncSubscription(sub: Subscription, now = new Date()): Promise<string> {
    if (!sub.providerRef) return "referans yok";
    const db = this.prisma.platform;
    const detail = await this.client.getSubscription(sub.providerRef);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: sub.tenantId } });
    const plan = await db.plan.findUniqueOrThrow({ where: { code: sub.planCode } });
    const expectedGross = sub.priceAmount && sub.vatRate ? withVat(sub.priceAmount, sub.vatRate).gross : null;
    let recorded = 0;
    let periodEnd = sub.currentPeriodEnd;
    let periodStart = sub.currentPeriodStart;
    for (const o of paidOrders(detail)) {
      const key = `iyzico:order:${o.referenceCode}`;
      const exists = await db.subscriptionPayment.findUnique({ where: { idempotencyKey: key } });
      if (!exists) {
        const amount = new Prisma.Decimal(o.price);
        const matches = expectedGross ? amountEq(o.price, expectedGross) : false;
        await db.subscriptionPayment.create({
          data: { tenantId: sub.tenantId, subscriptionId: sub.id, amount, netAmount: matches ? sub.priceAmount : null, vatRate: matches ? sub.vatRate : null, status: "PAID", provider: IYZICO, providerRef: o.referenceCode, description: `${plan.name} yenileme`, idempotencyKey: key },
        });
        recorded++;
        if (!matches) await this.audit.logPlatform({ tenantId: sub.tenantId, action: "iyzico.amount_mismatch", metadata: { expected: expectedGross?.toFixed(2) ?? null, got: o.price, order: o.referenceCode } });
        if (sub.status === "CANCELLED") await this.audit.logPlatform({ tenantId: sub.tenantId, action: "iyzico.payment_after_cancel", metadata: { order: o.referenceCode, amount: o.price } });
      }
      if (o.endPeriod && o.endPeriod > periodEnd.getTime()) {
        periodEnd = new Date(o.endPeriod);
        periodStart = o.startPeriod ? new Date(o.startPeriod) : periodStart;
      }
    }
    if (sub.status !== "CANCELLED" && periodEnd.getTime() > sub.currentPeriodEnd.getTime()) {
      await db.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, status: "ACTIVE" } });
        await tx.tenant.updateMany({ where: { id: sub.tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } }, data: { status: "ACTIVE", pastDueSince: null } });
      });
      await this.audit.logPlatform({ tenantId: sub.tenantId, action: "lifecycle.renewed", metadata: { provider: IYZICO, until: periodEnd.toISOString() } });
      const to = await this.ownerEmail(sub.tenantId);
      if (to) await this.email.send(to, { name: "subscription_renewed", vars: { salon: tenant.name, plan: plan.name, amount: expectedGross?.toFixed(2) ?? "", until: periodEnd.toISOString().slice(0, 10) } }, { dedupeKey: `renewed:iyzico:${sub.id}:${periodEnd.toISOString()}`, tenantId: sub.tenantId });
      return `yenilendi (${recorded} ödeme)`;
    }
    // Dönem bitti, yeni ödeme yok: ödeme bekliyor. iyzico denemeyi sürdürürse sonraki başarılı bildirim aboneliği yeniden açar.
    if (sub.status === "ACTIVE" && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd.getTime() <= now.getTime()) {
      const u = await db.subscription.updateMany({ where: { id: sub.id, status: "ACTIVE", currentPeriodEnd: sub.currentPeriodEnd }, data: { status: "PAST_DUE" } });
      if (u.count > 0) {
        await db.tenant.updateMany({ where: { id: sub.tenantId, status: "ACTIVE" }, data: { status: "PAST_DUE", pastDueSince: sub.currentPeriodEnd } });
        await this.audit.logPlatform({ tenantId: sub.tenantId, action: "lifecycle.renewal_failed", metadata: { provider: IYZICO, iyzicoStatus: detail.subscriptionStatus } });
        const to = await this.ownerEmail(sub.tenantId);
        if (to) await this.email.send(to, { name: "payment_failed", vars: { salon: tenant.name, graceDays: loadEnv().BILLING_GRACE_DAYS, link: `${appUrl(loadEnv())}/panel/abonelik` } }, { dedupeKey: `payment-failed:iyzico:${sub.id}:${sub.currentPeriodEnd.toISOString()}`, tenantId: sub.tenantId });
        return "ödeme bekliyor";
      }
    }
    return recorded ? `${recorded} ödeme kaydedildi` : "değişiklik yok";
  }

  private async ownerEmail(tenantId: string) {
    const m = await this.prisma.platform.membership.findFirst({ where: { tenantId, role: "OWNER", isActive: true }, include: { user: { select: { email: true } } } });
    return m?.user.email ?? null;
  }
}

const paidOrders = (d: IyzicoSubscriptionDetail): IyzicoOrder[] => d.orders.filter((o) => o.orderStatus === "SUCCESS");
const amountEq = (a: number | string, b: Prisma.Decimal) => new Prisma.Decimal(a).toDecimalPlaces(2).eq(b.toDecimalPlaces(2));
