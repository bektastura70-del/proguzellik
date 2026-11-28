import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { phoneVariants } from "../common/phone";
import { BookingEmailPlanner } from "../notifications/booking-email.planner";
import { AppointmentHooks, AppointmentsService } from "../appointments/appointments.service";
import { AvailabilityService } from "../appointments/availability.service";
import { AuditService } from "../audit/audit.service";
import { assertUsageLimit, UsageLimitError } from "../billing/plan-pricing";
import { addMinutes } from "../common/time";
import { loadEnv, webPushMode } from "../config/env";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { PublicBookingService } from "../public-booking/public-booking.service";
import { CustomerAuthService, PortalIdentity } from "./customer-auth.service";
import { effectivePwa, EffectivePwa } from "./pwa-settings";

const MAX_DAYS_AHEAD = 60;
const MIN_LEAD_MIN = 15;

export interface PortalBookingInput {
  serviceId: string;
  staffId?: string;
  startsAt: string;
  firstName: string;
  lastName: string;
  phone: string;
  notes?: string;
  kvkkConsent: true;
  marketingConsent?: boolean;
}

type Tenant = Awaited<ReturnType<PublicBookingService["resolve"]>>;

/**
 * Müşteri portalı (salon PWA'sı). Herkese açık salon bilgisi ve boş saatler mevcut online rezervasyon uçlarından gelir;
 * burada yalnızca doğrulanmış müşteri işlemleri bulunur. Her işlem kiracı bağlamında (RLS) çalışır.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: PublicBookingService,
    private readonly auth: CustomerAuthService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    private readonly hooks: AppointmentHooks,
    private readonly audit: AuditService,
    private readonly emails: BookingEmailPlanner,
  ) {}

  private ctx(tenantId: string) {
    return { tenantId, userId: "" };
  }

  /** Salon + etkin PWA ayarları. Portal kapalıysa (bayrak) 404. */
  async portalTenant(slug: string): Promise<{ tenant: Tenant; pwa: EffectivePwa }> {
    const tenant = await this.booking.resolve(slug);
    const pwa = await effectivePwa(this.prisma.platform, tenant.id);
    if (!pwa.customerBookingEnabled) throw new NotFoundException("Müşteri portalı bu işletmede açık değil");
    return { tenant, pwa };
  }

  /** Uygulama (manifest/marka) bilgisi: hassas veri içermez. Portal kapalı olsa da döner (eski akış için bayraklar false). */
  async appInfo(slug: string) {
    const t = await this.booking.resolve(slug);
    const pwa = await effectivePwa(this.prisma.platform, t.id);
    const pushOn = pwa.customerBookingEnabled && pwa.webPushEnabled && webPushMode(loadEnv()) !== "off";
    return {
      slug: t.slug,
      name: pwa.appName || t.name,
      shortName: (pwa.shortName || pwa.appName || t.name).slice(0, 12),
      description: pwa.description,
      primaryColor: pwa.primaryColor,
      secondaryColor: pwa.secondaryColor,
      logoUrl: pwa.logoAssetId ? `/r/${t.slug}/marka/${pwa.logoAssetId}` : null,
      iconUrl: pwa.iconAssetId ? `/r/${t.slug}/marka/${pwa.iconAssetId}` : null,
      features: {
        installable: pwa.customerPwaEnabled,
        portal: pwa.customerBookingEnabled,
        packages: pwa.customerSessionTrackingEnabled,
        push: pushOn,
      },
      rules: pwa.customerBookingEnabled
        ? { cancelMinHours: pwa.cancelMinHours, rescheduleMinHours: pwa.rescheduleMinHours, allowCancel: pwa.allowCustomerCancel, allowReschedule: pwa.allowCustomerReschedule }
        : null,
      vapidPublicKey: pushOn ? (loadEnv().VAPID_PUBLIC_KEY ?? null) : null,
    };
  }

  /** Oturumlu işlem yardımcısı: kiracı bağlamı + müşteri kimliği. */
  async withIdentity<T>(slug: string, token: string | undefined, fn: (tx: Tx, me: PortalIdentity, ctx: { tenant: Tenant; pwa: EffectivePwa }) => Promise<T>) {
    const c = await this.portalTenant(slug);
    return this.prisma.withTenant(this.ctx(c.tenant.id), async (tx) => {
      const me = await this.auth.resolve(tx, c.tenant.id, token);
      return fn(tx, me, c);
    });
  }

  /** Kimliğin görebildiği randevular: portaldan kendisinin aldıkları + e-postası işletme kaydındaki müşteriyle eşleşenler. */
  private mine(me: PortalIdentity): Prisma.AppointmentWhereInput {
    return { OR: [{ portalIdentityId: me.identityId }, { customer: { email: { equals: me.email, mode: "insensitive" }, anonymizedAt: null } }] };
  }

  me(slug: string, token?: string) {
    return this.withIdentity(slug, token, async (tx, me) => {
      const identity = await tx.customerIdentity.findUniqueOrThrow({ where: { id: me.identityId } });
      return { email: identity.email, notifyAppointments: identity.notifyAppointments, notifyReminders: identity.notifyReminders };
    });
  }

  updatePreferences(slug: string, token: string | undefined, b: { notifyAppointments?: boolean; notifyReminders?: boolean }) {
    return this.withIdentity(slug, token, async (tx, me) => {
      const identity = await tx.customerIdentity.update({ where: { id: me.identityId }, data: b });
      return { email: identity.email, notifyAppointments: identity.notifyAppointments, notifyReminders: identity.notifyReminders };
    });
  }

  private present(a: { id: string; startsAt: Date; endsAt: Date; status: string; price: Prisma.Decimal; serviceId: string; staffId: string; service: { name: string }; staff: { displayName: string } }, pwa: EffectivePwa) {
    const hoursLeft = (a.startsAt.getTime() - Date.now()) / 3_600_000;
    const open = ["BOOKED", "CONFIRMED"].includes(a.status) && hoursLeft > 0;
    return {
      id: a.id,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      price: a.price,
      serviceId: a.serviceId,
      staffId: a.staffId,
      service: a.service.name,
      staff: a.staff.displayName,
      canCancel: open && pwa.allowCustomerCancel && hoursLeft >= pwa.cancelMinHours,
      canReschedule: open && pwa.allowCustomerReschedule && hoursLeft >= pwa.rescheduleMinHours,
    };
  }

  appointmentsList(slug: string, token?: string) {
    return this.withIdentity(slug, token, async (tx, me, { pwa }) => {
      const rows = await tx.appointment.findMany({
        where: { AND: [this.mine(me), { startsAt: { gt: new Date(Date.now() - 365 * 86_400_000) } }] },
        orderBy: { startsAt: "desc" },
        take: 100,
        select: { id: true, startsAt: true, endsAt: true, status: true, price: true, serviceId: true, staffId: true, service: { select: { name: true } }, staff: { select: { displayName: true } } },
      });
      const now = Date.now();
      const list = rows.map((r) => this.present(r, pwa));
      return {
        upcoming: list.filter((a) => a.startsAt.getTime() >= now).reverse(),
        past: list.filter((a) => a.startsAt.getTime() < now),
      };
    });
  }

  private async findMine(tx: Tx, me: PortalIdentity, id: string) {
    const appt = await tx.appointment.findFirst({ where: { AND: [{ id }, this.mine(me)] }, include: { service: true, staff: true } });
    // Başkasının randevusu ile olmayan randevu aynı yanıtı alır (varlık sızdırılmaz).
    if (!appt) throw new NotFoundException("Randevu bulunamadı");
    return appt;
  }

  async book(slug: string, token: string | undefined, idemKey: string | undefined, b: PortalBookingInput, ip?: string) {
    const c = await this.portalTenant(slug);
    const t = c.tenant;
    const start = new Date(b.startsAt);
    if (start.getTime() < Date.now() + MIN_LEAD_MIN * 60_000) throw new BadRequestException("Geçmiş veya çok yakın bir saat seçilemez");
    if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new BadRequestException("Seçilen tarih çok ileri");

    const run = () =>
      this.prisma.withTenant(this.ctx(t.id), async (tx) => {
        const me = await this.auth.resolve(tx, t.id, token);
        const key = idemKey ? `${me.identityId}:${idemKey}` : undefined;
        if (key) {
          const prev = await tx.appointment.findUnique({ where: { tenantId_idempotencyKey: { tenantId: t.id, idempotencyKey: key } }, include: { service: true, staff: true } });
          if (prev) return { appt: prev, service: prev.service, staffName: prev.staff.displayName, replay: true };
        }
        const service = await tx.service.findUnique({ where: { id: b.serviceId } });
        if (!service || !service.isActive || !service.onlineBookable) throw new NotFoundException("Hizmet bulunamadı");
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
        const slots = await this.availability.slots(tx, { tenantId: t.id, date: localDate, serviceId: service.id, staffId: b.staffId, onlineOnly: true });
        const slot = slots.find((s) => s.startsAt === start.toISOString());
        if (!slot) throw new ConflictException("Seçilen saat artık müsait değil");

        // 1) Doğrulanmış e-posta işletmedeki müşteri kaydıyla eşleşiyorsa o kayıt kullanılır.
        let customer = await tx.customer.findFirst({
          where: { email: { equals: me.email, mode: "insensitive" }, anonymizedAt: null },
          orderBy: { createdAt: "asc" },
        });
        let note: string | undefined;
        if (!customer) {
          // 2) Telefon başka bir kayıtla eşleşiyorsa kişinin o müşteri olduğu kanıtlanamaz: kayıt değiştirilmez,
          //    randevu bağlanır ve resepsiyon teyit etsin diye not düşülür (KVKK onayı/izinler o kayda yazılmaz).
          const byPhone = await tx.customer.findFirst({ where: { phone: { in: phoneVariants(b.phone) } }, orderBy: { createdAt: "asc" } });
          if (byPhone && !byPhone.anonymizedAt) {
            customer = byPhone;
            note = `Online portal: e-posta ${me.email} ile doğrulanmış kişi bu telefonla randevu aldı; kayıttaki müşteriyle aynı kişi olduğunu lütfen teyit edin.`;
          }
        }
        if (!customer) {
          await assertUsageLimit(tx, t.id, "customer");
          customer = await tx.customer.create({
            data: {
              tenantId: t.id, firstName: b.firstName, lastName: b.lastName, phone: b.phone, email: me.email,
              source: "ONLINE", kvkkConsentAt: new Date(), marketingConsent: b.marketingConsent ?? false,
            },
          });
        }
        const appt = await this.appointments.createInTx(tx, t.id, {
          customerId: customer.id,
          staffId: slot.staffId,
          serviceId: service.id,
          startsAt: slot.startsAt,
          notes: [note, b.notes].filter(Boolean).join("\n") || undefined,
          source: "ONLINE",
          portalIdentityId: me.identityId,
          idempotencyKey: key,
        });
        await this.emails.customerConfirmation(tx, appt.id, me.email);
        await this.audit.log(tx, { tenantId: t.id, action: "booking.portal_created", entity: "Appointment", entityId: appt.id, ip });
        return { appt, service, staffName: slot.staffName, replay: false };
      });

    const fail = (e: unknown): never => {
      if (e instanceof UsageLimitError) throw new ConflictException("Şu anda online randevu alınamıyor. Lütfen işletmeyle iletişime geçin.");
      return AppointmentsService.overlapGuard(e);
    };
    let result;
    try {
      result = await run();
    } catch (e) {
      // Aynı anahtarla eşzamanlı ikinci istek (benzersizlik veya çakışma kısıtına takılır): ilk istek kazandı, onun sonucu döner.
      const conflict = (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || /appointment_no_overlap|23P01/.test((e as Error)?.message ?? "");
      if (!idemKey || !conflict) fail(e);
      result = await run().catch(fail);
    }
    return {
      bookingId: result.appt.id,
      replay: result.replay,
      salon: t.name,
      service: result.service.name,
      staff: result.staffName,
      startsAt: result.appt.startsAt,
      endsAt: result.appt.endsAt,
      price: result.appt.price,
      status: result.appt.status,
    };
  }

  cancel(slug: string, token: string | undefined, id: string, ip?: string) {
    return this.withIdentity(slug, token, async (tx, me, { pwa, tenant }) => {
      const appt = await this.findMine(tx, me, id);
      if (!pwa.allowCustomerCancel) throw new ForbiddenException("Bu işletmede online iptal kapalı; lütfen işletmeyi arayın");
      if (!["BOOKED", "CONFIRMED"].includes(appt.status)) throw new ConflictException("Randevu iptal edilemez");
      if (appt.startsAt.getTime() - Date.now() < pwa.cancelMinHours * 3_600_000) {
        throw new ConflictException(`Randevuya ${pwa.cancelMinHours} saatten az kaldığı için lütfen işletmeyi arayın`);
      }
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, status: { in: ["BOOKED", "CONFIRMED"] } },
        data: { status: "CANCELLED", cancelReason: "Müşteri portaldan iptal etti" },
      });
      if (res.count !== 1) throw new ConflictException("Randevu iptal edilemez");
      const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id } });
      await this.hooks.onStatusChanged(tx, updated, undefined, "CUSTOMER");
      await this.audit.log(tx, { tenantId: tenant.id, action: "booking.portal_cancelled", entity: "Appointment", entityId: appt.id, ip });
      return this.present({ ...updated, service: appt.service, staff: appt.staff }, pwa);
    });
  }

  reschedule(slug: string, token: string | undefined, id: string, b: { startsAt: string; staffId?: string }, ip?: string) {
    return this.withIdentity(slug, token, async (tx, me, { pwa, tenant }) => {
      const appt = await this.findMine(tx, me, id);
      if (!pwa.allowCustomerReschedule) throw new ForbiddenException("Bu işletmede online değişiklik kapalı; lütfen işletmeyi arayın");
      if (!["BOOKED", "CONFIRMED"].includes(appt.status)) throw new ConflictException("Bu randevu değiştirilemez");
      if (appt.startsAt.getTime() - Date.now() < pwa.rescheduleMinHours * 3_600_000) {
        throw new ConflictException(`Randevuya ${pwa.rescheduleMinHours} saatten az kaldığı için lütfen işletmeyi arayın`);
      }
      const start = new Date(b.startsAt);
      if (start.getTime() < Date.now() + MIN_LEAD_MIN * 60_000) throw new BadRequestException("Geçmiş veya çok yakın bir saat seçilemez");
      if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new BadRequestException("Seçilen tarih çok ileri");
      if (!appt.service.isActive || !appt.service.onlineBookable) throw new ConflictException("Bu hizmet için online değişiklik yapılamıyor; lütfen işletmeyi arayın");
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
      const slots = await this.availability.slots(tx, {
        tenantId: tenant.id, date: localDate, serviceId: appt.serviceId, staffId: b.staffId ?? appt.staffId, onlineOnly: true, excludeAppointmentId: appt.id,
      });
      const slot = slots.find((s) => s.startsAt === start.toISOString());
      if (!slot) throw new ConflictException("Seçilen saat artık müsait değil");
      // Paketli randevu: süre ve paket aynı kalır. Onaylanmış randevu yeniden işletme onayına düşer.
      const updated = await tx.appointment.update({
        where: { id: appt.id },
        data: { startsAt: start, endsAt: addMinutes(start, appt.service.durationMin), staffId: slot.staffId, status: "BOOKED" },
      });
      await this.hooks.onRescheduled(tx, updated, { startsAt: appt.startsAt, staffId: appt.staffId }, "CUSTOMER");
      await this.audit.log(tx, {
        tenantId: tenant.id, action: "booking.portal_rescheduled", entity: "Appointment", entityId: appt.id, ip,
        metadata: { from: appt.startsAt.toISOString(), to: start.toISOString(), staffId: slot.staffId },
      });
      return this.present({ ...updated, service: appt.service, staff: { displayName: slot.staffName } }, pwa);
    }).catch(AppointmentsService.overlapGuard);
  }

  /** Müşterinin paketleri ve kalan seansları (yalnız işletme kaydındaki e-postası doğrulanmış kimlikle eşleşen müşteriler). */
  packages(slug: string, token?: string) {
    return this.withIdentity(slug, token, async (tx, me, { pwa }) => {
      if (!pwa.customerSessionTrackingEnabled) throw new NotFoundException("Paket takibi bu işletmede açık değil");
      const rows = await tx.customerPackage.findMany({
        where: { customer: { email: { equals: me.email, mode: "insensitive" }, anonymizedAt: null } },
        orderBy: { purchasedAt: "desc" },
        take: 50,
        select: {
          id: true, name: true, totalSessions: true, usedSessions: true, status: true, purchasedAt: true, expiresAt: true,
          service: { select: { name: true } },
          appointments: { where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: new Date() } }, select: { id: true } },
        },
      });
      const now = new Date();
      return rows.map((p) => {
        const expired = p.status === "ACTIVE" && p.expiresAt !== null && p.expiresAt < now;
        return {
          id: p.id,
          name: p.name,
          service: p.service.name,
          totalSessions: p.totalSessions,
          usedSessions: p.usedSessions,
          remainingSessions: Math.max(0, p.totalSessions - p.usedSessions),
          plannedSessions: p.appointments.length,
          status: expired ? "EXPIRED" : p.status,
          purchasedAt: p.purchasedAt,
          expiresAt: p.expiresAt,
        };
      });
    });
  }
}
