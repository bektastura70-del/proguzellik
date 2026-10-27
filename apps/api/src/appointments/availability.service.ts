import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { addMinutes, toZoned, weekdayOf, zonedTime } from "../common/time";
import { Tx } from "../prisma/prisma.service";

export interface Slot {
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
}

const ACTIVE = ["BOOKED", "CONFIRMED", "COMPLETED"] as const;
export const SLOT_STEP_MIN = 15;

/** Personelin çalışma saatleri, izinleri ve mevcut randevularına göre boş zaman dilimleri. */
@Injectable()
export class AvailabilityService {
  async slots(
    tx: Tx,
    opts: { tenantId: string; date: string; serviceId: string; staffId?: string; onlineOnly?: boolean; now?: Date },
  ): Promise<Slot[]> {
    const tenant = await tx.tenant.findUnique({ where: { id: opts.tenantId }, select: { timezone: true } });
    if (!tenant) throw new NotFoundException("İşletme bulunamadı");
    const service = await tx.service.findUnique({ where: { id: opts.serviceId } });
    if (!service || !service.isActive || (opts.onlineOnly && !service.onlineBookable)) {
      throw new NotFoundException("Hizmet bulunamadı");
    }
    const tz = tenant.timezone;
    const dayStart = zonedTime(opts.date, 0, tz);
    const dayEnd = zonedTime(opts.date, 1440, tz);
    const weekday = weekdayOf(opts.date);

    const staff = await tx.staffMember.findMany({
      where: {
        isActive: true,
        ...(opts.onlineOnly ? { onlineBookable: true } : {}),
        ...(opts.staffId ? { id: opts.staffId } : {}),
        services: { some: { serviceId: service.id } },
      },
      include: {
        workingHours: { where: { weekday } },
        timeOff: { where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } } },
        appointments: {
          where: { status: { in: [...ACTIVE] }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
          select: { startsAt: true, endsAt: true },
        },
      },
      orderBy: { displayName: "asc" },
    });

    const now = opts.now ?? new Date();
    const out: Slot[] = [];
    for (const s of staff) {
      const busy = [...s.timeOff, ...s.appointments];
      for (const wh of s.workingHours) {
        for (let m = wh.startMin; m + service.durationMin <= wh.endMin; m += SLOT_STEP_MIN) {
          const start = zonedTime(opts.date, m, tz);
          const end = addMinutes(start, service.durationMin);
          if (start <= now) continue;
          if (busy.some((b) => b.startsAt < end && b.endsAt > start)) continue;
          out.push({ staffId: s.id, staffName: s.displayName, startsAt: start.toISOString(), endsAt: end.toISOString() });
        }
      }
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /** Verilen zaman personelin çalışma saatleri içinde ve izin dışında mı? */
  async assertWithinSchedule(tx: Tx, tenantId: string, staffId: string, start: Date, end: Date) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    const zs = toZoned(start, tenant.timezone);
    const ze = toZoned(end, tenant.timezone);
    const endMin = ze.date === zs.date ? ze.minutes : 1440;
    if (ze.date !== zs.date && ze.minutes !== 0) throw new BadRequestException("Randevu gün sonunu aşamaz");
    const hours = await tx.workingHour.findMany({ where: { staffId, weekday: zs.weekday } });
    if (!hours.some((h) => h.startMin <= zs.minutes && endMin <= h.endMin)) {
      throw new BadRequestException("Personel bu saatte çalışmıyor");
    }
    const off = await tx.timeOff.count({ where: { staffId, startsAt: { lt: end }, endsAt: { gt: start } } });
    if (off > 0) throw new BadRequestException("Personel bu saatte izinli");
  }
}
