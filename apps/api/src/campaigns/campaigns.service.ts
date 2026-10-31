import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { loadEnv } from "../config/env";
import { NotificationQueue } from "../notifications/notification-queue";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface CampaignInput {
  title: string;
  description: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

const MAX_BROADCAST = 1000;

/** Toplu ticari ileti (kampanya duyurusu) gönderimi açık mı? İYS entegrasyonu olmadığından canlıda varsayılan kapalı. */
export const marketingEnabled = (env: { MARKETING_MESSAGES?: "0" | "1"; NODE_ENV: string } = loadEnv()) => {
  return env.MARKETING_MESSAGES ? env.MARKETING_MESSAGES === "1" : env.NODE_ENV !== "production";
};

/** Meta şablon değişkeni: satır sonu/sekme ve art arda çok boşluk kabul edilmez. */
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger("Campaigns");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: NotificationQueue,
  ) {}

  /** Şu an geçerli kampanyalar (yapay zekâ yalnızca bunları anlatır). */
  static active(tx: Tx, now = new Date()) {
    return tx.campaign.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, description: true, startsAt: true, endsAt: true },
      take: 20,
    });
  }

  list(t: TenantInfo) {
    return this.prisma.withTenant(t, async (tx) => {
      const rows = await tx.campaign.findMany({ orderBy: { createdAt: "desc" } });
      const sent = await tx.notification.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: rows.map((r) => r.id) } }, _count: true });
      return rows.map((r) => ({
        ...r,
        sends: Object.fromEntries(sent.filter((s) => s.campaignId === r.id).map((s) => [s.status, s._count])),
      }));
    });
  }

  private dates(b: Partial<CampaignInput>) {
    const startsAt = b.startsAt === undefined ? undefined : b.startsAt ? new Date(b.startsAt) : null;
    const endsAt = b.endsAt === undefined ? undefined : b.endsAt ? new Date(b.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) throw new BadRequestException("Bitiş tarihi başlangıçtan önce olamaz");
    return { startsAt, endsAt };
  }

  create(t: TenantInfo, b: CampaignInput) {
    return this.prisma.withTenant(t, async (tx) => {
      const c = await tx.campaign.create({ data: { tenantId: t.tenantId, title: b.title, description: b.description, isActive: b.isActive ?? true, createdById: t.userId, ...this.dates(b) } });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "campaign.created", entity: "Campaign", entityId: c.id });
      return c;
    });
  }

  update(t: TenantInfo, id: string, b: Partial<CampaignInput>) {
    return this.prisma.withTenant(t, async (tx) => {
      const cur = await tx.campaign.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException("Kampanya bulunamadı");
      const d = this.dates({ startsAt: b.startsAt === undefined ? cur.startsAt?.toISOString() ?? null : b.startsAt, endsAt: b.endsAt === undefined ? cur.endsAt?.toISOString() ?? null : b.endsAt });
      const c = await tx.campaign.update({ where: { id }, data: { title: b.title, description: b.description, isActive: b.isActive, ...d } });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "campaign.updated", entity: "Campaign", entityId: id });
      return c;
    });
  }

  private audienceWhere(): Prisma.CustomerWhereInput {
    return { marketingConsent: true, anonymizedAt: null, phone: { not: null } };
  }

  /** Gönderimden önce kaç müşteriye gideceği (yalnızca ticari ileti izni olanlar). */
  audience(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.campaign.findUnique({ where: { id } }))) throw new NotFoundException("Kampanya bulunamadı");
      const [eligible, total] = await Promise.all([tx.customer.count({ where: this.audienceWhere() }), tx.customer.count({ where: { anonymizedAt: null } })]);
      return { eligible, withoutConsent: total - eligible, enabled: marketingEnabled(), max: MAX_BROADCAST };
    });
  }

  /**
   * Kampanya duyurusu: yalnızca ticari ileti izni olan müşterilere, işletmenin onaylı "kampanya_duyuru"
   * şablonuyla. İYS kaydı işletmenin sorumluluğundadır ve açıkça onaylanmalıdır. Aynı kampanya aynı müşteriye bir kez gider.
   */
  async broadcast(t: TenantInfo, id: string) {
    if (!marketingEnabled()) {
      throw new ServiceUnavailableException({
        message: "Toplu kampanya mesajı bu sunucuda kapalı: İYS (İleti Yönetim Sistemi) entegrasyonu henüz yok.",
        code: "MARKETING_DISABLED",
      });
    }
    if (!t.features.includes("WHATSAPP")) throw new ForbiddenException("WhatsApp mesajları paketinizde yok");
    const created: string[] = [];
    const r = await this.prisma.withTenant(t, async (tx) => {
      const c = await tx.campaign.findUnique({ where: { id } });
      if (!c) throw new NotFoundException("Kampanya bulunamadı");
      const now = new Date();
      if (!c.isActive || (c.endsAt && c.endsAt < now)) throw new ConflictException("Kampanya aktif değil veya süresi dolmuş");
      const conn = await tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId: t.tenantId, channel: "WHATSAPP" } } });
      if (conn?.status !== "CONNECTED") throw new ConflictException("Önce WhatsApp numaranızı bağlayıp doğrulayın");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { name: true } });
      const customers = await tx.customer.findMany({ where: this.audienceWhere(), select: { id: true, firstName: true, phone: true }, take: MAX_BROADCAST + 1 });
      if (customers.length > MAX_BROADCAST) throw new BadRequestException(`Tek seferde en fazla ${MAX_BROADCAST} müşteriye gönderilebilir`);
      const text = oneLine(`${c.title}. ${c.description}`, 600);
      let skipped = 0;
      for (const cu of customers) {
        const key = `kampanya:${c.id}:${cu.id}`;
        if (await tx.notification.findUnique({ where: { tenantId_dedupeKey: { tenantId: t.tenantId, dedupeKey: key } } })) {
          skipped++;
          continue;
        }
        const n = await tx.notification.create({
          data: {
            tenantId: t.tenantId,
            recipient: cu.phone!,
            template: "kampanya_duyuru",
            kind: "MARKETING",
            payload: { params: [oneLine(cu.firstName, 60), oneLine(tenant.name, 120), text] },
            customerId: cu.id,
            campaignId: c.id,
            dedupeKey: key,
          },
        });
        created.push(n.id);
      }
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "campaign.broadcast", entity: "Campaign", entityId: c.id, metadata: { queued: created.length, skipped, iysConfirmed: true } });
      return { queued: created.length, alreadySent: skipped };
    });
    for (const nid of created) await this.queue.enqueue(nid, new Date()).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
    return r;
  }
}
