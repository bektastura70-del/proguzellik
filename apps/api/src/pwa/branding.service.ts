import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { RateLimitService } from "../auth/rate-limit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { PublicBookingService } from "../public-booking/public-booking.service";
import { ImageError, inspectImage } from "./image-inspect";
import { effectivePwa } from "./pwa-settings";

export const MAX_ASSET_BYTES = 512 * 1024;

export interface BrandingInput {
  appName?: string | null;
  shortName?: string | null;
  description?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  cancelMinHours?: number;
  rescheduleMinHours?: number;
  allowCustomerCancel?: boolean;
  allowCustomerReschedule?: boolean;
}

/** Salon markalı PWA (Modül 4): ad, renkler, logo/simge ve müşteri iptal/değişiklik kuralları. */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly booking: PublicBookingService,
  ) {}

  /**
   * Ayar satırı yoksa varsayılanlarla (bayraklar kapalı) platform rolüyle açılır. Prisma eklemede tüm varsayılan
   * sütunları yazdığından, bayrak sütunlarına yetkisi olmayan kiracı rolü yalnızca güncelleme yapar.
   */
  private ensureRow(tenantId: string) {
    return this.prisma.platform.tenantPwaSettings.createMany({ data: [{ tenantId }], skipDuplicates: true });
  }

  async get(t: TenantInfo) {
    const pwa = await effectivePwa(this.prisma.platform, t.tenantId);
    const tenant = await this.prisma.platform.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { name: true, slug: true } });
    const assets = await this.prisma.withTenant(t, (tx) =>
      tx.tenantAsset.findMany({
        where: { id: { in: [pwa.logoAssetId, pwa.iconAssetId].filter((x): x is string => !!x) } },
        select: { id: true, kind: true, mime: true, width: true, height: true, createdAt: true },
      }),
    );
    return {
      salonName: tenant.name,
      slug: tenant.slug,
      appUrl: `/r/${tenant.slug}/uygulama`,
      flags: {
        customerPwaEnabled: pwa.customerPwaEnabled,
        customerBookingEnabled: pwa.customerBookingEnabled,
        customerSessionTrackingEnabled: pwa.customerSessionTrackingEnabled,
        webPushEnabled: pwa.webPushEnabled,
      },
      branding: {
        appName: pwa.appName,
        shortName: pwa.shortName,
        description: pwa.description,
        primaryColor: pwa.primaryColor,
        secondaryColor: pwa.secondaryColor,
        logo: assets.find((a) => a.id === pwa.logoAssetId) ?? null,
        icon: assets.find((a) => a.id === pwa.iconAssetId) ?? null,
      },
      rules: {
        cancelMinHours: pwa.cancelMinHours,
        rescheduleMinHours: pwa.rescheduleMinHours,
        allowCustomerCancel: pwa.allowCustomerCancel,
        allowCustomerReschedule: pwa.allowCustomerReschedule,
      },
    };
  }

  async update(t: TenantInfo, b: BrandingInput) {
    await this.ensureRow(t.tenantId);
    await this.prisma.withTenant(t, async (tx) => {
      const before = await tx.tenantPwaSettings.findUnique({ where: { tenantId: t.tenantId } });
      await tx.tenantPwaSettings.update({ where: { tenantId: t.tenantId }, data: b });
      const changed = Object.keys(b).filter((k) => (before as Record<string, unknown> | null)?.[k] !== (b as Record<string, unknown>)[k]);
      await this.audit.log(tx, {
        tenantId: t.tenantId, actorId: t.userId, action: "pwa.branding_updated", entity: "TenantPwaSettings", entityId: t.tenantId,
        metadata: { fields: changed },
      });
    });
    return this.get(t);
  }

  /** Logo veya simge yükleme. Tür dosya içeriğinden belirlenir; üst veri silinir; eski görsel kaldırılır. */
  async upload(t: TenantInfo, kind: "LOGO" | "ICON", body: unknown) {
    this.rateLimit.hit(`pwa-asset:${t.tenantId}`, 20, 60 * 60_000);
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException("Görsel dosyası gönderilmedi (PNG, JPEG veya WebP)");
    if (body.length > MAX_ASSET_BYTES) throw new BadRequestException("Görsel en fazla 512 KB olabilir");
    let img;
    try {
      img = inspectImage(body);
    } catch (e) {
      if (e instanceof ImageError) throw new BadRequestException(e.message);
      throw e;
    }
    if (kind === "ICON") {
      if (img.mime === "image/webp") throw new BadRequestException("Uygulama simgesi PNG veya JPEG olmalı (iPhone uyumu için)");
      if (img.width !== img.height) throw new BadRequestException("Uygulama simgesi kare olmalı (ör. 512×512)");
      if (img.width < 192) throw new BadRequestException("Uygulama simgesi en az 192×192 piksel olmalı (önerilen 512×512)");
    }
    if (img.width > 4096 || img.height > 4096) throw new BadRequestException("Görsel en fazla 4096 piksel olabilir");
    if (kind === "LOGO" && (img.width < 64 || img.height < 32)) throw new BadRequestException("Logo çok küçük");
    const sha256 = createHash("sha256").update(img.bytes).digest("hex");
    await this.ensureRow(t.tenantId);
    return this.prisma.withTenant(t, async (tx) => {
      const asset = await tx.tenantAsset.create({
        data: { tenantId: t.tenantId, kind, mime: img.mime, bytes: new Uint8Array(img.bytes), width: img.width, height: img.height, sha256, createdById: t.userId },
        select: { id: true, kind: true, mime: true, width: true, height: true, createdAt: true },
      });
      const field = kind === "LOGO" ? "logoAssetId" : "iconAssetId";
      await tx.tenantPwaSettings.update({ where: { tenantId: t.tenantId }, data: { [field]: asset.id } });
      // Kullanılmayan eski görseller saklanmaz.
      await tx.tenantAsset.deleteMany({ where: { kind, id: { not: asset.id } } });
      await this.audit.log(tx, {
        tenantId: t.tenantId, actorId: t.userId, action: "pwa.asset_uploaded", entity: "TenantAsset", entityId: asset.id,
        metadata: { kind, mime: img.mime, width: img.width, height: img.height, size: img.bytes.length },
      });
      return asset;
    });
  }

  async remove(t: TenantInfo, kind: "LOGO" | "ICON") {
    await this.prisma.withTenant(t, async (tx) => {
      const field = kind === "LOGO" ? "logoAssetId" : "iconAssetId";
      const row = await tx.tenantPwaSettings.findUnique({ where: { tenantId: t.tenantId } });
      if (row?.[field]) await tx.tenantPwaSettings.update({ where: { tenantId: t.tenantId }, data: { [field]: null } });
      await tx.tenantAsset.deleteMany({ where: { kind } });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "pwa.asset_removed", entity: "TenantAsset", metadata: { kind } });
    });
    return this.get(t);
  }

  /** Herkese açık görsel: yalnızca salonun şu an kullandığı logo/simge ve müşteri uygulaması/portalı açıkken. */
  async publicAsset(slug: string, id: string) {
    const tenant = await this.booking.resolve(slug);
    const pwa = await effectivePwa(this.prisma.platform, tenant.id);
    if (!(pwa.customerPwaEnabled || pwa.customerBookingEnabled)) throw new NotFoundException();
    if (id !== pwa.logoAssetId && id !== pwa.iconAssetId) throw new NotFoundException();
    const a = await this.prisma.platform.tenantAsset.findFirst({ where: { id, tenantId: tenant.id }, select: { mime: true, bytes: true, sha256: true } });
    if (!a) throw new NotFoundException();
    return a;
  }
}
