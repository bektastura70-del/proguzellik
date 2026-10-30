import { EmailService } from "../email/email.service";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { SessionService } from "../auth/session.service";
import { inviteDeliveryEnabled, loadEnv } from "../config/env";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface UserListQuery {
  search?: string;
  tenantId?: string;
  role?: Role;
  status?: "active" | "inactive" | "locked";
  kind?: "tenant" | "platform";
  take: number;
  skip: number;
}

/** Yanıtlarda kullanıcının güvenli alanları: parola özeti, 2FA sırrı ve belirteçler asla dışarı verilmez. */
const userSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  isActive: true,
  isPlatformAdmin: true,
  mustChangePassword: true,
  emailVerifiedAt: true,
  mfaEnabledAt: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  memberships: {
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, isActive: true, createdAt: true, tenant: { select: { id: true, name: true, status: true } } },
  },
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
export const present = ({ emailVerifiedAt, mfaEnabledAt, lockedUntil, ...u }: SafeUser) => ({
  ...u,
  emailVerified: !!emailVerifiedAt,
  mfaEnabled: !!mfaEnabledAt,
  locked: !!lockedUntil && lockedUntil > new Date(),
});

/**
 * SaaS sahibinin kullanıcı yönetimi: tüm işletmelerdeki kullanıcıları listeleme, rol değiştirme,
 * işletme erişimini kapatma/açma, hesabı pasifleştirme ve parola sıfırlama bağlantısı gönderme.
 * Her değişiklik denetim kaydına yazılır.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly email: EmailService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  async list(q: UserListQuery) {
    const now = new Date();
    const membershipFilter: Prisma.MembershipWhereInput = {
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.role ? { role: q.role } : {}),
    };
    const where: Prisma.UserWhereInput = {
      ...(q.search
        ? { OR: [{ email: { contains: q.search, mode: "insensitive" } }, { fullName: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }] }
        : {}),
      ...(q.tenantId || q.role ? { memberships: { some: membershipFilter } } : {}),
      ...(q.kind === "platform" ? { isPlatformAdmin: true } : q.kind === "tenant" ? { isPlatformAdmin: false } : {}),
      ...(q.status === "active" ? { isActive: true } : q.status === "inactive" ? { isActive: false } : q.status === "locked" ? { lockedUntil: { gt: now } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({ where, select: userSelect, orderBy: { createdAt: "desc" }, take: q.take, skip: q.skip }),
      this.db.user.count({ where }),
    ]);
    return { items: items.map(present), total };
  }

  async get(id: string) {
    const u = await this.db.user.findUnique({ where: { id }, select: userSelect });
    if (!u) throw new NotFoundException("Kullanıcı bulunamadı");
    const [audit, invites, activeSessions] = await Promise.all([
      this.db.auditLog.findMany({
        where: { OR: [{ actorId: id }, { entityId: id }, { entity: "Membership", entityId: { in: u.memberships.map((m) => m.id) } }] },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, action: true, tenantId: true, actorId: true, createdAt: true, metadata: true },
      }),
      this.db.tenantInvite.findMany({
        where: { email: u.email, status: { in: ["PENDING_DELIVERY", "SENT"] } },
        select: { id: true, role: true, status: true, expiresAt: true, tenant: { select: { id: true, name: true } } },
      }),
      this.db.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return { ...present(u), activeSessions, openInvites: invites, audit };
  }

  private async log(tx: Tx | PrismaService["platform"], data: Prisma.AuditLogUncheckedCreateInput) {
    await tx.auditLog.create({ data });
  }

  /** Aktif sahip sayısı; işletmenin son aktif sahibi kaldırılamaz. */
  private async activeOwners(tx: Tx, tenantId: string, exceptMembershipId?: string) {
    return tx.membership.count({
      where: { tenantId, role: "OWNER", isActive: true, user: { isActive: true }, ...(exceptMembershipId ? { id: { not: exceptMembershipId } } : {}) },
    });
  }

  /** İşlemleri işletme bazında sıraya sokar (son sahibin eşzamanlı kaldırılmasını önler). */
  private lock(tx: Tx, key: string) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"members:" + key}))::text`;
  }

  async changeRole(membershipId: string, actorId: string, role: Role, ip?: string) {
    const m0 = await this.db.membership.findUnique({ where: { id: membershipId }, select: { tenantId: true } });
    if (!m0) throw new NotFoundException("Üyelik bulunamadı");
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, m0.tenantId);
      const m = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
      if (m.role === role) throw new ConflictException("Kullanıcı zaten bu rolde");
      if (m.role === "OWNER" && m.isActive && (await this.activeOwners(tx, m.tenantId, m.id)) === 0) {
        throw new ConflictException("İşletmenin son aktif sahibinin rolü değiştirilemez; önce başka bir sahip atayın");
      }
      const updated = await tx.membership.update({ where: { id: m.id }, data: { role } });
      await this.log(tx, { tenantId: m.tenantId, actorId, ip, action: "platform.member_role_changed", entity: "Membership", entityId: m.id, metadata: { userId: m.userId, from: m.role, to: role } });
      return updated;
    });
  }

  /** Kullanıcının yalnızca bu işletmeye erişimini kapatır/açar (hesap ve diğer işletmeler etkilenmez). */
  async setMembershipActive(membershipId: string, actorId: string, active: boolean, reason: string | undefined, ip?: string) {
    const m0 = await this.db.membership.findUnique({ where: { id: membershipId }, select: { tenantId: true } });
    if (!m0) throw new NotFoundException("Üyelik bulunamadı");
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, m0.tenantId);
      const m = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
      if (m.isActive === active) throw new ConflictException(active ? "Erişim zaten açık" : "Erişim zaten kapalı");
      if (!active && m.role === "OWNER" && (await this.activeOwners(tx, m.tenantId, m.id)) === 0) {
        throw new ConflictException("İşletmenin son aktif sahibinin erişimi kapatılamaz; önce başka bir sahip atayın veya işletmeyi pasife alın");
      }
      const updated = await tx.membership.update({ where: { id: m.id }, data: { isActive: active } });
      await this.log(tx, {
        tenantId: m.tenantId,
        actorId,
        ip,
        action: active ? "platform.member_activated" : "platform.member_deactivated",
        entity: "Membership",
        entityId: m.id,
        metadata: { userId: m.userId, role: m.role, ...(reason ? { reason } : {}) },
      });
      return updated;
    });
  }

  /**
   * Hesabı tamamen pasifleştirir: tüm oturumlar kapatılır, açık sıfırlama bağlantıları geçersiz olur.
   * Platform yöneticileri ve aktif bir işletmenin tek sahibi bu yolla pasifleştirilemez.
   */
  async deactivateUser(id: string, actorId: string, reason: string, ip?: string) {
    if (id === actorId) throw new ForbiddenException("Kendi hesabınızı pasifleştiremezsiniz");
    const result = await this.db.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id }, include: { memberships: { where: { isActive: true, role: "OWNER" }, include: { tenant: { select: { name: true, status: true } } } } } });
      if (!u) throw new NotFoundException("Kullanıcı bulunamadı");
      if (u.isPlatformAdmin) throw new ForbiddenException("Platform yöneticisi hesabı bu panelden pasifleştirilemez");
      if (!u.isActive) throw new ConflictException("Hesap zaten pasif");
      for (const m of u.memberships) {
        if (m.tenant.status === "SUSPENDED" || m.tenant.status === "CANCELLED") continue;
        await this.lock(tx, m.tenantId);
        if ((await this.activeOwners(tx, m.tenantId, m.id)) === 0) {
          throw new ConflictException(`${m.tenant.name} işletmesinin tek aktif sahibi; önce başka bir sahip atayın veya işletmeyi pasife alın`);
        }
      }
      await tx.user.update({ where: { id }, data: { isActive: false } });
      await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
      await this.log(tx, { actorId, ip, action: "platform.user_deactivated", entity: "User", entityId: id, metadata: { reason } });
      return u;
    });
    const { revoked } = await this.sessions.revokeAll(result.id);
    return { deactivated: true, revokedSessions: revoked };
  }

  async activateUser(id: string, actorId: string, ip?: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Kullanıcı bulunamadı");
    if (u.isActive) throw new ConflictException("Hesap zaten aktif");
    await this.db.user.update({ where: { id }, data: { isActive: true, failedLogins: 0, lockedUntil: null } });
    await this.log(this.db, { actorId, ip, action: "platform.user_activated", entity: "User", entityId: id });
    return { activated: true };
  }

  /**
   * Kullanıcıya parola sıfırlama bağlantısı gönderir. E-posta iletilemiyorsa (canlıda SMTP yok) bağlantı üretilmez
   * ve gönderilmiş gibi gösterilmez: 503 EMAIL_NOT_CONFIGURED döner.
   */
  async sendPasswordReset(id: string, actorId: string, opts: { revokeSessions: boolean }, ip?: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Kullanıcı bulunamadı");
    if (u.isPlatformAdmin) throw new ForbiddenException("Platform yöneticisi parolası bu panelden sıfırlanamaz");
    if (!u.isActive) throw new ConflictException("Pasif hesaba sıfırlama bağlantısı gönderilemez");
    if (!inviteDeliveryEnabled(loadEnv())) {
      await this.log(this.db, { actorId, ip, action: "platform.user_password_reset_blocked", entity: "User", entityId: id, metadata: { reason: "email_not_configured" } });
      throw new ServiceUnavailableException({ message: "E-posta (SMTP) yapılandırılmadığı için sıfırlama bağlantısı gönderilemedi.", code: "EMAIL_NOT_CONFIGURED" });
    }
    const sent = await this.auth.issuePasswordReset(u, ip);
    if ("failed" in sent) {
      await this.db.authToken.updateMany({ where: { userId: id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
      await this.log(this.db, { actorId, ip, action: "platform.user_password_reset_failed", entity: "User", entityId: id });
      throw new ServiceUnavailableException({ message: "Sıfırlama e-postası gönderilemedi; bağlantı geçersiz kılındı.", code: "EMAIL_SEND_FAILED" });
    }
    const revoked = opts.revokeSessions ? (await this.sessions.revokeAll(id)).revoked : 0;
    await this.log(this.db, { actorId, ip, action: "platform.user_password_reset_sent", entity: "User", entityId: id, metadata: { revokedSessions: revoked } });
    return { sent: true, revokedSessions: revoked };
  }

  /**
   * Kullanıcının iki adımlı doğrulamasını sıfırlar (telefonunu kaybeden kullanıcı için).
   * Yönetici parola + kendi 2FA koduyla yeniden doğrulanır; gerekçe zorunludur; tüm oturumlar kapanır.
   */
  async resetMfa(id: string, actorId: string, input: { password: string; code: string; reason: string }, ip?: string) {
    if (id === actorId) throw new ForbiddenException("Kendi 2FA'nızı Hesap güvenliği sayfasından yönetin");
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("Kullanıcı bulunamadı");
    if (u.isPlatformAdmin) throw new ForbiddenException("Platform yöneticisi 2FA'sı bu panelden sıfırlanamaz");
    if (!u.mfaEnabledAt) throw new ConflictException("Bu kullanıcıda iki adımlı doğrulama kapalı");
    await this.auth.reauthenticate(actorId, input.password, input.code, ip);
    await this.db.$transaction([
      this.db.user.update({ where: { id }, data: { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaFailedAttempts: 0 } }),
      this.db.recoveryCode.deleteMany({ where: { userId: id } }),
    ]);
    const { revoked } = await this.sessions.revokeAll(id);
    await this.log(this.db, { actorId, ip, action: "platform.user_mfa_reset", entity: "User", entityId: id, metadata: { reason: input.reason, revokedSessions: revoked } });
    // Bilgilendirme e-postası; SMTP yoksa gönderilmez ve yanıt bunu açıkça söyler.
    const notified = inviteDeliveryEnabled(loadEnv()) ? !("failed" in (await this.email.send(u.email, { name: "mfa_reset", vars: { fullName: u.fullName } }))) : false;
    return { reset: true, revokedSessions: revoked, notified };
  }
}
