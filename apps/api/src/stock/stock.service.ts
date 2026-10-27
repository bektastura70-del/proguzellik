import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, Prisma, ProductKind, StockMovementType } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface ProductInput {
  name: string;
  sku?: string;
  unit?: string;
  kind?: ProductKind;
  minQty?: number;
  costPrice?: number;
  salePrice?: number;
  isActive?: boolean;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private uniqueGuard(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException("Bu stok kodu kullanılıyor");
    throw e;
  }

  list(t: TenantInfo, q: { lowOnly?: boolean; kind?: ProductKind }) {
    return this.prisma.withTenant(t, async (tx) => {
      const items = await tx.product.findMany({
        where: { isActive: true, ...(q.kind ? { kind: q.kind } : {}) },
        orderBy: { name: "asc" },
      });
      return q.lowOnly ? items.filter((p) => D(p.stockQty).lessThanOrEqualTo(p.minQty)) : items;
    });
  }

  create(t: TenantInfo, b: ProductInput & { initialQty?: number }) {
    const { initialQty, ...data } = b;
    return this.prisma
      .withTenant(t, async (tx) => {
        const p = await tx.product.create({ data: { tenantId: t.tenantId, ...data } });
        if (initialQty) await StockService.move(tx, { tenantId: t.tenantId, productId: p.id, type: "IN", qty: initialQty, note: "Açılış stoku", createdById: t.userId });
        return tx.product.findUniqueOrThrow({ where: { id: p.id } });
      })
      .catch((e) => this.uniqueGuard(e));
  }

  update(t: TenantInfo, id: string, b: Partial<ProductInput>) {
    return this.prisma
      .withTenant(t, async (tx) => {
        if (!(await tx.product.findUnique({ where: { id } }))) throw new NotFoundException("Ürün bulunamadı");
        return tx.product.update({ where: { id }, data: b });
      })
      .catch((e) => this.uniqueGuard(e));
  }

  /**
   * Stok hareketi + bakiye güncellemesi (aynı transaction).
   * qty her zaman pozitif verilir; yön hareket tipinden gelir (ADJUST işaretlidir).
   */
  static async move(
    tx: Tx,
    m: { tenantId: string; productId: string; type: StockMovementType; qty: number | Prisma.Decimal; note?: string; appointmentId?: string; createdById?: string; allowNegative?: boolean },
  ) {
    const q = D(m.qty);
    const delta = m.type === "IN" || m.type === "ADJUST" ? q : q.negated();
    if (delta.isZero()) throw new BadRequestException("Miktar sıfır olamaz");
    if (delta.isNegative() && !m.allowNegative) {
      // Eşzamanlı çıkışlarda negatif stoğu engelleyen koşullu güncelleme.
      const res = await tx.product.updateMany({
        where: { id: m.productId, stockQty: { gte: delta.negated() } },
        data: { stockQty: { increment: delta } },
      });
      if (res.count === 0) {
        if (!(await tx.product.findUnique({ where: { id: m.productId } }))) throw new NotFoundException("Ürün bulunamadı");
        throw new ConflictException("Yetersiz stok");
      }
    } else {
      const res = await tx.product.updateMany({ where: { id: m.productId }, data: { stockQty: { increment: delta } } });
      if (res.count === 0) throw new NotFoundException("Ürün bulunamadı");
    }
    return tx.stockMovement.create({
      data: {
        tenantId: m.tenantId,
        productId: m.productId,
        type: m.type,
        qty: delta,
        note: m.note,
        appointmentId: m.appointmentId,
        createdById: m.createdById,
      },
    });
  }

  movement(t: TenantInfo, productId: string, b: { type: "IN" | "OUT" | "ADJUST"; qty: number; note?: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const mv = await StockService.move(tx, { tenantId: t.tenantId, productId, ...b, createdById: t.userId });
      return { movement: mv, product: await tx.product.findUniqueOrThrow({ where: { id: productId } }) };
    });
  }

  movements(t: TenantInfo, productId: string) {
    return this.prisma.withTenant(t, (tx) =>
      tx.stockMovement.findMany({ where: { productId }, orderBy: { createdAt: "desc" }, take: 200 }),
    );
  }

  /** Perakende ürün satışı: stok düşer, kasaya gelir yazılır. */
  sell(t: TenantInfo, b: { productId: string; qty: number; method: PaymentMethod; customerId?: string; unitPrice?: number }) {
    return this.prisma.withTenant(t, async (tx) => {
      const p = await tx.product.findUnique({ where: { id: b.productId } });
      if (!p || !p.isActive) throw new NotFoundException("Ürün bulunamadı");
      if (p.kind !== "RETAIL") throw new BadRequestException("Bu ürün satışa açık değil");
      if (b.customerId && !(await tx.customer.findUnique({ where: { id: b.customerId } }))) throw new NotFoundException("Müşteri bulunamadı");
      const unit = b.unitPrice ?? (p.salePrice ? Number(p.salePrice) : undefined);
      if (unit === undefined) throw new BadRequestException("Satış fiyatı tanımlı değil");
      await StockService.move(tx, { tenantId: t.tenantId, productId: p.id, type: "SALE", qty: b.qty, createdById: t.userId, note: "Satış" });
      const trx = await tx.financeTransaction.create({
        data: {
          tenantId: t.tenantId,
          type: "INCOME",
          category: "URUN_SATISI",
          amount: D(unit).times(b.qty).toDecimalPlaces(2),
          method: b.method,
          customerId: b.customerId,
          description: `${p.name} × ${b.qty}`,
          createdById: t.userId,
        },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "stock.sold", entity: "Product", entityId: p.id });
      return trx;
    });
  }

  setConsumables(t: TenantInfo, serviceId: string, items: { productId: string; qty: number }[]) {
    return this.prisma.withTenant(t, async (tx) => {
      if (!(await tx.service.findUnique({ where: { id: serviceId } }))) throw new NotFoundException("Hizmet bulunamadı");
      const ids = [...new Set(items.map((i) => i.productId))];
      if ((await tx.product.count({ where: { id: { in: ids } } })) !== ids.length) throw new NotFoundException("Ürün bulunamadı");
      await tx.serviceConsumable.deleteMany({ where: { serviceId } });
      await tx.serviceConsumable.createMany({ data: items.map((i) => ({ tenantId: t.tenantId, serviceId, ...i })) });
      return tx.serviceConsumable.findMany({ where: { serviceId }, include: { product: { select: { name: true, unit: true } } } });
    });
  }

  getConsumables(t: TenantInfo, serviceId: string) {
    return this.prisma.withTenant(t, (tx) =>
      tx.serviceConsumable.findMany({ where: { serviceId }, include: { product: { select: { name: true, unit: true } } } }),
    );
  }

  /** Randevu tamamlanınca hizmetin sarf malzemeleri otomatik düşülür (eksiye düşebilir, raporda uyarı verir). */
  static async consumeForAppointment(tx: Tx, appt: { id: string; tenantId: string; serviceId: string }, actorId?: string) {
    const items = await tx.serviceConsumable.findMany({ where: { serviceId: appt.serviceId } });
    for (const i of items) {
      await StockService.move(tx, {
        tenantId: appt.tenantId,
        productId: i.productId,
        type: "CONSUME",
        qty: i.qty,
        appointmentId: appt.id,
        createdById: actorId,
        note: "Hizmet sarfı",
        allowNegative: true,
      });
    }
  }
}
