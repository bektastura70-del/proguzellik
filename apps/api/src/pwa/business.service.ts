import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { TenantInfo } from "../common/decorators";
import { zonedTime } from "../common/time";
import { loadEnv, webPushMode } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { effectivePwa } from "./pwa-settings";

const DESK = ["OWNER", "MANAGER", "RECEPTION"];

/** İşletme ve personel mobil paneli (Modül 2): günlük plan, onay bekleyenler, bildirim merkezi, PWA ayarları. */
@Injectable()
export class BusinessPwaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paneldeki etkin PWA bayrakları (tüm roller okur; yalnız SaaS sahibi değiştirir). */
  async flags(t: TenantInfo) {
    const pwa = await effectivePwa(this.prisma.platform, t.tenantId);
    return {
      businessPwaEnabled: pwa.businessPwaEnabled,
      customerPwaEnabled: pwa.customerPwaEnabled,
      customerBookingEnabled: pwa.customerBookingEnabled,
      webPushEnabled: pwa.webPushEnabled,
      customerSessionTrackingEnabled: pwa.customerSessionTrackingEnabled,
      pushAvailable: pwa.businessPwaEnabled && pwa.webPushEnabled && webPushMode(loadEnv()) !== "off",
      vapidPublicKey: pwa.businessPwaEnabled && pwa.webPushEnabled && webPushMode(loadEnv()) !== "off" ? (loadEnv().VAPID_PUBLIC_KEY ?? null) : null,
    };
  }

  private async requireBusinessPwa(t: TenantInfo) {
    const pwa = await effectivePwa(this.prisma.platform, t.tenantId);
    if (!pwa.businessPwaEnabled) throw new NotFoundException("İşletme mobil uygulaması bu işletmede açık değil");
    return pwa;
  }

  /**
   * Günlük çalışma planı. Personel (STAFF) yalnızca kendi randevularını görür; diğer roller isterse personele göre süzer.
   * Telefon yalnızca masa rolleri ve randevunun kendi personeli için döner (veri minimizasyonu).
   */
  async agenda(t: TenantInfo, q: { date: string; staffId?: string }) {
    await this.requireBusinessPwa(t);
    return this.prisma.withTenant(t, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { timezone: true } });
      const from = zonedTime(q.date, 0, tenant.timezone);
      const to = zonedTime(q.date, 1440, tenant.timezone);
      const staffFilter = q.staffId;
      let ownStaffIds: string[] = [];
      if (t.role === "STAFF") {
        ownStaffIds = (await tx.staffMember.findMany({ where: { userId: t.userId }, select: { id: true } })).map((s) => s.id);
        if (ownStaffIds.length === 0) return { date: q.date, own: true, items: [] };
      }
      const rows = await tx.appointment.findMany({
        where: {
          startsAt: { gte: from, lt: to },
          ...(t.role === "STAFF" ? { staffId: { in: ownStaffIds } } : staffFilter ? { staffId: staffFilter } : {}),
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true, startsAt: true, endsAt: true, status: true, source: true, notes: true, customerPackageId: true,
          customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
          staff: { select: { id: true, displayName: true, color: true, userId: true } },
          service: { select: { id: true, name: true } },
        },
      });
      return {
        date: q.date,
        own: t.role === "STAFF",
        items: rows.map(({ staff: { userId, ...staff }, customer, ...a }) => {
          const mine = userId === t.userId;
          return {
            ...a,
            staff,
            mine,
            customer: { ...customer, phone: DESK.includes(t.role) || mine ? customer.phone : null },
            // İşletmenin mevcut kuralları: masa rolleri tüm randevularda, personel yalnız kendi randevusunda durum değiştirir.
            canChangeStatus: DESK.includes(t.role) || mine,
          };
        }),
      };
    });
  }

  /** Onay bekleyen yeni randevular (gelecekteki BOOKED). Personel yalnız kendisine atananları görür. */
  async pending(t: TenantInfo) {
    await this.requireBusinessPwa(t);
    return this.prisma.withTenant(t, async (tx) => {
      const own = t.role === "STAFF" ? (await tx.staffMember.findMany({ where: { userId: t.userId }, select: { id: true } })).map((s) => s.id) : null;
      if (own && own.length === 0) return [];
      const rows = await tx.appointment.findMany({
        where: { status: "BOOKED", startsAt: { gt: new Date() }, ...(own ? { staffId: { in: own } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, startsAt: true, createdAt: true, source: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
          staff: { select: { id: true, displayName: true } },
          service: { select: { name: true } },
        },
      });
      return rows;
    });
  }

  /** Uygulama içi bildirim merkezi: yalnız oturumdaki kullanıcıya ait kayıtlar. */
  notifications(t: TenantInfo, q: { unread?: boolean }) {
    return this.prisma.withTenant(t, async (tx) => {
      const where = { audience: "STAFF", userId: t.userId, ...(q.unread ? { readAt: null } : {}) };
      const [items, unread] = await Promise.all([
        tx.inAppNotification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, title: true, body: true, appointmentId: true, readAt: true, createdAt: true } }),
        tx.inAppNotification.count({ where: { audience: "STAFF", userId: t.userId, readAt: null } }),
      ]);
      return { items, unread };
    });
  }

  markRead(t: TenantInfo, id: string | "all") {
    return this.prisma.withTenant(t, async (tx) => {
      const res = await tx.inAppNotification.updateMany({
        where: { audience: "STAFF", userId: t.userId, readAt: null, ...(id === "all" ? {} : { id }) },
        data: { readAt: new Date() },
      });
      if (id !== "all" && res.count === 0) {
        const exists = await tx.inAppNotification.count({ where: { id, audience: "STAFF", userId: t.userId } });
        if (!exists) throw new NotFoundException("Bildirim bulunamadı");
      }
      return { updated: res.count };
    });
  }

  preferences(t: TenantInfo) {
    return this.prisma.withTenant(t, async (tx) => {
      const p = await tx.userNotificationPreference.findUnique({ where: { tenantId_userId: { tenantId: t.tenantId, userId: t.userId } } });
      return p ?? { tenantId: t.tenantId, userId: t.userId, newAppointments: true, cancellations: true, changes: true, assignments: true };
    });
  }

  updatePreferences(t: TenantInfo, b: { newAppointments?: boolean; cancellations?: boolean; changes?: boolean; assignments?: boolean }) {
    if (t.role === "STAFF" && (b.newAppointments !== undefined)) {
      // Personel yalnızca kendine atananları alır; "tüm yeni randevular" tercihi masa rolleri içindir.
      throw new ForbiddenException("Bu tercih yalnızca yönetim ve resepsiyon içindir");
    }
    return this.prisma.withTenant(t, (tx) =>
      tx.userNotificationPreference.upsert({
        where: { tenantId_userId: { tenantId: t.tenantId, userId: t.userId } },
        create: { tenantId: t.tenantId, userId: t.userId, ...b },
        update: b,
      }),
    );
  }
}
