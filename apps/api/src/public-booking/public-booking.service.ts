import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppointmentHooks, AppointmentsService } from "../appointments/appointments.service";
import { AvailabilityService } from "../appointments/availability.service";
import { AuditService } from "../audit/audit.service";
import { assertUsageLimit, UsageLimitError } from "../billing/plan-pricing";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

const MAX_DAYS_AHEAD = 60;
const CANCEL_MIN_HOURS = 2;

export interface BookingInput {
  serviceId: string;
  staffId?: string;
  startsAt: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  notes?: string;
  kvkkConsent: true;
  marketingConsent?: boolean;
}

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly hooks: AppointmentHooks,
  ) {}

  /** Online rezervasyona açık işletmeyi slug ile bulur (yalnızca herkese açık alanlar). */
  private async resolve(slug: string) {
    const t = await this.prisma.platform.tenant.findUnique({ where: { slug }, include: { plan: true } });
    const trialOver = t?.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt < new Date();
    if (
      !t ||
      !t.onlineBookingEnabled ||
      !t.plan.features.includes("ONLINE_BOOKING") ||
      !["TRIAL", "ACTIVE"].includes(t.status) ||
      trialOver
    ) {
      throw new NotFoundException("İşletme online randevuya kapalı");
    }
    return t;
  }

  private ctx(tenantId: string) {
    return { tenantId, userId: "" };
  }

  static token(appointmentId: string) {
    return createHmac("sha256", loadEnv().JWT_SECRET).update(`booking:${appointmentId}`).digest("base64url");
  }

  async salon(slug: string) {
    const t = await this.resolve(slug);
    return this.prisma.withTenant(this.ctx(t.id), async (tx) => {
      const [services, staff] = await Promise.all([
        tx.service.findMany({
          where: { isActive: true, onlineBookable: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, durationMin: true, price: true, category: { select: { name: true } } },
        }),
        tx.staffMember.findMany({
          where: { isActive: true, onlineBookable: true },
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true, title: true, services: { select: { serviceId: true } } },
        }),
      ]);
      return {
        salon: { name: t.name, slug: t.slug, phone: t.phone, address: t.address, timezone: t.timezone },
        services,
        staff: staff.map((s) => ({ id: s.id, displayName: s.displayName, title: s.title, serviceIds: s.services.map((x) => x.serviceId) })),
      };
    });
  }

  async slots(slug: string, q: { date: string; serviceId: string; staffId?: string }) {
    const t = await this.resolve(slug);
    const day = new Date(`${q.date}T00:00:00Z`).getTime();
    if (day > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new BadRequestException(`En fazla ${MAX_DAYS_AHEAD} gün sonrası için randevu alınabilir`);
    const slots = await this.prisma.withTenant(this.ctx(t.id), (tx) =>
      this.availability.slots(tx, { tenantId: t.id, ...q, onlineOnly: true }),
    );
    return slots.map(({ staffId, staffName, startsAt, endsAt }) => ({ staffId, staffName, startsAt, endsAt }));
  }

  async book(slug: string, b: BookingInput, ip?: string) {
    const t = await this.resolve(slug);
    const start = new Date(b.startsAt);
    if (start.getTime() < Date.now() + 15 * 60_000) throw new BadRequestException("Geçmiş veya çok yakın bir saat seçilemez");
    if (start.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new BadRequestException("Seçilen tarih çok ileri");

    const result = await this.prisma
      .withTenant(this.ctx(t.id), async (tx) => {
        const service = await tx.service.findUnique({ where: { id: b.serviceId } });
        if (!service || !service.isActive || !service.onlineBookable) throw new NotFoundException("Hizmet bulunamadı");

        // Personel seçilmediyse o saatte uygun ilk personel atanır.
        const tz = t.timezone;
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
        const slots = await this.availability.slots(tx, { tenantId: t.id, date: localDate, serviceId: service.id, staffId: b.staffId, onlineOnly: true });
        const slot = slots.find((s) => s.startsAt === start.toISOString());
        if (!slot) throw new ConflictException("Seçilen saat artık müsait değil");

        let customer = await tx.customer.findUnique({ where: { tenantId_phone: { tenantId: t.id, phone: b.phone } } });
        if (customer?.anonymizedAt) customer = null;
        const isNew = !customer;
        if (!customer) {
          await assertUsageLimit(tx, t.id, "customer");
          customer = await tx.customer.create({
            data: {
              tenantId: t.id,
              firstName: b.firstName,
              lastName: b.lastName,
              phone: b.phone,
              email: b.email,
              source: "ONLINE",
              kvkkConsentAt: new Date(),
              marketingConsent: b.marketingConsent ?? false,
            },
          });
        }
        // Telefon mevcut bir müşteriyle eşleşse de formu dolduranın o kişi olduğu doğrulanamaz:
        // kayıttaki KVKK/izin bilgisi değiştirilmez; ad farklıysa resepsiyon teyit etsin diye nota yazılır.
        const norm = (v: string) => v.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
        const nameMismatch = !isNew && norm(`${b.firstName} ${b.lastName}`) !== norm(`${customer.firstName} ${customer.lastName}`);
        const notes = [
          nameMismatch ? `Online formdaki ad: ${b.firstName} ${b.lastName} (kayıttaki müşteri adından farklı; lütfen telefonla teyit edin)` : null,
          b.notes ?? null,
        ].filter(Boolean).join("\n") || undefined;

        const appt = await this.appointments.createInTx(tx, t.id, {
          customerId: customer.id,
          staffId: slot.staffId,
          serviceId: service.id,
          startsAt: slot.startsAt,
          notes,
          source: "ONLINE",
        });
        await this.audit.log(tx, { tenantId: t.id, action: "booking.online_created", entity: "Appointment", entityId: appt.id, ip });
        return { appt, service, staffName: slot.staffName };
      })
      .catch((e) => {
        // Paket sınırı ziyaretçiye ayrıntısıyla gösterilmez.
        if (e instanceof UsageLimitError) throw new ConflictException("Şu anda online randevu alınamıyor. Lütfen işletmeyle iletişime geçin.");
        return AppointmentsService.overlapGuard(e);
      });

    return {
      bookingId: result.appt.id,
      cancelToken: PublicBookingService.token(result.appt.id),
      salon: t.name,
      service: result.service.name,
      staff: result.staffName,
      startsAt: result.appt.startsAt,
      endsAt: result.appt.endsAt,
      price: result.appt.price,
    };
  }

  async cancel(slug: string, bookingId: string, token: string) {
    const t = await this.resolve(slug);
    const expected = Buffer.from(PublicBookingService.token(bookingId));
    const given = Buffer.from(token);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ForbiddenException("Geçersiz iptal bağlantısı");
    return this.prisma.withTenant(this.ctx(t.id), async (tx) => {
      const appt = await tx.appointment.findUnique({ where: { id: bookingId } });
      if (!appt) throw new NotFoundException("Randevu bulunamadı");
      if (!["BOOKED", "CONFIRMED"].includes(appt.status)) throw new ConflictException("Randevu iptal edilemez");
      if (appt.startsAt.getTime() - Date.now() < CANCEL_MIN_HOURS * 3_600_000) {
        throw new ConflictException(`Randevuya ${CANCEL_MIN_HOURS} saatten az kaldığı için lütfen işletmeyi arayın`);
      }
      const updated = await tx.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED", cancelReason: "Müşteri online iptal etti" } });
      await this.hooks.onStatusChanged(tx, updated);
      await this.audit.log(tx, { tenantId: t.id, action: "booking.online_cancelled", entity: "Appointment", entityId: appt.id });
      return { cancelled: true };
    });
  }
}
