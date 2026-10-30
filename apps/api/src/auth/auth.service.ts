import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { decrypt, encrypt, newTotpSecret, otpauthUrl, randomToken, recoveryCode, sha256, verifyTotp } from "../security/crypto";
import { SessionService } from "./session.service";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const TRIAL_DAYS = 14;
const RESET_MINUTES = 30;
const VERIFY_HOURS = 48;
/** Ücretsiz deneme doğrulama bağlantısının geçerlilik süresi (saat) */
export const SIGNUP_HOURS = 24;
/** Kayıtta gösterilen metinlerin sürümü: metin değişince güncellenir, onay kaydında saklanır. */
export const KVKK_NOTICE_VERSION = "/kvkk@2026-10-30";
export const TERMS_VERSION = "/kullanim-kosullari@2026-10-30";
export const MARKETING_VERSION = "kayit-formu-ticari-ileti@2026-10-30";

export interface TrialSignupInput { businessName: string; fullName: string; email: string; password: string; phone: string; planCode?: string; marketingConsent?: boolean }

/** Türkiye telefonu: 0 / 90 / +90 öneklerini kaldırır, 10 haneyi +90 ile döndürür. */
export function normalizePhone(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("90")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[2-5]\d{9}$/.test(d)) throw new BadRequestException("Geçerli bir telefon numarası girin (ör. 0532 123 45 67)");
  return `+90${d}`;
}
const RECOVERY_CODES = 10;

import { BCRYPT_ROUNDS, passwordSchema } from "./password";

export { BCRYPT_ROUNDS };
const DUMMY_HASH = bcrypt.hashSync("zamanlama-dengeleme", BCRYPT_ROUNDS);

export function slugify(input: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

/** Oturum açıkken parola/kod doğrulaması başarısız: istemci bunu oturum sonu saymamalı. */
export const REAUTH_FAILED = "REAUTH_FAILED";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly email: EmailService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  private async registerFailure(userId: string, field: "failedLogins" | "mfaFailedAttempts", current: number) {
    const failed = current + 1;
    await this.db.user.update({
      where: { id: userId },
      data: {
        [field]: failed >= MAX_FAILED ? 0 : failed,
        ...(failed >= MAX_FAILED ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : {}),
      },
    });
  }

  /** 1. adım: parola. 2FA açıksa oturum açılmaz, kısa ömürlü mfaToken döner. */
  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    const generic = new UnauthorizedException("E-posta veya parola hatalı");
    if (!user || !user.isActive) {
      await bcrypt.compare(password, DUMMY_HASH);
      await this.audit.logPlatform({ action: "auth.login_failed", metadata: { email }, ip: meta.ip });
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.logPlatform({ action: "auth.login_locked", actorId: user.id, ip: meta.ip });
      throw new UnauthorizedException("Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.");
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await this.registerFailure(user.id, "failedLogins", user.failedLogins);
      await this.audit.logPlatform({ action: "auth.login_failed", actorId: user.id, ip: meta.ip });
      throw generic;
    }
    await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

    if (user.mfaEnabledAt) {
      const mfaToken = await this.jwt.signAsync({ sub: user.id, typ: "mfa" }, { expiresIn: "5m" });
      await this.audit.logPlatform({ action: "auth.mfa_challenge", actorId: user.id, ip: meta.ip });
      return { mfaRequired: true as const, mfaToken };
    }
    return this.completeLogin(user.id, meta, false);
  }

  private async completeLogin(userId: string, meta: ClientMeta, mfaVerified: boolean) {
    const { accessToken } = await this.sessions.create(userId, { ...meta, mfaVerified });
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.logPlatform({ action: "auth.login", actorId: userId, ip: meta.ip, metadata: { mfa: mfaVerified } });
    return { accessToken, user: await this.profile(userId) };
  }

  /** 2. adım: TOTP kodu veya kurtarma kodu. */
  async verifyMfa(mfaToken: string, input: { code?: string; recoveryCode?: string }, meta: ClientMeta) {
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(mfaToken);
    } catch {
      throw new UnauthorizedException("Doğrulama süresi doldu, lütfen yeniden giriş yapın");
    }
    if (payload.typ !== "mfa") throw new UnauthorizedException("Geçersiz doğrulama belirteci");
    const user = await this.db.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.mfaEnabledAt || !user.mfaSecretEnc) throw new UnauthorizedException("Geçersiz doğrulama");
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException("Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.");

    let ok = false;
    if (input.code) {
      const step = verifyTotp(decrypt(user.mfaSecretEnc, loadEnv().MFA_ENCRYPTION_KEY), input.code);
      // Aynı kodun (adımın) ikinci kez kullanılması engellenir.
      if (step !== null && (user.mfaLastStep === null || step > user.mfaLastStep)) {
        const r = await this.db.user.updateMany({ where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
        ok = r.count === 1;
      }
    } else if (input.recoveryCode) {
      const hash = sha256(input.recoveryCode.trim().toLowerCase());
      const r = await this.db.recoveryCode.updateMany({ where: { userId: user.id, codeHash: hash, usedAt: null }, data: { usedAt: new Date() } });
      ok = r.count === 1;
      if (ok) await this.audit.logPlatform({ action: "auth.recovery_code_used", actorId: user.id, ip: meta.ip });
    }
    if (!ok) {
      await this.registerFailure(user.id, "mfaFailedAttempts", user.mfaFailedAttempts);
      await this.audit.logPlatform({ action: "auth.mfa_failed", actorId: user.id, ip: meta.ip });
      throw new UnauthorizedException("Doğrulama kodu hatalı");
    }
    await this.db.user.update({ where: { id: user.id }, data: { mfaFailedAttempts: 0 } });
    return this.completeLogin(user.id, meta, true);
  }

  async profile(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isPlatformAdmin: true,
        mustChangePassword: true,
        emailVerifiedAt: true,
        mfaEnabledAt: true,
        memberships: {
          where: { isActive: true },
          select: {
            role: true,
            tenant: {
              select: { id: true, name: true, slug: true, status: true, trialEndsAt: true, planCode: true, requireMfa: true, plan: { select: { name: true, features: true } } },
            },
          },
        },
      },
    });
    const recoveryCodesLeft = user.mfaEnabledAt ? await this.db.recoveryCode.count({ where: { userId, usedAt: null } }) : 0;
    return { ...user, mfaEnabled: !!user.mfaEnabledAt, emailVerified: !!user.emailVerifiedAt, recoveryCodesLeft };
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException({ message: "Parola hatalı", code: REAUTH_FAILED });
    return user;
  }

  async changePassword(userId: string, sid: string, current: string, next: string, ip?: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      await this.audit.logPlatform({ action: "auth.password_change_failed", actorId: userId, ip });
      throw new UnauthorizedException("Mevcut parola hatalı");
    }
    if (current === next) throw new ConflictException("Yeni parola eskisinden farklı olmalı");
    await this.db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS), mustChangePassword: false } });
    const { revoked } = await this.sessions.revokeAll(userId, sid);
    await this.audit.logPlatform({ action: "auth.password_changed", actorId: userId, ip, metadata: { revokedSessions: revoked } });
    await this.email.send(user.email, { name: "password_changed", vars: { fullName: user.fullName } });
    return { changed: true, revokedSessions: revoked };
  }

  /* ----------------------- Parola sıfırlama ----------------------- */

  /** Hesabın var olup olmadığını belli etmeyen yanıt döner. */
  async forgotPassword(email: string, ip?: string) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && user.isActive) {
      await this.issuePasswordReset(user, ip);
      await this.audit.logPlatform({ action: "auth.password_reset_requested", actorId: user.id, ip });
    } else {
      await bcrypt.compare("x", DUMMY_HASH);
    }
    return { ok: true, message: "Bu e-posta ile bir hesap varsa sıfırlama bağlantısı gönderildi." };
  }

  /**
   * Tek kullanımlık sıfırlama bağlantısı üretip e-postayla gönderir; önceki açık bağlantılar geçersiz olur.
   * Belirteç yalnızca e-postada bulunur (yanıt, log ve denetim kaydına yazılmaz).
   */
  async issuePasswordReset(user: { id: string; email: string; fullName: string }, ip?: string) {
    const token = randomToken();
    await this.db.$transaction([
      this.db.authToken.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } }),
      this.db.authToken.create({
        data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000), ip },
      }),
    ]);
    return this.email.send(user.email, {
      name: "password_reset",
      vars: { fullName: user.fullName, link: `${appUrl(loadEnv())}/parola-sifirla?token=${token}`, minutes: RESET_MINUTES },
    });
  }

  private async consumeToken(token: string, type: "PASSWORD_RESET" | "EMAIL_VERIFY") {
    const hash = sha256(token);
    const rec = await this.db.authToken.findUnique({ where: { tokenHash: hash } });
    if (!rec || rec.type !== type || rec.usedAt || rec.expiresAt <= new Date()) {
      throw new BadRequestException("Bağlantı geçersiz veya süresi dolmuş");
    }
    // Eşzamanlı kullanımda yalnızca bir istek başarılı olur.
    const r = await this.db.authToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (r.count !== 1) throw new BadRequestException("Bağlantı geçersiz veya süresi dolmuş");
    return rec;
  }

  async resetPassword(token: string, newPassword: string, ip?: string) {
    const rec = await this.consumeToken(token, "PASSWORD_RESET");
    const before = await this.db.user.findUniqueOrThrow({ where: { id: rec.userId } });
    const user = await this.db.user.update({
      where: { id: rec.userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
        failedLogins: 0,
        lockedUntil: null,
        // Sıfırlama bağlantısı e-postaya geldiği için adres doğrulanmış sayılır.
        emailVerifiedAt: before.emailVerifiedAt ?? new Date(),
      },
    });
    const { revoked } = await this.sessions.revokeAll(user.id);
    await this.audit.logPlatform({ action: "auth.password_reset", actorId: user.id, ip, metadata: { revokedSessions: revoked } });
    await this.email.send(user.email, { name: "password_changed", vars: { fullName: user.fullName } });
    return { reset: true };
  }

  /* ----------------------- E-posta doğrulama ----------------------- */

  async sendVerification(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return { alreadyVerified: true };
    const token = randomToken();
    await this.db.$transaction([
      this.db.authToken.updateMany({ where: { userId, type: "EMAIL_VERIFY", usedAt: null }, data: { usedAt: new Date() } }),
      this.db.authToken.create({ data: { userId, type: "EMAIL_VERIFY", tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_HOURS * 3_600_000) } }),
    ]);
    await this.email.send(user.email, { name: "email_verify", vars: { fullName: user.fullName, link: `${appUrl(loadEnv())}/eposta-dogrula?token=${token}` } });
    return { sent: true };
  }

  async verifyEmail(token: string) {
    const rec = await this.consumeToken(token, "EMAIL_VERIFY");
    await this.db.user.update({ where: { id: rec.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.logPlatform({ action: "auth.email_verified", actorId: rec.userId });
    return { verified: true };
  }

  /* ----------------------------- 2FA ----------------------------- */

  async mfaSetup(userId: string, password: string) {
    const user = await this.assertPassword(userId, password);
    if (user.mfaEnabledAt) throw new ConflictException("İki adımlı doğrulama zaten açık");
    const secret = newTotpSecret();
    await this.db.user.update({ where: { id: userId }, data: { mfaPendingSecretEnc: encrypt(secret, loadEnv().MFA_ENCRYPTION_KEY) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  private async newRecoveryCodes(userId: string) {
    const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
    await this.db.$transaction([
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(c) })) }),
    ]);
    return codes;
  }

  async mfaEnable(userId: string, sid: string, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) throw new ConflictException("İki adımlı doğrulama zaten açık");
    if (!user.mfaPendingSecretEnc) throw new BadRequestException("Önce kurulumu başlatın");
    const step = verifyTotp(decrypt(user.mfaPendingSecretEnc, loadEnv().MFA_ENCRYPTION_KEY), code);
    if (step === null) throw new BadRequestException("Doğrulama kodu hatalı. Telefonunuzun saatinin doğru olduğundan emin olun.");
    await this.db.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaFailedAttempts: 0 },
    });
    await this.db.session.update({ where: { id: sid }, data: { mfaVerified: true } });
    // Diğer cihazlardaki 2FA'sız oturumlar kapatılır.
    await this.sessions.revokeAll(userId, sid);
    const codes = await this.newRecoveryCodes(userId);
    await this.audit.logPlatform({ action: "auth.mfa_enabled", actorId: userId });
    await this.email.send(user.email, { name: "mfa_enabled", vars: { fullName: user.fullName } });
    return { enabled: true, recoveryCodes: codes };
  }

  private async assertTotp(userId: string, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw new BadRequestException("İki adımlı doğrulama kapalı");
    if (verifyTotp(decrypt(user.mfaSecretEnc, loadEnv().MFA_ENCRYPTION_KEY), code) === null) throw new UnauthorizedException({ message: "Doğrulama kodu hatalı", code: REAUTH_FAILED });
    return user;
  }

  async mfaDisable(userId: string, password: string, code: string) {
    const user = await this.assertPassword(userId, password);
    if (user.isPlatformAdmin && loadEnv().MFA_ENFORCE_PLATFORM === "1") {
      throw new ForbiddenException("SaaS yöneticisi hesaplarında iki adımlı doğrulama kapatılamaz");
    }
    await this.assertTotp(userId, code);
    await this.db.$transaction([
      this.db.user.update({ where: { id: userId }, data: { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null } }),
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.session.updateMany({ where: { userId }, data: { mfaVerified: false } }),
    ]);
    await this.audit.logPlatform({ action: "auth.mfa_disabled", actorId: userId });
    return { disabled: true };
  }

  /**
   * Hassas yönetici işlemleri için yeniden kimlik doğrulama: parola + güncel 2FA kodu.
   * Kod tekrar kullanılamaz (son adım kaydedilir).
   */
  async reauthenticate(userId: string, password: string, code: string, ip?: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const okPw = await bcrypt.compare(password, user.passwordHash);
    const step = user.mfaSecretEnc && user.mfaEnabledAt ? verifyTotp(decrypt(user.mfaSecretEnc, loadEnv().MFA_ENCRYPTION_KEY), code) : null;
    const fresh = step !== null && (user.mfaLastStep === null || step > user.mfaLastStep);
    if (!okPw || !fresh) {
      await this.audit.logPlatform({ action: "auth.reauth_failed", actorId: userId, ip });
      throw new UnauthorizedException({ message: "Parola veya doğrulama kodu hatalı", code: REAUTH_FAILED });
    }
    const r = await this.db.user.updateMany({ where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
    if (r.count !== 1) throw new UnauthorizedException({ message: "Doğrulama kodu zaten kullanıldı", code: REAUTH_FAILED });
  }

  async regenerateRecoveryCodes(userId: string, password: string, code: string) {
    await this.assertPassword(userId, password);
    await this.assertTotp(userId, code);
    const codes = await this.newRecoveryCodes(userId);
    await this.audit.logPlatform({ action: "auth.recovery_codes_regenerated", actorId: userId });
    return { recoveryCodes: codes };
  }

  /* ------------------------- Yeni işletme ------------------------- */

  /**
   * 1. adım: ücretsiz deneme başvurusu. Hiçbir kullanıcı/işletme oluşturulmaz; yalnızca doğrulama bekleyen başvuru kaydedilir.
   * - E-posta gönderilemiyorsa (canlıda SMTP yok) hiçbir şey yazılmadan 503 döner.
   * - Hesabı olan e-postaya aynı yanıt verilir (hesap varlığı sızdırılmaz); sahibine bilgi e-postası gider.
   * - Aynı e-postayla yeni başvuru öncekinin bağlantısını geçersiz kılar.
   */
  async requestTrial(input: TrialSignupInput, meta: ClientMeta) {
    if (!this.email.deliveryConfigured) {
      throw new ServiceUnavailableException({ message: "Şu anda e-posta doğrulaması gönderilemediği için yeni kayıt alınamıyor. Lütfen daha sonra tekrar deneyin veya info@proguzellik.com adresine yazın.", code: "EMAIL_NOT_CONFIGURED" });
    }
    const email = input.email.trim().toLowerCase();
    const phone = normalizePhone(input.phone);
    const planCode = input.planCode ?? "PROFESSIONAL";
    const plan = await this.db.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive || !plan.isPublic) throw new BadRequestException("Seçilen paket bulunamadı");
    const accepted = { status: "VERIFICATION_SENT" as const, email, expiresInHours: SIGNUP_HOURS };

    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      await bcrypt.hash(input.password, BCRYPT_ROUNDS); // yanıt süresi farkından hesap varlığı anlaşılmasın
      await this.email.send(email, { name: "signup_exists", vars: { fullName: existing.fullName, link: `${appUrl(loadEnv())}/giris` } }, { dedupeKey: `signup-exists:${existing.id}:${new Date().toISOString().slice(0, 13)}` });
      await this.audit.logPlatform({ action: "auth.signup_existing_email", actorId: existing.id, ip: meta.ip });
      return accepted;
    }
    await this.assertPhoneFree(phone);
    const pendingSamePhone = await this.db.signupRequest.count({ where: { phone, email: { not: email }, expiresAt: { gt: new Date() } } });
    if (pendingSamePhone >= 3) throw new HttpException("Bu telefon numarasıyla çok sayıda bekleyen başvuru var. E-postanızdaki doğrulama bağlantısını kullanın.", HttpStatus.TOO_MANY_REQUESTS);

    const token = randomToken();
    const data = {
      businessName: input.businessName.trim(), fullName: input.fullName.trim(), phone, planCode,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      kvkkNoticeVersion: KVKK_NOTICE_VERSION, termsVersion: TERMS_VERSION, marketingConsent: input.marketingConsent === true,
      tokenHash: sha256(token), expiresAt: new Date(Date.now() + SIGNUP_HOURS * 3_600_000),
      ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
    };
    const req = await this.db.signupRequest.upsert({ where: { email }, create: { email, ...data }, update: { ...data, createdAt: new Date() } });
    const sent = await this.email.send(email, { name: "trial_verify", vars: { fullName: data.fullName, salon: data.businessName, hours: SIGNUP_HOURS, link: `${appUrl(loadEnv())}/ucretsiz-deneme/dogrula?token=${token}` } });
    if ("failed" in sent) {
      await this.db.signupRequest.deleteMany({ where: { id: req.id, tokenHash: data.tokenHash } });
      throw new ServiceUnavailableException({ message: "Doğrulama e-postası gönderilemedi. E-posta adresinizi kontrol edip tekrar deneyin.", code: sent.code });
    }
    await this.audit.logPlatform({ action: "auth.signup_requested", ip: meta.ip, metadata: { plan: planCode, marketingConsent: data.marketingConsent } });
    return accepted;
  }

  /** Açık (deneme/ödeme bekleyen/askıda) bir işletmede kullanılan telefonla yeni deneme açılmaz. */
  private async assertPhoneFree(phone: string, tx: Pick<PrismaService["platform"], "tenant"> = this.db) {
    const t = await tx.tenant.findFirst({ where: { phone, status: { in: ["TRIAL", "PAST_DUE", "SUSPENDED"] } }, select: { id: true } });
    if (t) throw new ConflictException("Bu telefon numarasıyla açık bir deneme hesabı var. Mevcut hesabınızla giriş yapın ya da info@proguzellik.com adresine yazın.");
  }

  /**
   * 2. adım: e-posta doğrulanır; kullanıcı, işletme ve 14 günlük deneme bu anda oluşturulur, oturum açılır.
   * Bağlantı tek kullanımlıktır; eşzamanlı isteklerde yalnızca biri hesap açar.
   */
  async confirmTrial(token: string, meta: ClientMeta) {
    const tokenHash = sha256(token);
    const pending = await this.db.signupRequest.findUnique({ where: { tokenHash } });
    if (!pending || pending.expiresAt <= new Date()) throw new BadRequestException("Doğrulama bağlantısı geçersiz veya süresi dolmuş. Kayıt formundan yeniden başvurun.");
    const userId = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"signup:" + pending.email}))::text`;
      const claimed = await tx.signupRequest.deleteMany({ where: { id: pending.id, tokenHash } });
      if (claimed.count !== 1) throw new BadRequestException("Doğrulama bağlantısı zaten kullanıldı. Giriş yapabilirsiniz.");
      if (await tx.user.findUnique({ where: { email: pending.email }, select: { id: true } })) throw new ConflictException("Bu e-posta ile kayıtlı bir hesap var; giriş yapın.");
      await this.assertPhoneFree(pending.phone, tx);
      const plan = await tx.plan.findUnique({ where: { code: pending.planCode } });
      const planCode = plan?.isActive && plan.isPublic ? plan.code : "PROFESSIONAL";
      let slug = slugify(pending.businessName) || "isletme";
      if (await tx.tenant.findUnique({ where: { slug } })) slug = `${slug}-${randomToken().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
      const now = new Date();
      const tenant = await tx.tenant.create({
        data: { name: pending.businessName, slug, status: "TRIAL", planCode, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000), phone: pending.phone, email: pending.email },
      });
      const user = await tx.user.create({ data: { email: pending.email, passwordHash: pending.passwordHash, fullName: pending.fullName, phone: pending.phone, emailVerifiedAt: now } });
      await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
      const consent = { userId: user.id, ip: meta.ip ?? pending.ip, userAgent: meta.userAgent?.slice(0, 300) ?? pending.userAgent };
      await tx.userConsent.createMany({
        data: [
          { ...consent, type: "KVKK_NOTICE", granted: true, version: pending.kvkkNoticeVersion },
          { ...consent, type: "TERMS", granted: true, version: pending.termsVersion },
          { ...consent, type: "MARKETING", granted: pending.marketingConsent, version: MARKETING_VERSION },
        ],
      });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorId: user.id, ip: meta.ip, action: "tenant.registered", metadata: { via: "trial_signup", plan: planCode, trialEndsAt: tenant.trialEndsAt!.toISOString(), requestedAt: pending.createdAt.toISOString() } } });
      return user.id;
    });
    return this.completeLogin(userId, meta, false);
  }

  /* ------------------------- İşletme daveti ------------------------- */

  private async findOpenInvite(token: string) {
    const invite = await this.db.tenantInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: { select: { name: true, status: true } } } });
    if (!invite || invite.status !== "SENT" || !invite.expiresAt || invite.expiresAt <= new Date()) {
      throw new BadRequestException("Davet bağlantısı geçersiz veya süresi dolmuş");
    }
    if (invite.tenant.status === "SUSPENDED" || invite.tenant.status === "CANCELLED") throw new ForbiddenException("Bu işletme şu anda kullanılamıyor");
    return invite;
  }

  /** Davet sayfası için yalnızca davetin kendisine ait bilgiler (geçerli belirteçle). */
  async previewInvite(token: string) {
    const invite = await this.findOpenInvite(token);
    const existing = await this.db.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    return { salon: invite.tenant.name, email: invite.email, fullName: invite.fullName, role: invite.role, existingAccount: !!existing };
  }

  /**
   * Daveti kabul eder. Yeni kullanıcıda hesap oluşturulur ve oturum açılır.
   * Aynı e-postayla hesap varsa mevcut parola istenir; oturum açılmaz (2FA atlanmasın diye normal girişe yönlendirilir).
   * Belirteç tek kullanımlıktır; eşzamanlı isteklerde yalnızca biri başarılı olur.
   */
  async acceptInvite(token: string, password: string, meta: ClientMeta) {
    const invite = await this.findOpenInvite(token);
    const existing = await this.db.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      if (existing.isPlatformAdmin || !existing.isActive) throw new ForbiddenException("Bu hesapla davet kabul edilemez");
      if (!(await bcrypt.compare(password, existing.passwordHash))) {
        await this.audit.logPlatform({ tenantId: invite.tenantId, action: "tenant.invite_accept_failed", actorId: existing.id, ip: meta.ip });
        throw new UnauthorizedException("Parola hatalı");
      }
    } else {
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Parola uygun değil");
    }
    const passwordHash = existing ? null : await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = await this.db.$transaction(async (tx) => {
      const claimed = await tx.tenantInvite.updateMany({
        where: { id: invite.id, status: "SENT", tokenHash: sha256(token), expiresAt: { gt: new Date() } },
        data: { status: "ACCEPTED", acceptedAt: new Date(), tokenHash: null },
      });
      if (claimed.count !== 1) throw new BadRequestException("Davet bağlantısı geçersiz veya süresi dolmuş");
      const user =
        existing ??
        (await tx.user.create({
          data: { email: invite.email, fullName: invite.fullName, passwordHash: passwordHash!, emailVerifiedAt: new Date() },
        }));
      await tx.tenantInvite.update({ where: { id: invite.id }, data: { acceptedUserId: user.id } });
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
        create: { tenantId: invite.tenantId, userId: user.id, role: invite.role },
        update: { role: invite.role, isActive: true },
      });
      await tx.auditLog.create({
        data: { tenantId: invite.tenantId, actorId: user.id, action: "tenant.invite_accepted", entity: "TenantInvite", entityId: invite.id, ip: meta.ip, metadata: { newAccount: !existing } },
      });
      return user.id;
    });
    if (existing) return { accepted: true as const, loginRequired: true as const };
    return { accepted: true as const, ...(await this.completeLogin(userId, meta, false)) };
  }
}
