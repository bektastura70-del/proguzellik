import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface StaffInput {
  displayName: string;
  title?: string;
  phone?: string;
  color?: string;
  commissionRate?: number;
  isActive?: boolean;
  onlineBookable?: boolean;
  userId?: string | null;
}

/** Personel sayısı sınırı kontrolü için kanca (abonelik modülü sağlar). */
export abstract class StaffLimitPolicy {
  abstract assertCanAddStaff(tx: Tx, tenantId: string): Promise<void>;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: StaffLimitPolicy,
  ) {}

  list(t: TenantInfo, includeInactive: boolean) {
    return this.prisma.withTenant(t, (tx) =>
      tx.staffMember.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: { displayName: "asc" },
        include: {
          services: { select: { serviceId: true } },
          workingHours: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] },
        },
      }),
    );
  }

  private async find(tx: Tx, id: string) {
    const s = await tx.staffMember.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Personel bulunamadı");
    return s;
  }

  private async assertMember(tx: Tx, userId: string | null | undefined) {
    if (!userId) return;
    const m = await tx.membership.findFirst({ where: { userId } });
    if (!m) throw new BadRequestException("Kullanıcı bu işletmenin ekibinde değil");
  }

  create(t: TenantInfo, input: StaffInput) {
    return this.prisma.withTenant(t, async (tx) => {
      if (input.isActive !== false) await this.limits.assertCanAddStaff(tx, t.tenantId);
      await this.assertMember(tx, input.userId);
      return tx.staffMember.create({ data: { tenantId: t.tenantId, ...input } });
    });
  }

  update(t: TenantInfo, id: string, input: Partial<StaffInput>) {
    return this.prisma.withTenant(t, async (tx) => {
      const s = await this.find(tx, id);
      if (input.isActive === true && !s.isActive) await this.limits.assertCanAddStaff(tx, t.tenantId);
      if (input.isActive === false && s.isActive) {
        const upcoming = await tx.appointment.count({
          where: { staffId: id, status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: new Date() } },
        });
        if (upcoming > 0) {
          throw new ConflictException(`Personelin ${upcoming} bekleyen randevusu var. Önce başka personele aktarın veya iptal edin.`);
        }
      }
      await this.assertMember(tx, input.userId);
      return tx.staffMember.update({ where: { id }, data: input });
    });
  }

  setServices(t: TenantInfo, id: string, serviceIds: string[]) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.find(tx, id);
      const found = await tx.service.count({ where: { id: { in: serviceIds } } });
      if (found !== new Set(serviceIds).size) throw new NotFoundException("Hizmet bulunamadı");
      await tx.staffService.deleteMany({ where: { staffId: id } });
      await tx.staffService.createMany({
        data: [...new Set(serviceIds)].map((serviceId) => ({ tenantId: t.tenantId, staffId: id, serviceId })),
      });
      return { staffId: id, serviceIds };
    });
  }

  setWorkingHours(t: TenantInfo, id: string, hours: { weekday: number; startMin: number; endMin: number }[]) {
    const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].startMin < sorted[i - 1].endMin) {
        throw new BadRequestException("Çalışma saatleri çakışıyor");
      }
    }
    return this.prisma.withTenant(t, async (tx) => {
      await this.find(tx, id);
      await tx.workingHour.deleteMany({ where: { staffId: id } });
      await tx.workingHour.createMany({ data: sorted.map((h) => ({ tenantId: t.tenantId, staffId: id, ...h })) });
      return tx.workingHour.findMany({ where: { staffId: id }, orderBy: [{ weekday: "asc" }, { startMin: "asc" }] });
    });
  }

  addTimeOff(t: TenantInfo, id: string, input: { startsAt: string; endsAt: string; reason?: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.find(tx, id);
      return tx.timeOff.create({
        data: { tenantId: t.tenantId, staffId: id, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason },
      });
    });
  }

  timeOffRange(t: TenantInfo, from: string, to: string) {
    return this.prisma.withTenant(t, (tx) =>
      tx.timeOff.findMany({
        where: { startsAt: { lt: new Date(to) }, endsAt: { gt: new Date(from) } },
        orderBy: { startsAt: "asc" },
        include: { staff: { select: { id: true, displayName: true } } },
      }),
    );
  }

  listTimeOff(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, (tx) => tx.timeOff.findMany({ where: { staffId: id }, orderBy: { startsAt: "asc" } }));
  }

  removeTimeOff(t: TenantInfo, id: string, timeOffId: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const r = await tx.timeOff.deleteMany({ where: { id: timeOffId, staffId: id } });
      if (r.count === 0) throw new NotFoundException("İzin kaydı bulunamadı");
      return { deleted: true };
    });
  }
}
