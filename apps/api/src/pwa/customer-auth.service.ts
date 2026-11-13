import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { RateLimitService } from "../auth/rate-limit.service";
import { loadEnv, reviewLogin } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService, Tx } from "../prisma/prisma.service";

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_DAYS = 30;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
/** Kod özeti işletmeye ve adrese bağlıdır: başka işletme/adres için kullanılamaz. */
const codeHash = (tenantId: string, dest: string, code: string) =>
  createHash("sha256").update(`${loadEnv().JWT_SECRET}:otp:${tenantId}:${dest}:${code}`).digest("hex");

export interface PortalIdentity {
  sessionId: string;
  identityId: string;
  tenantId: string;
  email: string;
}

/**
 * Müşteri portalı kimlik doğrulaması: e-postaya gönderilen tek kullanımlık kod.
 * SMS sağlayıcısı yoktur; telefonla doğrulama yapılmaz (rapora bakın).
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger("CustomerAuth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private ctx(tenantId: string) {
    return { tenantId, userId: "" };
  }

  /** Kod gönderir. Adresin kayıtlı olup olmadığı yanıttan anlaşılmaz (her zaman aynı yanıt). */
  async requestCode(tenant: { id: string; name: string; slug?: string }, rawEmail: string, ip?: string) {
    const dest = rawEmail.trim().toLowerCase();
    this.rateLimit.hit(`otp-ip:${ip}`, 10, 60 * 60_000);
    this.rateLimit.hit(`otp-dest:${tenant.id}:${dest}`, 5, 60 * 60_000);
    // Mağaza incelemesi: yalnızca tanımlı demo işletmede ve tek adreste sabit kod; e-posta gönderilmez. Varsayılan kapalı.
    const review = reviewLogin(loadEnv());
    const isReview = !!review && !!tenant.slug && tenant.slug === review.slug && dest === review.email;
    if (!isReview && !this.email.deliveryConfigured) {
      throw new ServiceUnavailableException({ message: "Doğrulama e-postası şu anda gönderilemiyor. Lütfen işletmeyle iletişime geçin.", code: "OTP_UNAVAILABLE" });
    }
    const code = isReview ? review!.code : String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.prisma.withTenant(this.ctx(tenant.id), async (tx) => {
      // Önceki açık kodlar geçersiz olur: aynı anda yalnızca son kod çalışır.
      await tx.customerOtp.updateMany({ where: { destination: dest, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.customerOtp.create({
        data: { tenantId: tenant.id, destination: dest, codeHash: codeHash(tenant.id, dest, code), expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000), ip },
      });
    });
    if (isReview) return { sent: true, minutes: OTP_MINUTES };
    const res = await this.email.send(dest, { name: "customer_otp", vars: { salon: tenant.name, code, minutes: OTP_MINUTES } }, { tenantId: tenant.id });
    if ("failed" in res) this.logger.warn(`Doğrulama kodu e-postası gönderilemedi (${res.code})`);
    return { sent: true, minutes: OTP_MINUTES };
  }

  /** Kodu doğrular, kimliği oluşturur/günceller ve portal oturumu açar. Belirteç yalnızca bir kez döner (özeti saklanır). */
  async verifyCode(tenantId: string, rawEmail: string, code: string, meta: { ip?: string; userAgent?: string }) {
    const dest = rawEmail.trim().toLowerCase();
    this.rateLimit.hit(`otp-verify-ip:${meta.ip}`, 30, 60 * 60_000);
    const invalid = () => new HttpException({ message: "Kod hatalı veya süresi dolmuş", code: "OTP_INVALID" }, HttpStatus.UNAUTHORIZED);
    // Hatalı deneme sayacı kalıcı olmalı: hata transaction dışında fırlatılır (içeride fırlatılırsa artış geri alınır).
    const result = await this.prisma.withTenant(this.ctx(tenantId), async (tx) => {
      if (!(await this.consumeCode(tx, tenantId, dest, code))) return null;
      const now = new Date();
      const identity = await tx.customerIdentity.upsert({
        where: { tenantId_email: { tenantId, email: dest } },
        create: { tenantId, email: dest, verifiedAt: now, lastSeenAt: now },
        update: { verifiedAt: now, lastSeenAt: now },
      });
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
      await tx.customerPortalSession.create({
        data: { tenantId, identityId: identity.id, tokenHash: sha(token), expiresAt, userAgent: meta.userAgent?.slice(0, 300) },
      });
      await this.audit.log(tx, { tenantId, action: "portal.login", entity: "CustomerIdentity", entityId: identity.id, ip: meta.ip });
      return { token, expiresAt };
    });
    if (!result) throw invalid();
    return result;
  }

  /**
   * Kodu kontrol eder ve tek kullanımlık olarak tüketir. Hatalı denemede sayaç artar (5 hatada kod geçersizleşir).
   * Çağıran, false dönünce hatayı transaction DIŞINDA fırlatmalıdır; yoksa sayaç artışı geri alınır.
   */
  private async consumeCode(tx: Tx, tenantId: string, dest: string, code: string): Promise<boolean> {
    const otp = await tx.customerOtp.findFirst({
      where: { destination: dest, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return false;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await tx.customerOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      return false;
    }
    const expected = Buffer.from(otp.codeHash, "hex");
    const given = Buffer.from(codeHash(tenantId, dest, code), "hex");
    if (!timingSafeEqual(expected, given)) {
      await tx.customerOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 }, ...(otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      });
      return false;
    }
    // Tek kullanımlık: koşullu güncelleme eşzamanlı ikinci kullanımı engeller.
    const used = await tx.customerOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    return used.count === 1;
  }

  /**
   * Müşterinin portal hesabını kalıcı olarak siler (App Store / Google Play hesap silme şartı).
   * Oturum açık olmalı VE e-postaya yeni gönderilen kod girilmelidir (çalınmış oturumla silme yapılamaz).
   * Silinen: portal kimliği (e-posta ile giriş), tüm oturumlar, cihaz bildirim abonelikleri, uygulama içi bildirimler,
   * bekleyen kodlar ve randevulardaki portal bağlantısı. İşletmenin kendi müşteri kaydı ve randevu geçmişi işletmede kalır
   * (veri sorumlusu işletmedir); müşteri bunların silinmesini işletmeden ister.
   */
  async deleteIdentity(tenantId: string, token: string | undefined, code: string, meta: { ip?: string }) {
    this.rateLimit.hit(`otp-verify-ip:${meta.ip}`, 30, 60 * 60_000);
    const result = await this.prisma.withTenant(this.ctx(tenantId), async (tx) => {
      const me = await this.resolve(tx, tenantId, token);
      if (!(await this.consumeCode(tx, tenantId, me.email, code))) return null;
      await tx.appointment.updateMany({ where: { portalIdentityId: me.identityId }, data: { portalIdentityId: null } });
      await tx.inAppNotification.deleteMany({ where: { identityId: me.identityId } });
      await tx.customerOtp.deleteMany({ where: { destination: me.email } });
      // Oturumlar ve push abonelikleri yabancı anahtarla (CASCADE) birlikte silinir.
      await tx.customerIdentity.delete({ where: { id: me.identityId } });
      await this.audit.log(tx, { tenantId, action: "portal.identity_deleted", entity: "CustomerIdentity", entityId: me.identityId, ip: meta.ip });
      return { deleted: true };
    });
    if (!result) throw new HttpException({ message: "Kod hatalı veya süresi dolmuş", code: "OTP_INVALID" }, HttpStatus.UNAUTHORIZED);
    return result;
  }

  /** Oturum belirtecini doğrular (işletmeye bağlı). Geçersizse 401. */
  async resolve(tx: Tx, tenantId: string, token: string | undefined): Promise<PortalIdentity> {
    if (!token || token.length < 20 || token.length > 100) throw new UnauthorizedException({ message: "Lütfen e-posta kodunuzla giriş yapın", code: "PORTAL_LOGIN_REQUIRED" });
    const s = await tx.customerPortalSession.findUnique({ where: { tokenHash: sha(token) }, include: { identity: true } });
    if (!s || s.tenantId !== tenantId || s.revokedAt || s.expiresAt < new Date()) {
      throw new UnauthorizedException({ message: "Oturumunuz sona erdi, lütfen yeniden giriş yapın", code: "PORTAL_LOGIN_REQUIRED" });
    }
    if (Date.now() - s.lastSeenAt.getTime() > 10 * 60_000) {
      await tx.customerPortalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    }
    return { sessionId: s.id, identityId: s.identityId, tenantId, email: s.identity.email };
  }

  async logout(tenantId: string, token: string | undefined) {
    if (!token) return { ok: true };
    await this.prisma.withTenant(this.ctx(tenantId), (tx) =>
      tx.customerPortalSession.updateMany({ where: { tokenHash: sha(token), revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    return { ok: true };
  }
}
