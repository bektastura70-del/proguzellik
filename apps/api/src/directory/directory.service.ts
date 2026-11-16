import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { directionsUrl, fullAddress } from "./address";
import { allUnits, districtBySlug, districtIn, provinceByCode, provinceBySlug, sortTr } from "./admin-units";

export interface ListingInput {
  enabled: boolean;
  provinceCode: number | null;
  districtCode: number | null;
  showAddress: boolean;
  showPhone: boolean;
  showDirections: boolean;
}

export const PAGE_SIZE = 50;

type ListingRow = {
  enabled: boolean;
  provinceCode: number | null;
  districtCode: number | null;
  showAddress: boolean;
  showPhone: boolean;
  showDirections: boolean;
  enabledAt: Date | null;
  blockedAt: Date | null;
  blockedReason: string | null;
};

/**
 * Rehberde görünebilecek işletme: online randevuya açık (salon sayfası /r/<kod> çalışıyor), deneme süresi bitmemiş
 * ya da aktif. Askıya alınan, süresi biten ya da randevuyu kapatan salon kendiliğinden düşer; kayıt silinmez.
 * PublicBookingService.resolve ile aynı kural.
 */
function eligibleTenant(now: Date): Prisma.TenantWhereInput {
  return {
    onlineBookingEnabled: true,
    plan: { features: { has: "ONLINE_BOOKING" } },
    OR: [{ status: "ACTIVE" }, { status: "TRIAL", OR: [{ trialEndsAt: null }, { trialEndsAt: { gte: now } }] }],
  };
}

function visibleListing(now: Date): Prisma.SalonListingWhereInput {
  return { enabled: true, blockedAt: null, provinceCode: { not: null }, districtCode: { not: null }, tenant: eligibleTenant(now) };
}

function eligibilityIssues(
  t: { onlineBookingEnabled: boolean; status: string; trialEndsAt: Date | null; plan: { features: string[] } },
  now: Date,
) {
  const issues: string[] = [];
  if (!t.onlineBookingEnabled || !t.plan.features.includes("ONLINE_BOOKING")) {
    issues.push("Online randevu kapalı: salon sayfanız açık olmadığı için rehberde görünmezsiniz.");
  }
  if (!["TRIAL", "ACTIVE"].includes(t.status) || (t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt < now)) {
    issues.push("Aboneliğiniz etkin değil: rehberde görünmezsiniz.");
  }
  return issues;
}

function shape(row: ListingRow | null) {
  const r: ListingRow = row ?? {
    enabled: false, provinceCode: null, districtCode: null, showAddress: false, showPhone: false, showDirections: false,
    enabledAt: null, blockedAt: null, blockedReason: null,
  };
  const province = provinceByCode(r.provinceCode);
  const district = province && r.districtCode != null ? districtIn(province.code, r.districtCode) : undefined;
  return {
    enabled: r.enabled,
    provinceCode: r.provinceCode,
    districtCode: r.districtCode,
    provinceName: province?.name ?? null,
    districtName: district?.name ?? null,
    showAddress: r.showAddress,
    showPhone: r.showPhone,
    showDirections: r.showDirections,
    enabledAt: r.enabledAt,
    blocked: !!r.blockedAt,
    blockedReason: r.blockedAt ? r.blockedReason : null,
  };
}

/** Mobil uygulama salon rehberi: işletmenin listeleme ayarı, herkese açık liste ve SaaS sahibi denetimi. */
@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  units() {
    return allUnits();
  }

  /** İşletme paneli: mevcut ayar ve rehberde tam olarak ne görüneceği (önizleme). */
  async getForTenant(ti: TenantInfo) {
    const row = await this.prisma.withTenant(ti, (tx) => tx.salonListing.findUnique({ where: { tenantId: ti.tenantId } }));
    const t = await this.prisma.platform.tenant.findUniqueOrThrow({
      where: { id: ti.tenantId },
      select: {
        name: true, slug: true, address: true, neighborhood: true, phone: true, onlineBookingEnabled: true, status: true, trialEndsAt: true,
        plan: { select: { features: true } }, pwaSettings: { select: { logoAssetId: true } },
      },
    });
    const listing = shape(row);
    const issues = eligibilityIssues(t, new Date());
    const address = fullAddress(t.address, t.neighborhood, listing);
    return {
      listing,
      visible: listing.enabled && !listing.blocked && listing.districtName !== null && issues.length === 0,
      issues,
      preview: {
        name: t.name,
        slug: t.slug,
        logoUrl: t.pwaSettings?.logoAssetId ? `/r/${t.slug}/marka/${t.pwaSettings.logoAssetId}` : null,
        address: listing.showAddress ? address : null,
        phone: listing.showPhone ? t.phone : null,
        /** Salon sayfasında her zaman (adres orada zaten açık), rehberde yalnızca adres de gösteriliyorsa */
        directionsUrl: listing.showDirections ? directionsUrl(address) : null,
        provinceName: listing.provinceName,
        districtName: listing.districtName,
      },
      /** İşletmenin kendi kayıtlı adres/telefonu (önizleme için; rehberde yalnızca izinle görünür) */
      salonAddress: address,
      salonStreet: t.address,
      salonNeighborhood: t.neighborhood,
      salonPhone: t.phone,
    };
  }

  async updateForTenant(ti: TenantInfo, b: ListingInput, ip?: string) {
    if (b.enabled && (b.provinceCode == null || b.districtCode == null)) {
      throw new BadRequestException("Rehberde görünmek için il ve ilçe seçin");
    }
    if (b.provinceCode != null && !provinceByCode(b.provinceCode)) throw new BadRequestException("Geçersiz il");
    if (b.districtCode != null && (b.provinceCode == null || !districtIn(b.provinceCode, b.districtCode))) {
      throw new BadRequestException("Seçilen ilçe bu ile ait değil");
    }

    await this.prisma.withTenant(ti, async (tx) => {
      const before = await tx.salonListing.findUnique({ where: { tenantId: ti.tenantId } });
      if (b.enabled && before?.blockedAt) {
        throw new ConflictException("Salonunuz Pro Güzellik tarafından rehberden çıkarıldı. Bilgi için bize yazın.");
      }
      const turningOn = b.enabled && !before?.enabled;
      const data = {
        enabled: b.enabled,
        provinceCode: b.provinceCode,
        districtCode: b.districtCode,
        showAddress: b.showAddress,
        showPhone: b.showPhone,
        showDirections: b.showDirections,
        ...(turningOn ? { enabledById: ti.userId, enabledAt: new Date() } : {}),
      };
      if (before) await tx.salonListing.update({ where: { tenantId: ti.tenantId }, data });
      else await tx.salonListing.create({ data: { tenantId: ti.tenantId, ...data } });
      const action = turningOn ? "salon.listing_enabled" : before?.enabled && !b.enabled ? "salon.listing_disabled" : "salon.listing_updated";
      await this.audit.log(tx, {
        tenantId: ti.tenantId, actorId: ti.userId, ip, action, entity: "SalonListing", entityId: ti.tenantId,
        metadata: {
          before: before
            ? { enabled: before.enabled, provinceCode: before.provinceCode, districtCode: before.districtCode, showAddress: before.showAddress, showPhone: before.showPhone, showDirections: before.showDirections }
            : null,
          after: { enabled: b.enabled, provinceCode: b.provinceCode, districtCode: b.districtCode, showAddress: b.showAddress, showPhone: b.showPhone, showDirections: b.showDirections },
        },
      });
    });
    return this.getForTenant(ti);
  }

  /* ---------------- Herkese açık rehber (girişsiz, yalnızca açık alanlar) ---------------- */

  private visibleRows(extra: Prisma.SalonListingWhereInput) {
    return this.prisma.platform.salonListing.findMany({
      where: { AND: [visibleListing(new Date()), extra] },
      select: { provinceCode: true, districtCode: true },
    });
  }

  /** Yalnızca en az bir listelenen salonu olan iller (salon sayısıyla). */
  async publicProvinces() {
    const rows = await this.visibleRows({});
    const counts = new Map<number, number>();
    for (const r of rows) if (r.provinceCode != null) counts.set(r.provinceCode, (counts.get(r.provinceCode) ?? 0) + 1);
    const list = [...counts].flatMap(([code, count]) => {
      const p = provinceByCode(code);
      return p ? [{ code: p.code, name: p.name, slug: p.slug, count }] : [];
    });
    return { provinces: sortTr(list) };
  }

  async publicDistricts(provinceSlug: string) {
    const p = provinceBySlug(provinceSlug);
    if (!p) throw new NotFoundException("İl bulunamadı");
    const rows = await this.visibleRows({ provinceCode: p.code });
    const counts = new Map<number, number>();
    for (const r of rows) if (r.districtCode != null) counts.set(r.districtCode, (counts.get(r.districtCode) ?? 0) + 1);
    const list = [...counts].flatMap(([code, count]) => {
      const d = districtIn(p.code, code);
      return d ? [{ code: d.code, name: d.name, slug: d.slug, count }] : [];
    });
    return { province: { code: p.code, name: p.name, slug: p.slug }, districts: sortTr(list) };
  }

  async publicSalons(provinceSlug: string, districtSlug: string, page: number) {
    const p = provinceBySlug(provinceSlug);
    const d = p ? districtBySlug(p, districtSlug) : undefined;
    if (!p || !d) throw new NotFoundException("İlçe bulunamadı");
    const where: Prisma.SalonListingWhereInput = { AND: [visibleListing(new Date()), { provinceCode: p.code, districtCode: d.code }] };
    const [total, rows] = await Promise.all([
      this.prisma.platform.salonListing.count({ where }),
      this.prisma.platform.salonListing.findMany({
        where,
        // Açık alan listesi: yalnızca rehberde gösterilebilecek alanlar okunur.
        select: {
          showAddress: true,
          showPhone: true,
          showDirections: true,
          provinceCode: true,
          districtCode: true,
          tenant: { select: { name: true, slug: true, address: true, neighborhood: true, phone: true, pwaSettings: { select: { logoAssetId: true } } } },
        },
        orderBy: { tenant: { name: "asc" } },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const salons = rows.map((r) => {
      const address = r.showAddress ? fullAddress(r.tenant.address, r.tenant.neighborhood, r) : null;
      return {
        slug: r.tenant.slug,
        name: r.tenant.name,
        logoUrl: r.tenant.pwaSettings?.logoAssetId ? `/r/${r.tenant.slug}/marka/${r.tenant.pwaSettings.logoAssetId}` : null,
        address,
        phone: r.showPhone ? r.tenant.phone : null,
        // Adres gösterilmiyorsa yol tarifi de verilmez (adres null).
        directionsUrl: r.showDirections ? directionsUrl(address) : null,
      };
    });
    return {
      province: { code: p.code, name: p.name, slug: p.slug },
      district: { code: d.code, name: d.name, slug: d.slug },
      salons: sortTr(salons),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /* ---------------- SaaS sahibi ---------------- */

  async platformList() {
    const rows = await this.prisma.platform.salonListing.findMany({
      where: { OR: [{ enabled: true }, { blockedAt: { not: null } }] },
      include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return { listings: rows.map((r) => ({ tenant: r.tenant, ...shape(r), updatedAt: r.updatedAt })) };
  }

  async platformBlock(tenantId: string, actorId: string, block: boolean, reason: string) {
    const row = await this.prisma.platform.salonListing.findUnique({ where: { tenantId } });
    if (!row) throw new NotFoundException("Bu işletmenin rehber kaydı yok");
    await this.prisma.platform.$transaction(async (tx) => {
      await tx.salonListing.update({
        where: { tenantId },
        data: block ? { blockedAt: new Date(), blockedReason: reason } : { blockedAt: null, blockedReason: null },
      });
      await this.audit.log(tx, {
        tenantId, actorId, action: block ? "platform.salon_listing_blocked" : "platform.salon_listing_unblocked",
        entity: "SalonListing", entityId: tenantId, metadata: { reason },
      });
    });
    return this.platformList();
  }
}
