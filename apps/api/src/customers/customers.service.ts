import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { assertUsageLimit } from "../billing/plan-pricing";
import { FinanceService } from "../finance/finance.service";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface CustomerInput {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  gender?: string;
  notes?: string;
  tags?: string[];
  source?: string;
  kvkkConsent?: boolean;
  marketingConsent?: boolean;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toData(input: Partial<CustomerInput>) {
    const { kvkkConsent, birthDate, ...rest } = input;
    return {
      ...rest,
      ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate) : null } : {}),
      ...(kvkkConsent ? { kvkkConsentAt: new Date() } : {}),
    };
  }

  private uniqueGuard(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictException("Bu telefon numarası ile kayıtlı müşteri var");
    }
    throw e;
  }

  async list(t: TenantInfo, q: { search?: string; page: number; pageSize: number; tag?: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const where: Prisma.CustomerWhereInput = { anonymizedAt: null, ...CustomersService.staffScope(t) };
      if (q.search) {
        const s = q.search.trim();
        where.OR = [
          { firstName: { contains: s, mode: "insensitive" } },
          { lastName: { contains: s, mode: "insensitive" } },
          { phone: { contains: s.replace(/\s/g, "") } },
          { email: { contains: s, mode: "insensitive" } },
        ];
      }
      if (q.tag) where.tags = { has: q.tag };
      const [items, total] = await Promise.all([
        tx.customer.findMany({
          where,
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.customer.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /**
   * Personel (STAFF) yalnız kendisine randevusu olan (geçmiş veya gelecek) müşterileri görür.
   * Diğer roller tüm müşterileri görür.
   */
  static staffScope(t: TenantInfo): Prisma.CustomerWhereInput {
    return t.role === "STAFF" ? { appointments: { some: { staff: { userId: t.userId } } } } : {};
  }

  /** Personel kendi müşterisi olmayan kaydı açamaz (varlığı da belli edilmez). */
  private async findVisible(tx: Tx, t: TenantInfo, id: string) {
    const c = await tx.customer.findFirst({ where: { id, ...CustomersService.staffScope(t) } });
    if (!c) throw new NotFoundException("Müşteri bulunamadı");
    return c;
  }

  async get(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, (tx) => this.findVisible(tx, t, id));
  }

  async find(tx: Tx, id: string) {
    const c = await tx.customer.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Müşteri bulunamadı");
    return c;
  }

  create(t: TenantInfo, input: CustomerInput) {
    return this.prisma
      .withTenant(t, async (tx) => {
        await assertUsageLimit(tx, t.tenantId, "customer");
        const c = await tx.customer.create({ data: { tenantId: t.tenantId, ...this.toData(input), firstName: input.firstName, lastName: input.lastName },
        });
        await this.audit.log(tx, {
          tenantId: t.tenantId,
          actorId: t.userId,
          action: "customer.created",
          entity: "Customer",
          entityId: c.id,
        });
        return c;
      })
      .catch((e) => this.uniqueGuard(e));
  }

  update(t: TenantInfo, id: string, input: Partial<CustomerInput>) {
    return this.prisma
      .withTenant(t, async (tx) => {
        const c = await this.find(tx, id);
        if (c.anonymizedAt) throw new ConflictException("Anonimleştirilmiş müşteri düzenlenemez");
        return tx.customer.update({ where: { id }, data: this.toData(input) });
      })
      .catch((e) => this.uniqueGuard(e));
  }

  addNote(t: TenantInfo, id: string, body: string) {
    return this.prisma.withTenant(t, async (tx) => {
      await this.findVisible(tx, t, id);
      return tx.customerNote.create({
        data: { tenantId: t.tenantId, customerId: id, authorId: t.userId, body },
      });
    });
  }

  /** Müşteri geçmişi: notlar, randevular, paketler ve ödemeler. */
  history(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const customer = await this.findVisible(tx, t, id);
      const notes = await tx.customerNote.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
      });
      const extra = await this.historyExtras(tx, id);
      return { customer, notes, ...extra };
    });
  }

  private async historyExtras(tx: Tx, id: string) {
    const [appointments, packages, transactions] = await Promise.all([
      tx.appointment.findMany({
        where: { customerId: id },
        orderBy: { startsAt: "desc" },
        include: {
          service: { select: { id: true, name: true } },
          staff: { select: { id: true, displayName: true } },
        },
      }),
      tx.customerPackage.findMany({ where: { customerId: id }, orderBy: { purchasedAt: "desc" } }),
      tx.financeTransaction.findMany({ where: { customerId: id }, orderBy: { occurredAt: "desc" } }),
    ]);
    const balance = await FinanceService.balanceInTx(tx, id);
    return { appointments, packages, transactions, balance };
  }

  /** KVKK m.11: kişisel verilerin bir kopyası (JSON). */
  exportData(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const customer = await this.find(tx, id);
      const notes = await tx.customerNote.findMany({ where: { customerId: id } });
      const extra = await this.historyExtras(tx, id);
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "customer.exported",
        entity: "Customer",
        entityId: id,
      });
      return { exportedAt: new Date().toISOString(), customer, notes, ...extra };
    });
  }

  /**
   * KVKK m.7: silme/anonimleştirme. Mali kayıtlar yasal saklama süresi için korunur,
   * kişiyi tanımlayan alanlar geri döndürülemez şekilde silinir.
   */
  anonymize(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, async (tx) => {
      const c = await this.find(tx, id);
      if (c.anonymizedAt) return c;
      // Bekleyen randevular iptal edilir; planlı bildirimler gönderilmez.
      const upcoming = await tx.appointment.findMany({
        where: { customerId: id, status: { in: ["BOOKED", "CONFIRMED"] } },
        select: { id: true },
      });
      if (upcoming.length) {
        const ids = upcoming.map((a) => a.id);
        await tx.appointment.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED", cancelReason: "KVKK silme talebi" } });
        await tx.notification.updateMany({ where: { appointmentId: { in: ids }, status: "QUEUED" }, data: { status: "SKIPPED" } });
      }
      await tx.notification.updateMany({ where: { recipient: c.phone ?? "__none__", status: "QUEUED" }, data: { status: "SKIPPED" } });
      await tx.customerNote.deleteMany({ where: { customerId: id } });
      const updated = await tx.customer.update({
        where: { id },
        data: {
          firstName: "Anonim",
          lastName: "Müşteri",
          phone: null,
          email: null,
          birthDate: null,
          gender: null,
          notes: null,
          tags: [],
          marketingConsent: false,
          anonymizedAt: new Date(),
        },
      });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "customer.anonymized",
        entity: "Customer",
        entityId: id,
      });
      return updated;
    });
  }
}
