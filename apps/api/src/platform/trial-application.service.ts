import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, TrialApplicationStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ClientMeta, KVKK_NOTICE_VERSION, normalizePhone, TERMS_VERSION } from "../auth/auth.service";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { randomToken, sha256 } from "../security/crypto";
import { DEFAULT_TRIAL_DAYS, TenantAdminService } from "./tenant-admin.service";

/** Doğrulama bağlantısının geçerlilik süresi (saat). */
export const APPLICATION_VERIFY_HOURS = 48;
/** Reddedilen başvurular bu kadar gün sonra günlük görevle silinir (veri minimizasyonu). */
export const REJECTED_RETENTION_DAYS = 30;
/** Aynı telefonla (farklı e-postalarla) en fazla bu kadar açık başvuru. */
const MAX_OPEN_PER_PHONE = 3;
const PAGE_SIZE = 50;

export interface TrialApplicationInput {
  businessName: string;
  fullName: string;
  email: string;
  phone: string;
  city?: string;
  staffCount?: number;
  planCode?: string;
  note?: string;
  marketingConsent?: boolean;
  /** Bal küpü: insan kullanıcı görmez; doluysa istek sessizce yok sayılır (denetim kaydı yalnız IP ile). */
  hp?: string;
}

export interface ApproveInput {
  name: string;
  ownerName: string;
  ownerEmail: string;
  phone?: string;
  planCode: string;
  trialDays: number;
  /** Uyarılara (aynı telefonla açık işletme, e-postanın mevcut hesabı) rağmen onayla */
  ignoreWarnings?: boolean;
}

/** Owner panelinde gösterilecek alanlar; doğrulama belirteci asla dışarı verilmez. */
const publicSelect = {
  id: true, status: true, businessName: true, fullName: true, email: true, phone: true, city: true, staffCount: true, planCode: true, note: true,
  marketingConsent: true, verifiedAt: true, decidedAt: true, decidedById: true, rejectReason: true, tenantId: true, createdAt: true,
  tenant: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.TrialApplicationSelect;

/**
 * Kayıt kapalıyken siteden gelen deneme başvuruları.
 * Akış: form → e-posta doğrulama (çift onay) → Owner listesinde "bekliyor" → Onayla (işletme + 7 gün deneme + sahip daveti) / Reddet.
 * Başvuruda parola alınmaz; sahip hesabını davet bağlantısıyla kendisi oluşturur.
 */
@Injectable()
export class TrialApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly tenantAdmin: TenantAdminService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  /* ------------------------- Herkese açık ------------------------- */

  async submit(input: TrialApplicationInput, meta: ClientMeta) {
    if (!this.email.deliveryConfigured) {
      throw new ServiceUnavailableException({ message: "Şu anda e-posta doğrulaması gönderilemediği için başvuru alınamıyor. Lütfen daha sonra tekrar deneyin veya info@proguzellik.com adresine yazın.", code: "EMAIL_NOT_CONFIGURED" });
    }
    const email = input.email.trim().toLowerCase();
    const accepted = { status: "VERIFICATION_SENT" as const, email, expiresInHours: APPLICATION_VERIFY_HOURS };
    if (input.hp) {
      // bot: başvuru yazılmaz, e-posta gitmez; yanlış pozitifler görünür olsun diye yalnız IP denetime düşer
      await this.audit.logPlatform({ action: "trial_application.honeypot", ip: meta.ip });
      return accepted;
    }
    const phone = normalizePhone(input.phone);

    // Hesabı olan e-postaya aynı yanıt verilir (hesap varlığı sızdırılmaz); sahibine bilgi e-postası gider.
    const existing = await this.db.user.findUnique({ where: { email }, select: { id: true, fullName: true } });
    if (existing) {
      await this.email.send(email, { name: "signup_exists", vars: { fullName: existing.fullName, link: `${appUrl(loadEnv())}/giris` } }, { dedupeKey: `signup-exists:${existing.id}:${new Date().toISOString().slice(0, 13)}` });
      await this.audit.logPlatform({ action: "trial_application.existing_email", actorId: existing.id, ip: meta.ip });
      return accepted;
    }
    const open = await this.db.trialApplication.findFirst({ where: { email, status: { in: ["UNVERIFIED", "PENDING"] } } });
    // Zaten doğrulanmış ve onay bekleyen başvuru: değiştirilmez, yeni e-posta gitmez (yanıt aynı).
    if (open?.status === "PENDING") return accepted;
    const samePhone = await this.db.trialApplication.count({ where: { phone, email: { not: email }, status: { in: ["UNVERIFIED", "PENDING"] } } });
    if (samePhone >= MAX_OPEN_PER_PHONE) throw new HttpException("Bu telefon numarasıyla çok sayıda açık başvuru var. E-postanızdaki doğrulama bağlantısını kullanın.", HttpStatus.TOO_MANY_REQUESTS);

    let planCode: string | null = null;
    if (input.planCode) {
      const plan = await this.db.plan.findUnique({ where: { code: input.planCode }, select: { code: true, isActive: true, isPublic: true } });
      if (plan?.isActive && plan.isPublic) planCode = plan.code;
    }
    const token = randomToken();
    const data = {
      businessName: input.businessName.trim(), fullName: input.fullName.trim(), phone, planCode,
      city: input.city?.trim() || null, staffCount: input.staffCount ?? null, note: input.note?.trim() || null,
      kvkkNoticeVersion: KVKK_NOTICE_VERSION, termsVersion: TERMS_VERSION, marketingConsent: input.marketingConsent === true,
      tokenHash: sha256(token), expiresAt: new Date(Date.now() + APPLICATION_VERIFY_HOURS * 3_600_000),
      ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
    };
    let row: { id: string };
    try {
      // Aynı e-postayla doğrulanmamış başvuru varsa güncellenir (önceki bağlantı geçersiz olur).
      row = open
        ? await this.db.trialApplication.update({ where: { id: open.id }, data: { ...data, createdAt: new Date() }, select: { id: true } })
        : await this.db.trialApplication.create({ data: { email, ...data }, select: { id: true } });
    } catch (e) {
      // Eşzamanlı ikinci istek: açık başvuru tekilliği (kısmi benzersiz dizin)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return accepted;
      throw e;
    }
    const sent = await this.email.send(email, {
      name: "trial_application_verify",
      vars: { fullName: data.fullName, salon: data.businessName, hours: APPLICATION_VERIFY_HOURS, link: `${appUrl(loadEnv())}/ucretsiz-deneme/basvuru-dogrula?token=${token}` },
    });
    if ("failed" in sent) {
      // Gönderilemeyen bağlantı geçersiz; yeni oluşturulduysa başvuru hiç kalmaz.
      if (open) await this.db.trialApplication.updateMany({ where: { id: row.id, tokenHash: data.tokenHash }, data: { tokenHash: null, expiresAt: new Date() } });
      else await this.db.trialApplication.deleteMany({ where: { id: row.id, tokenHash: data.tokenHash } });
      throw new ServiceUnavailableException({ message: "Doğrulama e-postası gönderilemedi. E-posta adresinizi kontrol edip tekrar deneyin.", code: sent.code });
    }
    await this.audit.logPlatform({ action: "trial_application.submitted", entity: "TrialApplication", entityId: row.id, ip: meta.ip, metadata: { plan: planCode, marketingConsent: data.marketingConsent } });
    return accepted;
  }

  /** E-posta doğrulandı: başvuru Owner listesine düşer, SaaS sahibine bildirim e-postası gider. Bağlantı tek kullanımlıktır. */
  async verify(token: string, meta: ClientMeta) {
    const tokenHash = sha256(token);
    const app = await this.db.trialApplication.findUnique({ where: { tokenHash }, select: { id: true, status: true, expiresAt: true, businessName: true } });
    const invalid = new BadRequestException("Doğrulama bağlantısı geçersiz veya süresi dolmuş. Başvuru formundan yeniden başvurun.");
    if (!app || app.status !== "UNVERIFIED" || !app.expiresAt || app.expiresAt <= new Date()) throw invalid;
    const r = await this.db.trialApplication.updateMany({
      where: { id: app.id, tokenHash, status: "UNVERIFIED" },
      data: { status: "PENDING", verifiedAt: new Date(), tokenHash: null, expiresAt: null },
    });
    if (r.count !== 1) throw invalid;
    await this.audit.logPlatform({ action: "trial_application.verified", entity: "TrialApplication", entityId: app.id, ip: meta.ip });
    await this.notifyOwner(app.id, app.businessName);
    return { status: "PENDING" as const };
  }

  /** Bildirim gönderilemese de başvuru panelde bekler; hata başvurana yansıtılmaz. */
  private async notifyOwner(id: string, salon: string) {
    try {
      const env = loadEnv();
      const company = await this.db.platformCompany.findUnique({ where: { id: 1 }, select: { email: true } });
      await this.email.send(company?.email || env.SUPPORT_EMAIL, { name: "trial_application_received", vars: { salon, link: `${appUrl(env)}/platform?sekme=basvurular` } }, { dedupeKey: `trial-application:${id}` });
    } catch {
      /* panelde görünür */
    }
  }

  /* ------------------------- SaaS sahibi ------------------------- */

  async list(status: TrialApplicationStatus | undefined, page: number) {
    const where: Prisma.TrialApplicationWhereInput = status ? { status } : { status: { not: "UNVERIFIED" } };
    const [items, groups] = await Promise.all([
      this.db.trialApplication.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: publicSelect }),
      this.db.trialApplication.groupBy({ by: ["status"], _count: true }),
    ]);
    const counts = Object.fromEntries(groups.map((g) => [g.status, g._count])) as Partial<Record<TrialApplicationStatus, number>>;
    const pending = items.filter((a) => a.status === "PENDING");
    const warnings = await this.warningsFor(pending.map((a) => ({ id: a.id, email: a.email, phone: a.phone })));
    return { items: items.map((a) => ({ ...a, warnings: warnings.get(a.id) ?? [] })), counts, page, pageSize: PAGE_SIZE };
  }

  /** Onay öncesi uyarılar: e-postanın mevcut hesabı, aynı telefon/e-postayla açık işletme. */
  private async warningsFor(apps: { id: string; email: string; phone: string }[]) {
    const out = new Map<string, string[]>();
    if (!apps.length) return out;
    const emails = [...new Set(apps.map((a) => a.email))];
    const phones = [...new Set(apps.map((a) => a.phone))];
    const [users, tenants] = await Promise.all([
      this.db.user.findMany({ where: { email: { in: emails } }, select: { email: true, isPlatformAdmin: true } }),
      this.db.tenant.findMany({ where: { OR: [{ phone: { in: phones } }, { email: { in: emails } }], status: { not: "CANCELLED" } }, select: { name: true, phone: true, email: true } }),
    ]);
    for (const a of apps) {
      const w: string[] = [];
      const u = users.find((x) => x.email === a.email);
      if (u?.isPlatformAdmin) w.push("Bu e-posta bir platform yöneticisine ait; işletme sahibi yapılamaz.");
      else if (u) w.push("Bu e-postayla kayıtlı bir kullanıcı var; davet mevcut hesaba bağlanır.");
      for (const t of tenants) {
        if (t.phone === a.phone) w.push(`Aynı telefonla açık işletme var: ${t.name}`);
        else if (t.email === a.email) w.push(`Aynı e-postayla açık işletme var: ${t.name}`);
      }
      if (w.length) out.set(a.id, w);
    }
    return out;
  }

  async get(id: string) {
    const a = await this.db.trialApplication.findUnique({ where: { id }, select: publicSelect });
    if (!a) throw new NotFoundException("Başvuru bulunamadı");
    const warnings = a.status === "PENDING" ? ((await this.warningsFor([a])).get(a.id) ?? []) : [];
    return { ...a, warnings };
  }

  /**
   * Onay: başvuru sahiplenilir (yalnızca bir onay başarılı olur), işletme 7 günlük denemede açılır ve sahibine davet gider.
   * Sahiplenme, işletme ve davet tek işlemde yazılır; biri başarısız olursa hiçbiri kalmaz.
   */
  async approve(id: string, actorId: string, input: ApproveInput, ip?: string) {
    const app = await this.get(id);
    if (app.status !== "PENDING") throw new ConflictException("Bu başvuru zaten karara bağlanmış");
    if (app.warnings.length && !input.ignoreWarnings) {
      throw new ConflictException({ message: `Onaydan önce kontrol edin: ${app.warnings.join(" ")}`, code: "APPLICATION_WARNINGS", warnings: app.warnings });
    }
    const phone = input.phone?.trim() ? normalizePhone(input.phone) : app.phone;
    const decidedAt = new Date();
    const res = await this.tenantAdmin.create(
      actorId,
      { name: input.name, ownerName: input.ownerName, ownerEmail: input.ownerEmail, phone, planCode: input.planCode, trialDays: input.trialDays },
      ip,
      {
        before: async (tx) => {
          // Eşzamanlı ikinci onay satır kilidinde bekler, ardından durumu APPROVED görür ve hiçbir şey yazmadan düşer.
          const claimed = await tx.trialApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", decidedAt, decidedById: actorId } });
          if (claimed.count !== 1) throw new ConflictException("Bu başvuru zaten karara bağlanmış");
        },
        after: async (tx, tenant) => {
          await tx.trialApplication.update({ where: { id }, data: { tenantId: tenant.id } });
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id, actorId, ip, action: "platform.trial_application_approved", entity: "TrialApplication", entityId: id,
              metadata: { planCode: input.planCode, trialDays: input.trialDays, edited: editedFields(app, input, phone), ignoredWarnings: input.ignoreWarnings ? app.warnings : [] },
            },
          });
        },
      },
    );
    return { application: await this.get(id), tenant: res.tenant, invite: res.invite };
  }

  async reject(id: string, actorId: string, reason: string, ip?: string) {
    const r = await this.db.trialApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: actorId, rejectReason: reason } });
    if (r.count !== 1) {
      await this.get(id); // yoksa 404
      throw new ConflictException("Bu başvuru zaten karara bağlanmış");
    }
    await this.audit.logPlatform({ actorId, ip, action: "platform.trial_application_rejected", entity: "TrialApplication", entityId: id, metadata: { reason } });
    return this.get(id);
  }
}

/** Günlük görev: süresi dolmuş doğrulanmamış ve eski reddedilmiş başvurular silinir (onaylılar işletmeye bağlı kalır). */
export async function purgeTrialApplications(db: PrismaService["platform"], now: Date) {
  const unverified = await db.trialApplication.deleteMany({ where: { status: "UNVERIFIED", OR: [{ expiresAt: { lt: now } }, { expiresAt: null }] } });
  const rejected = await db.trialApplication.deleteMany({ where: { status: "REJECTED", decidedAt: { lt: new Date(now.getTime() - REJECTED_RETENTION_DAYS * 86_400_000) } } });
  return { expiredApplications: unverified.count, purgedRejectedApplications: rejected.count };
}

/** Denetim kaydı için: SaaS sahibinin başvurudan farklı girdiği alanların adları (değerler yazılmaz). */
function editedFields(app: { businessName: string; fullName: string; email: string; phone: string; planCode: string | null }, input: ApproveInput, phone: string) {
  const f: string[] = [];
  if (input.name.trim() !== app.businessName) f.push("name");
  if (input.ownerName.trim() !== app.fullName) f.push("ownerName");
  if (input.ownerEmail.trim().toLowerCase() !== app.email) f.push("ownerEmail");
  if (phone !== app.phone) f.push("phone");
  if (app.planCode && input.planCode !== app.planCode) f.push("planCode");
  if (input.trialDays !== DEFAULT_TRIAL_DAYS) f.push("trialDays");
  return f;
}
