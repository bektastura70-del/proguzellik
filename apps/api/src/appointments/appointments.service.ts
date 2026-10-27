import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppointmentStatus, BookingSource, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { addMinutes } from "../common/time";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { PackagesService } from "../packages/packages.service";
import { StockService } from "../stock/stock.service";
import { AvailabilityService } from "./availability.service";

export interface AppointmentInput {
  customerId: string;
  staffId: string;
  serviceId: string;
  startsAt: string;
  notes?: string;
  price?: number;
  ignoreSchedule?: boolean;
  customerPackageId?: string;
}

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Randevu yaşam döngüsü olayları (bildirim, stok düşümü vb. modüller dinler). */
export abstract class AppointmentHooks {
  abstract onCreated(tx: Tx, appt: { id: string; tenantId: string }): Promise<void>;
  abstract onStatusChanged(tx: Tx, appt: { id: string; tenantId: string; status: AppointmentStatus }, actorId?: string): Promise<void>;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly hooks: AppointmentHooks,
  ) {}

  static overlapGuard(e: unknown): never {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("appointment_no_overlap") || msg.includes("23P01")) {
      throw new ConflictException("Bu saatte personelin başka bir randevusu var");
    }
    throw e;
  }

  list(t: TenantInfo, q: { from: string; to: string; staffId?: string; customerId?: string }) {
    return this.prisma.withTenant(t, (tx) =>
      tx.appointment.findMany({
        where: {
          startsAt: { lt: new Date(q.to) },
          endsAt: { gt: new Date(q.from) },
          ...(q.staffId ? { staffId: q.staffId } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
        },
        orderBy: { startsAt: "asc" },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
          staff: { select: { id: true, displayName: true, color: true } },
          service: { select: { id: true, name: true, durationMin: true, color: true } },
        },
      }),
    );
  }

  /** Panel ve online rezervasyonun ortak oluşturma mantığı (transaction içinde). */
  async createInTx(
    tx: Tx,
    tenantId: string,
    input: AppointmentInput & { source?: BookingSource; createdById?: string },
  ) {
    const [customer, service, staff] = await Promise.all([
      tx.customer.findUnique({ where: { id: input.customerId } }),
      tx.service.findUnique({ where: { id: input.serviceId } }),
      tx.staffMember.findUnique({ where: { id: input.staffId } }),
    ]);
    if (!customer || customer.anonymizedAt) throw new NotFoundException("Müşteri bulunamadı");
    if (!service || !service.isActive) throw new NotFoundException("Hizmet bulunamadı");
    if (!staff || !staff.isActive) throw new NotFoundException("Personel bulunamadı");
    const can = await tx.staffService.findUnique({
      where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } },
    });
    if (!can) throw new BadRequestException("Personel bu hizmeti vermiyor");
    if (input.customerPackageId) {
      await PackagesService.assertBookable(tx, input.customerPackageId, customer.id, service.id);
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = addMinutes(startsAt, service.durationMin);
    if (!input.ignoreSchedule) await this.availability.assertWithinSchedule(tx, tenantId, staff.id, startsAt, endsAt);

    const appt = await tx.appointment.create({
      data: {
        tenantId,
        customerId: customer.id,
        staffId: staff.id,
        serviceId: service.id,
        startsAt,
        endsAt,
        price: input.customerPackageId ? 0 : (input.price ?? service.price),
        customerPackageId: input.customerPackageId,
        notes: input.notes,
        source: input.source ?? "PANEL",
        createdById: input.createdById,
      },
    });
    await this.hooks.onCreated(tx, appt);
    return appt;
  }

  async create(t: TenantInfo, input: AppointmentInput) {
    if (input.ignoreSchedule && !["OWNER", "MANAGER"].includes(t.role)) {
      throw new ForbiddenException("Çalışma saati dışı randevu için yetkiniz yok");
    }
    return this.prisma
      .withTenant(t, async (tx) => {
        const appt = await this.createInTx(tx, t.tenantId, { ...input, createdById: t.userId });
        await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "appointment.created", entity: "Appointment", entityId: appt.id });
        return appt;
      })
      .catch(AppointmentsService.overlapGuard);
  }

  async reschedule(t: TenantInfo, id: string, input: { startsAt?: string; staffId?: string; notes?: string; ignoreSchedule?: boolean }) {
    if (input.ignoreSchedule && !["OWNER", "MANAGER"].includes(t.role)) {
      throw new ForbiddenException("Çalışma saati dışı randevu için yetkiniz yok");
    }
    return this.prisma
      .withTenant(t, async (tx) => {
        const appt = await tx.appointment.findUnique({ where: { id }, include: { service: true } });
        if (!appt) throw new NotFoundException("Randevu bulunamadı");
        if (!["BOOKED", "CONFIRMED"].includes(appt.status)) throw new ConflictException("Bu randevu değiştirilemez");
        const staffId = input.staffId ?? appt.staffId;
        if (input.staffId) {
          const can = await tx.staffService.findUnique({ where: { staffId_serviceId: { staffId, serviceId: appt.serviceId } } });
          if (!can) throw new BadRequestException("Personel bu hizmeti vermiyor");
        }
        const startsAt = input.startsAt ? new Date(input.startsAt) : appt.startsAt;
        const endsAt = addMinutes(startsAt, appt.service.durationMin);
        if (!input.ignoreSchedule && (input.startsAt || input.staffId)) {
          await this.availability.assertWithinSchedule(tx, t.tenantId, staffId, startsAt, endsAt);
        }
        return tx.appointment.update({ where: { id }, data: { staffId, startsAt, endsAt, notes: input.notes ?? appt.notes } });
      })
      .catch(AppointmentsService.overlapGuard);
  }

  setStatus(t: TenantInfo, id: string, status: AppointmentStatus, reason?: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const appt = await tx.appointment.findUnique({ where: { id }, include: { staff: true } });
      if (!appt) throw new NotFoundException("Randevu bulunamadı");
      if (t.role === "STAFF" && appt.staff.userId !== t.userId) {
        throw new ForbiddenException("Yalnızca kendi randevularınızı güncelleyebilirsiniz");
      }
      if (!TRANSITIONS[appt.status].includes(status)) {
        throw new ConflictException(`Durum ${appt.status} → ${status} olarak değiştirilemez`);
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: { status, ...(status === "CANCELLED" ? { cancelReason: reason } : {}) },
      });
      if (status === "COMPLETED") {
        await PackagesService.consumeSession(tx, updated);
        await StockService.consumeForAppointment(tx, updated, t.userId);
      }
      await this.hooks.onStatusChanged(tx, updated, t.userId);
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: `appointment.${status.toLowerCase()}`,
        entity: "Appointment",
        entityId: id,
      });
      return updated;
    });
  }

  availabilityFor(t: TenantInfo, q: { date: string; serviceId: string; staffId?: string }) {
    return this.prisma.withTenant(t, (tx) => this.availability.slots(tx, { tenantId: t.tenantId, ...q }));
  }
}

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: { service: true } }>;
