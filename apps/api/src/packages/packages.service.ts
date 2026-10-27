import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTemplates(t: TenantInfo) {
    return this.prisma.withTenant(t, (tx) =>
      tx.packageTemplate.findMany({ orderBy: { name: "asc" }, include: { service: { select: { id: true, name: true } } } }),
    );
  }

  createTemplate(t: TenantInfo, b: { name: string; serviceId: string; sessionCount: number; price: number; validityDays?: number }) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.service.findUnique({ where: { id: b.serviceId } }))) throw new NotFoundException("Hizmet bulunamadı");
      return tx.packageTemplate.create({ data: { tenantId: t.tenantId, ...b } });
    });
  }

  updateTemplate(t: TenantInfo, id: string, b: { name?: string; price?: number; isActive?: boolean; validityDays?: number | null }) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.packageTemplate.findUnique({ where: { id } }))) throw new NotFoundException("Paket bulunamadı");
      return tx.packageTemplate.update({ where: { id }, data: b });
    });
  }

  /** Müşteriye paket satışı; istenirse aynı işlemde tahsilat kaydı oluşturur. */
  sell(
    t: TenantInfo,
    b: { customerId: string; templateId: string; price?: number; payment?: { amount: number; method: PaymentMethod } },
  ) {
    return this.prisma.withTenant(t, async (tx) => {
      const [customer, tpl] = await Promise.all([
        tx.customer.findUnique({ where: { id: b.customerId } }),
        tx.packageTemplate.findUnique({ where: { id: b.templateId } }),
      ]);
      if (!customer || customer.anonymizedAt) throw new NotFoundException("Müşteri bulunamadı");
      if (!tpl || !tpl.isActive) throw new NotFoundException("Paket bulunamadı");
      const price = b.price ?? Number(tpl.price);
      if (b.payment && b.payment.amount > price) throw new BadRequestException("Tahsilat paket tutarını aşamaz");
      const pkg = await tx.customerPackage.create({
        data: {
          tenantId: t.tenantId,
          customerId: customer.id,
          templateId: tpl.id,
          serviceId: tpl.serviceId,
          name: tpl.name,
          totalSessions: tpl.sessionCount,
          price,
          expiresAt: tpl.validityDays ? new Date(Date.now() + tpl.validityDays * 86_400_000) : null,
          createdById: t.userId,
        },
      });
      if (b.payment && b.payment.amount > 0) {
        await tx.financeTransaction.create({
          data: {
            tenantId: t.tenantId,
            type: "INCOME",
            category: "PAKET_SATISI",
            amount: b.payment.amount,
            method: b.payment.method,
            customerId: customer.id,
            customerPackageId: pkg.id,
            createdById: t.userId,
            description: `${tpl.name} paket satışı`,
          },
        });
      }
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "package.sold", entity: "CustomerPackage", entityId: pkg.id });
      return pkg;
    });
  }

  listForCustomer(t: TenantInfo, customerId: string) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.expireOld(tx);
      return tx.customerPackage.findMany({
        where: { customerId },
        orderBy: { purchasedAt: "desc" },
        include: { usages: { orderBy: { usedAt: "desc" } } },
      });
    });
  }

  cancel(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const pkg = await tx.customerPackage.findUnique({ where: { id } });
      if (!pkg) throw new NotFoundException("Paket bulunamadı");
      if (pkg.status !== "ACTIVE") throw new ConflictException("Paket aktif değil");
      const upcoming = await tx.appointment.count({ where: { customerPackageId: id, status: { in: ["BOOKED", "CONFIRMED"] } } });
      if (upcoming > 0) throw new ConflictException("Pakete bağlı bekleyen randevular var");
      return tx.customerPackage.update({ where: { id }, data: { status: "CANCELLED" } });
    });
  }

  private expireOld(tx: Tx) {
    return tx.customerPackage.updateMany({
      where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
  }

  /** Randevu oluştururken paket uygunluğu: müşteri, hizmet, süre ve kalan seans. */
  static async assertBookable(tx: Tx, pkgId: string, customerId: string, serviceId: string) {
    const pkg = await tx.customerPackage.findUnique({ where: { id: pkgId } });
    if (!pkg || pkg.customerId !== customerId) throw new NotFoundException("Paket bulunamadı");
    if (pkg.serviceId !== serviceId) throw new BadRequestException("Paket bu hizmet için geçerli değil");
    if (pkg.status !== "ACTIVE" || (pkg.expiresAt && pkg.expiresAt < new Date())) {
      throw new ConflictException("Paket aktif değil veya süresi dolmuş");
    }
    const reserved = await tx.appointment.count({ where: { customerPackageId: pkgId, status: { in: ["BOOKED", "CONFIRMED"] } } });
    if (pkg.usedSessions + reserved >= pkg.totalSessions) throw new ConflictException("Pakette kalan seans yok");
  }

  /** Randevu tamamlanınca seans düşülür (aynı transaction içinde). */
  static async consumeSession(tx: Tx, appt: { id: string; tenantId: string; customerPackageId: string | null; staffId: string }) {
    if (!appt.customerPackageId) return;
    const res = await tx.customerPackage.updateMany({
      where: { id: appt.customerPackageId, status: "ACTIVE" },
      data: { usedSessions: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictException("Paket aktif değil");
    await tx.sessionUsage.create({
      data: { tenantId: appt.tenantId, customerPackageId: appt.customerPackageId, appointmentId: appt.id, staffId: appt.staffId },
    });
    const pkg = await tx.customerPackage.findUniqueOrThrow({ where: { id: appt.customerPackageId } });
    if (pkg.usedSessions >= pkg.totalSessions) {
      await tx.customerPackage.update({ where: { id: pkg.id }, data: { status: "COMPLETED" } });
    }
  }
}
