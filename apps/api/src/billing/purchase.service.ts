import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { BillingCycle } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { BCRYPT_ROUNDS, ClientMeta, KVKK_NOTICE_VERSION, normalizePhone, TERMS_VERSION } from "../auth/auth.service";
import { RateLimitService } from "../auth/rate-limit.service";
import { appUrl, iyzicoAllTenants, loadEnv, pricingPublic, purchaseEnabled } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { randomToken, sha256 } from "../security/crypto";
import { IyzicoBillingInfo, IyzicoBillingService } from "./iyzico/iyzico-billing.service";

/** E-posta bağlantısının (ve ödeme adımının) geçerlilik süresi (saat). */
export const PURCHASE_HOURS = 24;
/** Bir satın alma kaydıyla en fazla bu kadar ödeme formu açılabilir. */
export const MAX_CHECKOUTS_PER_REQUEST = 5;
/** Aynı e-posta / telefon için en fazla bu kadar açık satın alma kaydı. */
const MAX_OPEN_PER_EMAIL = 3;
const MAX_OPEN_PER_PHONE = 3;
/** Form bundan kısa sürede gönderildiyse bot sayılır (insan bu sürede dolduramaz). */
export const MIN_FILL_MS = 3000;

export interface PurchaseInput {
  businessName: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  planCode: string;
  billingCycle: BillingCycle;
  marketingConsent?: boolean;
  /** Bal küpü: insan kullanıcı görmez; doluysa istek sessizce yok sayılır. */
  hp?: string;
  /** Formun açılmasından gönderilmesine kadar geçen süre (ms) */
  elapsedMs?: number;
}

/**
 * Siteden denemesiz doğrudan paket satın alma.
 * Akış: form → e-posta doğrulama bağlantısı → fatura bilgileri + sözleşme onayı → iyzico ödeme formu →
 * ödeme iyzico'da doğrulanınca işletme ve sahip hesabı aktif abonelikle açılır (IyzicoBillingService.completePurchase).
 * Ödeme olmadan hiçbir kullanıcı/işletme oluşmaz; bekleyen kayıt süresi dolunca günlük görevle silinir.
 */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iyzico: IyzicoBillingService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  /** Satın alma bu ortamda açık mı (bayrak + iyzico + fiyatlar + e-posta; canlıda iyzico tüm işletmelerde açık olmalı). */
  get available() {
    const env = loadEnv();
    if (!purchaseEnabled(env) || !this.iyzico.enabled || !pricingPublic(env) || !this.email.deliveryConfigured) return false;
    return env.NODE_ENV !== "production" || iyzicoAllTenants(env);
  }

  status() {
    return { enabled: this.available };
  }

  private assertAvailable() {
    if (!purchaseEnabled(loadEnv())) throw new ForbiddenException({ message: "Siteden paket satın alma şu anda kapalı", code: "PURCHASE_DISABLED" });
    if (!this.available) throw new ServiceUnavailableException({ message: "Online satın alma şu an kullanılamıyor. Lütfen daha sonra tekrar deneyin veya info@proguzellik.com adresine yazın.", code: "PURCHASE_UNAVAILABLE" });
  }

  /** Açık bir işletmede (iptal edilmemiş) kullanılan telefonla yeni satın alma yapılmaz. */
  private async assertPhoneFree(phone: string) {
    const t = await this.db.tenant.findFirst({ where: { phone, status: { not: "CANCELLED" } }, select: { id: true } });
    if (t) throw new ConflictException({ message: "Bu telefon numarası kayıtlı bir işletmede kullanılıyor. Mevcut hesabınızla giriş yapıp Abonelik sayfasından paket alabilir ya da info@proguzellik.com adresine yazabilirsiniz.", code: "PHONE_IN_USE" });
  }

  /** 1. adım: form. Hiçbir kullanıcı/işletme oluşmaz; doğrulama e-postası gider. */
  async request(input: PurchaseInput, meta: ClientMeta) {
    this.assertAvailable();
    const email = input.email.trim().toLowerCase();
    const accepted = { status: "VERIFICATION_SENT" as const, email, expiresInHours: PURCHASE_HOURS };
    if (input.hp || (input.elapsedMs != null && input.elapsedMs < MIN_FILL_MS)) {
      // bot: kayıt yazılmaz, e-posta gitmez; yanlış pozitifler görünsün diye yalnız IP denetime düşer
      await this.audit.logPlatform({ action: "purchase.bot_suspected", ip: meta.ip, metadata: { honeypot: !!input.hp, elapsedMs: input.elapsedMs ?? null } });
      return accepted;
    }
    const phone = normalizePhone(input.phone);
    this.rateLimit.hit(`purchase-phone:${phone}`, 3, 60 * 60_000);
    // Fiyat ve dönem şimdiden denetlenir (onaylı fiyatı olmayan paket satın alınamaz).
    const quote = await this.iyzico.saleQuote(input.planCode, input.billingCycle);

    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      await bcrypt.hash(input.password, BCRYPT_ROUNDS); // yanıt süresinden hesap varlığı anlaşılmasın
      await this.email.send(email, { name: "purchase_exists", vars: { fullName: existing.fullName, link: `${appUrl(loadEnv())}/giris` } }, { dedupeKey: `purchase-exists:${existing.id}:${new Date().toISOString().slice(0, 13)}` });
      await this.audit.logPlatform({ action: "purchase.existing_email", actorId: existing.id, ip: meta.ip });
      return accepted;
    }
    await this.assertPhoneFree(phone);
    const now = new Date();
    // Doğrulanmamış eski istekler yenisiyle geçersiz olur; doğrulanmış (ödemesi sürüyor olabilecek) kayıtlar korunur.
    await this.db.purchaseRequest.deleteMany({ where: { email, verifiedAt: null } });
    const openEmail = await this.db.purchaseRequest.count({ where: { email, expiresAt: { gt: now } } });
    const openPhone = await this.db.purchaseRequest.count({ where: { phone, email: { not: email }, expiresAt: { gt: now } } });
    if (openEmail >= MAX_OPEN_PER_EMAIL || openPhone >= MAX_OPEN_PER_PHONE) {
      throw new HttpException("Bu bilgilerle çok sayıda bekleyen satın alma isteği var. E-postanızdaki bağlantıyı kullanın ya da bir gün sonra tekrar deneyin.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const token = randomToken();
    const req = await this.db.purchaseRequest.create({
      data: {
        email,
        businessName: input.businessName.trim(),
        fullName: input.fullName.trim(),
        phone,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
        planCode: quote.plan.code,
        billingCycle: input.billingCycle,
        kvkkNoticeVersion: KVKK_NOTICE_VERSION,
        termsVersion: TERMS_VERSION,
        marketingConsent: input.marketingConsent === true,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + PURCHASE_HOURS * 3_600_000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    const sent = await this.email.send(email, { name: "purchase_verify", vars: { fullName: req.fullName, salon: req.businessName, plan: quote.plan.name, hours: PURCHASE_HOURS, link: `${appUrl(loadEnv())}/satin-al/odeme?token=${token}` } });
    if ("failed" in sent) {
      await this.db.purchaseRequest.deleteMany({ where: { id: req.id } });
      throw new ServiceUnavailableException({ message: "Doğrulama e-postası gönderilemedi. E-posta adresinizi kontrol edip tekrar deneyin.", code: sent.code });
    }
    await this.audit.logPlatform({ action: "purchase.requested", ip: meta.ip, entity: "PurchaseRequest", entityId: req.id, metadata: { plan: req.planCode, cycle: req.billingCycle, marketingConsent: req.marketingConsent } });
    return accepted;
  }

  private async findOpen(token: string) {
    const req = await this.db.purchaseRequest.findUnique({ where: { tokenHash: sha256(token) } });
    if (!req || req.expiresAt <= new Date()) throw new NotFoundException({ message: "Bağlantı geçersiz veya süresi dolmuş. Fiyatlar sayfasından yeniden satın alma isteği oluşturun.", code: "PURCHASE_LINK_INVALID" });
    return req;
  }

  /** 2. adım: e-posta bağlantısı açıldı. E-posta doğrulanmış sayılır; ödeme özeti döner. */
  async verify(token: string, meta: ClientMeta) {
    const req = await this.findOpen(token);
    if (!req.verifiedAt) {
      const u = await this.db.purchaseRequest.updateMany({ where: { id: req.id, verifiedAt: null }, data: { verifiedAt: new Date() } });
      if (u.count) await this.audit.logPlatform({ action: "purchase.email_verified", ip: meta.ip, entity: "PurchaseRequest", entityId: req.id });
    }
    const quote = await this.iyzico.saleQuote(req.planCode, req.billingCycle);
    const completed = await this.db.iyzicoCheckout.findFirst({ where: { purchaseRequestId: req.id, status: "PENDING", subscriptionReferenceCode: { not: null } }, select: { id: true } });
    return {
      businessName: req.businessName,
      fullName: req.fullName,
      email: req.email,
      phone: req.phone,
      plan: { code: quote.plan.code, name: quote.plan.name, maxStaff: quote.plan.maxStaff },
      billingCycle: req.billingCycle,
      netAmount: quote.net.toFixed(2),
      vatRate: quote.price.vatRate.toFixed(2),
      grossAmount: quote.gross.toFixed(2),
      expiresAt: req.expiresAt.toISOString(),
      /** iyzico'da ödemesi doğrulanmayı bekleyen bir oturum var (yeni ödeme başlatılmamalı) */
      paymentPending: !!completed,
      available: this.available,
    };
  }

  /** 3. adım: fatura bilgileri + sözleşme onayı → iyzico ödeme formu. */
  async checkout(token: string, billing: IyzicoBillingInfo, termsVersion: string, meta: ClientMeta) {
    this.assertAvailable();
    const req = await this.findOpen(token);
    if (!req.verifiedAt) throw new BadRequestException("Önce e-posta bağlantısını açın");
    if (await this.db.iyzicoCheckout.findFirst({ where: { purchaseRequestId: req.id, status: "PENDING", subscriptionReferenceCode: { not: null } }, select: { id: true } })) {
      throw new ConflictException({ message: "Ödemeniz doğrulanıyor; birkaç dakika sonra e-postanızı kontrol edin.", code: "PAYMENT_PENDING" });
    }
    if (await this.db.user.findUnique({ where: { email: req.email }, select: { id: true } })) {
      throw new ConflictException({ message: "Bu e-posta adresiyle bir hesap açılmış. Giriş yapıp Abonelik sayfasından paket alabilirsiniz.", code: "EMAIL_IN_USE" });
    }
    await this.assertPhoneFree(req.phone);
    const claimed = await this.db.purchaseRequest.updateMany({ where: { id: req.id, checkoutCount: { lt: MAX_CHECKOUTS_PER_REQUEST } }, data: { checkoutCount: { increment: 1 } } });
    if (!claimed.count) throw new HttpException("Bu satın alma isteğiyle çok sayıda ödeme denemesi yapıldı. Fiyatlar sayfasından yeni bir istek oluşturun.", HttpStatus.TOO_MANY_REQUESTS);
    return this.iyzico.startPurchaseCheckout(req, billing, termsVersion, meta.ip);
  }
}

/**
 * Süresi dolmuş satın alma kayıtlarını siler (parola özeti ve kişisel veri tutulmaz).
 * iyzico'da ödemesi doğrulanmayı bekleyen oturumu olan kayıt, oturum eşitlenebildiği sürece (8 gün) korunur.
 */
export async function purgePurchaseRequests(db: PrismaService["platform"], now: Date) {
  const pending = await db.iyzicoCheckout.findMany({ where: { status: "PENDING", purchaseRequestId: { not: null } }, select: { purchaseRequestId: true } });
  const keep = pending.map((p) => p.purchaseRequestId!).filter(Boolean);
  const a = await db.purchaseRequest.deleteMany({ where: { expiresAt: { lt: now }, ...(keep.length ? { id: { notIn: keep } } : {}) } });
  const b = await db.purchaseRequest.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 8 * 86_400_000) } } });
  return a.count + b.count;
}
