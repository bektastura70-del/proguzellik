import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { slugify } from "../auth/auth.service";
import { appUrl, inviteDeliveryEnabled, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { randomToken, sha256 } from "../security/crypto";

export const INVITE_DAYS = 7;
/** Davet e-postasında rol adı (sahip daveti mevcut metni korur). */
export const ROLE_LABEL_TR: Record<Role, string> = { OWNER: "sahip", MANAGER: "yönetici", RECEPTION: "resepsiyon görevlisi", STAFF: "personel" };
export const DEFAULT_TRIAL_DAYS = 14;
/** Denetim kaydı ön eki: işlemi SaaS sahibi mi işletme mi yaptı. */
export type InviteActor = "platform" | "tenant";

/** API yanıtlarında davetin güvenli alanları; tokenHash asla dışarı verilmez. */
export const inviteSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  expiresAt: true,
  sentAt: true,
  sendCount: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.TenantInviteSelect;

export interface CreateTenantInput {
  name: string;
  ownerEmail: string;
  ownerName: string;
  planCode: string;
  trialDays: number;
  phone?: string;
}

/** SaaS sahibi panelinden işletme oluşturma, davet ve durum yönetimi. Yalnızca platform rolüyle çalışır. */
@Injectable()
export class TenantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name) || "isletme";
    if (!(await this.db.tenant.findUnique({ where: { slug: base } }))) return base;
    for (let i = 0; i < 5; i++) {
      const s = `${base}-${Math.random().toString(36).slice(2, 7)}`;
      if (!(await this.db.tenant.findUnique({ where: { slug: s } }))) return s;
    }
    throw new ConflictException("Benzersiz işletme adresi üretilemedi; farklı bir ad deneyin");
  }

  async create(actorId: string, input: CreateTenantInput, ip?: string) {
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const existingUser = await this.db.user.findUnique({ where: { email: ownerEmail }, select: { isPlatformAdmin: true } });
    if (existingUser?.isPlatformAdmin) throw new ConflictException("Platform yöneticisi hesabı işletme sahibi olarak davet edilemez");
    const plan = await this.db.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw new NotFoundException("Paket bulunamadı");
    if (!plan.isActive) throw new ConflictException(`${plan.name} paketi pasif`);
    const slug = await this.uniqueSlug(input.name);
    const { tenant, invite } = await this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name.trim(),
          slug,
          status: "TRIAL",
          planCode: input.planCode,
          trialEndsAt: new Date(Date.now() + input.trialDays * 86_400_000),
          phone: input.phone,
          email: ownerEmail,
        },
      });
      const invite = await tx.tenantInvite.create({
        data: { tenantId: tenant.id, email: ownerEmail, fullName: input.ownerName.trim(), role: "OWNER", createdById: actorId },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId,
          action: "platform.tenant_created",
          entity: "Tenant",
          entityId: tenant.id,
          ip,
          metadata: { planCode: input.planCode, trialDays: input.trialDays, inviteId: invite.id },
        },
      });
      return { tenant, invite };
    });
    const delivery = await this.deliver(invite.id, actorId, ip);
    return { tenant, invite: delivery };
  }

  /**
   * Daveti iletir. E-posta gönderilemiyorsa (canlıda SMTP yok) belirteç ÜRETİLMEZ, davet bekler.
   * Her gönderim yeni belirteç üretir; öncekiler geçersiz olur. Belirteç yanıt, log ve denetim kaydına yazılmaz.
   */
  async deliver(inviteId: string, actorId: string, ip?: string, by: InviteActor = "platform") {
    const invite = await this.db.tenantInvite.findUnique({ where: { id: inviteId }, include: { tenant: { select: { name: true } } } });
    if (!invite) throw new NotFoundException("Davet bulunamadı");
    if (invite.status === "ACCEPTED" || invite.status === "REVOKED") throw new ConflictException("Bu davet artık kullanılamaz");
    const env = loadEnv();
    if (!inviteDeliveryEnabled(env)) {
      await this.db.tenantInvite.update({ where: { id: invite.id }, data: { status: "PENDING_DELIVERY", tokenHash: null, expiresAt: null } });
      await this.audit.logPlatform({ tenantId: invite.tenantId, actorId, ip, action: `${by}.invite_pending`, entity: "TenantInvite", entityId: invite.id, metadata: { reason: "email_not_configured" } });
      return this.publicInvite(invite.id, { delivered: false, code: "EMAIL_NOT_CONFIGURED", reason: "E-posta (SMTP) yapılandırılmadığı için davet GÖNDERİLMEDİ; e-posta ayarlanınca yeniden gönderin." });
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    // Yalnızca açık davet güncellenir (eşzamanlı kabul/iptal ile yarış durumunda üzerine yazılmaz).
    const r = await this.db.tenantInvite.updateMany({
      where: { id: invite.id, status: { in: ["PENDING_DELIVERY", "SENT"] } },
      data: { status: "SENT", tokenHash: sha256(token), expiresAt, sentAt: new Date(), sendCount: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictException("Bu davet artık kullanılamaz");
    const sent = await this.email.send(invite.email, {
      name: "tenant_invite",
      vars: { fullName: invite.fullName, salon: invite.tenant.name, link: `${appUrl(env)}/davet?token=${token}`, days: INVITE_DAYS, ...(invite.role !== "OWNER" ? { role: ROLE_LABEL_TR[invite.role] } : {}) },
    });
    if ("failed" in sent) {
      // Gönderilemeyen bağlantı geçersiz kılınır; davet yeniden gönderilene kadar bekler.
      await this.db.tenantInvite.updateMany({ where: { id: invite.id, status: "SENT" }, data: { status: "PENDING_DELIVERY", tokenHash: null, expiresAt: null } });
      await this.audit.logPlatform({ tenantId: invite.tenantId, actorId, ip, action: `${by}.invite_failed`, entity: "TenantInvite", entityId: invite.id });
      return this.publicInvite(invite.id, { delivered: false, code: "EMAIL_SEND_FAILED", reason: "E-posta gönderilemedi; davet GÖNDERİLMEDİ ve bekletiliyor." });
    }
    await this.audit.logPlatform({ tenantId: invite.tenantId, actorId, ip, action: `${by}.invite_sent`, entity: "TenantInvite", entityId: invite.id, metadata: { sendCount: invite.sendCount + 1 } });
    return this.publicInvite(invite.id, { delivered: true });
  }

  private async publicInvite(id: string, delivery: { delivered: boolean; reason?: string; code?: string }) {
    const invite = await this.db.tenantInvite.findUniqueOrThrow({ where: { id }, select: inviteSelect });
    return { ...invite, ...delivery };
  }

  /** İşletmenin açık sahip daveti (eski uç noktalar yalnızca sahip davetini yönetir). */
  private async openInvite(tenantId: string) {
    const invite = await this.db.tenantInvite.findFirst({ where: { tenantId, role: "OWNER", status: { in: ["PENDING_DELIVERY", "SENT"] } } });
    if (!invite) throw new NotFoundException("Açık davet yok");
    return invite;
  }

  async resend(tenantId: string, actorId: string, ip?: string) {
    const invite = await this.openInvite(tenantId);
    return this.deliver(invite.id, actorId, ip);
  }

  async revoke(tenantId: string, actorId: string, ip?: string) {
    const invite = await this.openInvite(tenantId);
    return this.revokeById(invite.id, actorId, ip);
  }

  /** Belirli bir daveti yeniden gönderir (her rol). */
  async resendById(inviteId: string, actorId: string, ip?: string, scope?: { tenantId: string }) {
    const invite = await this.db.tenantInvite.findUnique({ where: { id: inviteId } });
    if (!invite || (scope && (invite.tenantId !== scope.tenantId || invite.role === "OWNER"))) throw new NotFoundException("Davet bulunamadı");
    return this.deliver(invite.id, actorId, ip, scope ? "tenant" : "platform");
  }

  /** Belirli bir daveti iptal eder; bağlantı geçersiz olur. */
  async revokeById(inviteId: string, actorId: string, ip?: string, scope?: { tenantId: string }) {
    const invite = await this.db.tenantInvite.findUnique({ where: { id: inviteId } });
    if (!invite || (scope && (invite.tenantId !== scope.tenantId || invite.role === "OWNER"))) throw new NotFoundException("Davet bulunamadı");
    const by: InviteActor = scope ? "tenant" : "platform";
    const tenantId = invite.tenantId;
    const r = await this.db.tenantInvite.updateMany({
      where: { id: invite.id, status: { in: ["PENDING_DELIVERY", "SENT"] } },
      data: { status: "REVOKED", revokedAt: new Date(), tokenHash: null },
    });
    if (r.count !== 1) throw new ConflictException("Davet artık açık değil");
    await this.audit.logPlatform({ tenantId, actorId, ip, action: `${by}.invite_revoked`, entity: "TenantInvite", entityId: invite.id });
    return this.publicInvite(invite.id, { delivered: false });
  }

  /** İşletmenin kendi ekip davetleri (sahip davetleri hariç). */
  listTeamInvites(tenantId: string) {
    return this.db.tenantInvite.findMany({
      where: { tenantId, role: { not: "OWNER" }, status: { in: ["PENDING_DELIVERY", "SENT"] } },
      orderBy: { createdAt: "desc" },
      select: inviteSelect,
    });
  }

  /** Mevcut işletme için yeni sahip daveti (ör. ilk davet iptal edildiyse). Açık davet varsa reddedilir. */
  async invite(tenantId: string, actorId: string, input: { email: string; fullName: string }, ip?: string) {
    if (!(await this.db.tenant.findUnique({ where: { id: tenantId } }))) throw new NotFoundException("İşletme bulunamadı");
    const email = input.email.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email }, select: { isPlatformAdmin: true } });
    if (user?.isPlatformAdmin) throw new ConflictException("Platform yöneticisi hesabı işletme sahibi olarak davet edilemez");
    let invite;
    try {
      invite = await this.db.tenantInvite.create({ data: { tenantId, email, fullName: input.fullName.trim(), role: "OWNER", createdById: actorId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu işletmede zaten açık bir davet var");
      throw e;
    }
    await this.audit.logPlatform({ tenantId, actorId, ip, action: "platform.invite_created", entity: "TenantInvite", entityId: invite.id });
    return this.deliver(invite.id, actorId, ip);
  }

  async suspend(tenantId: string, actorId: string, reason: string, ip?: string) {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException("İşletme bulunamadı");
    if (t.status === "SUSPENDED") throw new ConflictException("İşletme zaten pasif");
    const updated = await this.db.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason, suspendedFromStatus: t.status } });
    await this.audit.logPlatform({ tenantId, actorId, ip, action: "platform.tenant_suspended", entity: "Tenant", entityId: tenantId, metadata: { previousStatus: t.status, reason } });
    return updated;
  }

  /** Pasif işletmeyi pasife alınmadan önceki durumuna döndürür (bilinmiyorsa aboneliğe göre ACTIVE/TRIAL). */
  async reactivate(tenantId: string, actorId: string, ip?: string) {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException("İşletme bulunamadı");
    if (t.status !== "SUSPENDED") throw new ConflictException("İşletme pasif değil");
    const status = t.suspendedFromStatus ?? ((await this.db.subscription.count({ where: { tenantId, status: "ACTIVE" } })) > 0 ? "ACTIVE" : "TRIAL");
    const updated = await this.db.tenant.update({ where: { id: tenantId }, data: { status, suspendedAt: null, suspendedReason: null, suspendedFromStatus: null } });
    await this.audit.logPlatform({ tenantId, actorId, ip, action: "platform.tenant_reactivated", entity: "Tenant", entityId: tenantId, metadata: { status } });
    return updated;
  }

  /**
   * İşletmeye yönetici/resepsiyon/personel daveti. Hesap davetle oluşturulur, parolayı davetli kendisi belirler;
   * geçici parola üretilmez. SMTP yoksa davet gönderilmez, "teslim bekliyor" olarak kalır.
   */
  async inviteMember(tenantId: string, actorId: string, input: { email: string; fullName: string; role: Exclude<Role, "OWNER"> }, ip?: string, by: InviteActor = "platform") {
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
    if (!tenant) throw new NotFoundException("İşletme bulunamadı");
    if (tenant.status === "CANCELLED") throw new ConflictException("İptal edilmiş işletmeye kullanıcı davet edilemez");
    const email = input.email.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email }, select: { id: true, isPlatformAdmin: true, isActive: true } });
    if (user?.isPlatformAdmin) throw new ConflictException("Platform yöneticisi hesabı işletmeye davet edilemez");
    if (user && !user.isActive) throw new ConflictException("Bu e-postaya ait hesap pasif; önce hesabı aktifleştirin");
    if (user) {
      const m = await this.db.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } }, select: { isActive: true } });
      if (m) throw new ConflictException(m.isActive ? "Kullanıcı bu işletmede zaten var" : "Kullanıcı bu işletmede pasif; erişimini yeniden açın");
    }
    let invite;
    try {
      invite = await this.db.tenantInvite.create({ data: { tenantId, email, fullName: input.fullName.trim(), role: input.role, createdById: actorId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu e-postaya bu işletmede zaten açık bir davet var");
      throw e;
    }
    await this.audit.logPlatform({ tenantId, actorId, ip, action: `${by}.member_invited`, entity: "TenantInvite", entityId: invite.id, metadata: { role: input.role, existingAccount: !!user } });
    return this.deliver(invite.id, actorId, ip, by);
  }

  /**
   * Deneme süresi: TRIAL işletmede bitiş ileri alınır; süresi dolmuş (PAST_DUE) ve açık aboneliği olmayan
   * işletmede deneme yeniden açılır. Veriler etkilenmez. Gerekçe ve önceki/sonraki tarih denetim kaydına yazılır.
   */
  async extendTrial(tenantId: string, actorId: string, input: { days?: number; until?: string; reason: string }, ip?: string) {
    const DAY = 86_400_000;
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tenant-trial:" + tenantId}))`;
      const t = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!t) throw new NotFoundException("İşletme bulunamadı");
      const openSubs = await tx.subscription.count({ where: { tenantId, status: { in: ["ACTIVE", "PAST_DUE"] } } });
      if (openSubs > 0) throw new ConflictException("Aboneliği olan işletmenin deneme süresi değiştirilemez; aboneliği yönetin");
      if (t.status !== "TRIAL" && t.status !== "PAST_DUE") throw new ConflictException("Yalnızca deneme sürecindeki ya da denemesi bitmiş işletmede uygulanır");
      const now = Date.now();
      const base = Math.max(now, t.trialEndsAt?.getTime() ?? now);
      const next = input.until ? new Date(input.until) : new Date(base + input.days! * DAY);
      if (next.getTime() <= now) throw new ConflictException("Yeni bitiş tarihi gelecekte olmalı");
      if (next.getTime() > now + 365 * DAY) throw new ConflictException("Deneme bitişi en fazla 1 yıl sonrası olabilir");
      const updated = await tx.tenant.update({ where: { id: tenantId }, data: { status: "TRIAL", trialEndsAt: next, pastDueSince: null } });
      await tx.auditLog.create({
        data: { tenantId, actorId, ip, action: "platform.trial_extended", entity: "Tenant", entityId: tenantId, metadata: { from: t.trialEndsAt?.toISOString() ?? null, to: next.toISOString(), previousStatus: t.status, reason: input.reason } },
      });
      return { id: updated.id, status: updated.status, trialEndsAt: updated.trialEndsAt };
    });
  }

  /** Paket değişikliği: aktif personel sayısı yeni paketin sınırını aşıyorsa reddedilir. */
  async assertPlanFits(tenantId: string, planCode: string) {
    const [plan, active] = await Promise.all([
      this.db.plan.findUnique({ where: { code: planCode } }),
      this.db.staffMember.count({ where: { tenantId, isActive: true } }),
    ]);
    if (!plan) throw new NotFoundException("Paket bulunamadı");
    if (!plan.isActive) throw new ConflictException(`${plan.name} paketi pasif; önce paketi etkinleştirin`);
    if (active > plan.maxStaff) {
      throw new ConflictException(`Bu işletmede ${active} aktif personel var; ${plan.name} paketi en fazla ${plan.maxStaff} personele izin veriyor`);
    }
    if (plan.maxCustomers != null) {
      const customers = await this.db.customer.count({ where: { tenantId, anonymizedAt: null } });
      if (customers > plan.maxCustomers) throw new ConflictException(`Bu işletmede ${customers} müşteri kaydı var; ${plan.name} paketi en fazla ${plan.maxCustomers} müşteriye izin veriyor`);
    }
  }
}
