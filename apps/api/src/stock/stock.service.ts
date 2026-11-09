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
  vatRate?: number | null;
  isActive?: boolean;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

export interface SaleInput {
  items: { productId: string; qty: number; unitPrice?: number }[];
  method: PaymentMethod;
  customerId?: string;
  staffId?: string;
  note?: string;
}

/** KDV dahil tutarın içindeki KDV: tutar × oran / (100 + oran) */
export const vatOf = (gross: Prisma.Decimal, rate: Prisma.Decimal | null) =>
  rate === null || rate.isZero() ? D(0) : gross.times(rate).div(D(100).plus(rate)).toDecimalPlaces(2);

export type LowStockItem = { id: string; name: string; stockQty: string; minQty: string; unit: string };

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
    m: { tenantId: string; productId: string; type: StockMovementType; qty: number | Prisma.Decimal; note?: string; appointmentId?: string; productSaleId?: string; createdById?: string; allowNegative?: boolean },
  ) {
    const q = D(m.qty);
    const delta = m.type === "IN" || m.type === "RETURN" || m.type === "ADJUST" ? q : q.negated();
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
        productSaleId: m.productSaleId,
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

  /**
   * Perakende ürün satışı (satış fişi): birden çok satır, satan personel.
   * Her satırın stoğu düşer, kasaya tek "URUN_SATISI" geliri yazılır.
   */
  sell(t: TenantInfo, b: SaleInput) {
    return this.prisma.withTenant(t, async (tx) => {
      const r = await this.sellInTx(tx, t, b);
      // Eski istemcilerle uyum: yanıtın kökü kasa kaydıdır.
      return { ...r.transaction, saleId: r.sale.id, sale: r.sale, lowStock: r.lowStock };
    });
  }

  /** Satış fişini verilen transaction içinde yazar (randevu tahsilatı da kullanır). */
  async sellInTx(tx: Tx, t: TenantInfo, b: SaleInput & { appointmentId?: string }) {
    if (!b.items.length) throw new BadRequestException("Satışta en az bir ürün olmalı");
    if (b.customerId && !(await tx.customer.findUnique({ where: { id: b.customerId } }))) throw new NotFoundException("Müşteri bulunamadı");
    if (b.staffId) {
      const st = await tx.staffMember.findUnique({ where: { id: b.staffId } });
      if (!st || !st.isActive) throw new NotFoundException("Personel bulunamadı");
    }
    const ids = [...new Set(b.items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    const lines = b.items.map((i) => {
      const p = products.find((x) => x.id === i.productId);
      if (!p || !p.isActive) throw new NotFoundException("Ürün bulunamadı");
      if (p.kind !== "RETAIL") throw new BadRequestException(`${p.name} satışa açık değil`);
      const unit = i.unitPrice ?? (p.salePrice !== null ? Number(p.salePrice) : undefined);
      if (unit === undefined) throw new BadRequestException(`${p.name} için satış fiyatı tanımlı değil`);
      const lineTotal = D(unit).times(i.qty).toDecimalPlaces(2);
      return { p, qty: D(i.qty), unitPrice: D(unit).toDecimalPlaces(2), lineTotal, vatRate: p.vatRate, vatAmount: vatOf(lineTotal, p.vatRate) };
    });
    const total = lines.reduce((s, l) => s.plus(l.lineTotal), D(0));
    const vatTotal = lines.reduce((s, l) => s.plus(l.vatAmount), D(0));
    const description = lines.map((l) => `${l.p.name} × ${l.qty.toString()}`).join(", ").slice(0, 300);
    const trx = await tx.financeTransaction.create({
      data: {
        tenantId: t.tenantId,
        type: "INCOME",
        category: "URUN_SATISI",
        amount: total,
        method: b.method,
        customerId: b.customerId,
        staffId: b.staffId,
        description,
        createdById: t.userId,
      },
    });
    const sale = await tx.productSale.create({
      data: {
        tenantId: t.tenantId,
        customerId: b.customerId,
        staffId: b.staffId,
        appointmentId: b.appointmentId,
        financeTransactionId: trx.id,
        method: b.method,
        total,
        vatTotal,
        note: b.note,
        createdById: t.userId,
      },
    });
    for (const l of lines) {
      await tx.productSaleItem.create({
        data: {
          tenantId: t.tenantId, saleId: sale.id, productId: l.p.id, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.p.costPrice,
          lineTotal: l.lineTotal, vatRate: l.vatRate, vatAmount: l.vatAmount,
        },
      });
      await StockService.move(tx, { tenantId: t.tenantId, productId: l.p.id, type: "SALE", qty: l.qty, createdById: t.userId, note: "Satış", productSaleId: sale.id });
    }
    await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "stock.sold", entity: "ProductSale", entityId: sale.id, metadata: { total: money(total), items: lines.length } });
    // Bu satışla kritik seviyeye düşen ya da altında kalan ürünler (anında uyarı için)
    const after = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, stockQty: true, minQty: true, unit: true } });
    const lowStock: LowStockItem[] = after
      .filter((p) => D(p.minQty).greaterThan(0) && D(p.stockQty).lessThanOrEqualTo(p.minQty))
      .map((p) => ({ id: p.id, name: p.name, stockQty: p.stockQty.toString(), minQty: p.minQty.toString(), unit: p.unit }));
    return { transaction: trx, sale: await StockService.saleDetail(tx, sale.id), lowStock };
  }

  /**
   * Randevu tahsilatı: hizmet bedeli ve yanında satılan ürünler tek işlemde kaydedilir.
   * Hizmet tahsilatı kasaya "HIZMET", ürünler ayrı bir satış fişi olarak "URUN_SATISI" yazılır
   * (ürün primi randevunun personeline ya da seçilen personele gider).
   */
  checkoutAppointment(
    t: TenantInfo,
    appointmentId: string,
    b: { serviceAmount?: number; method: PaymentMethod; items: SaleInput["items"]; productStaffId?: string; description?: string },
  ) {
    return this.prisma.withTenant(t, async (tx) => {
      const appt = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appt) throw new NotFoundException("Randevu bulunamadı");
      if (appt.status !== "COMPLETED") throw new ConflictException("Tahsilat yalnızca tamamlanan randevu için alınır");
      if (!b.serviceAmount && !b.items.length) throw new BadRequestException("Tahsil edilecek tutar ya da ürün yok");
      let service = null;
      if (b.serviceAmount) {
        service = await tx.financeTransaction.create({
          data: {
            tenantId: t.tenantId, type: "INCOME", category: "HIZMET", amount: b.serviceAmount, method: b.method,
            customerId: appt.customerId, appointmentId: appt.id, staffId: appt.staffId, description: b.description, createdById: t.userId,
          },
        });
        await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "finance.collected", entity: "FinanceTransaction", entityId: service.id });
      }
      const products = b.items.length
        ? await this.sellInTx(tx, t, { items: b.items, method: b.method, customerId: appt.customerId, staffId: b.productStaffId ?? appt.staffId, appointmentId: appt.id })
        : null;
      return {
        service,
        sale: products?.sale ?? null,
        lowStock: products?.lowStock ?? [],
        total: money(D(service?.amount).plus(D(products?.sale.total))),
      };
    });
  }

  static async saleDetail(tx: Tx, id: string) {
    const sale = await tx.productSale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        staff: { select: { id: true, displayName: true } },
        items: { include: { product: { select: { name: true, unit: true } }, returns: { select: { qty: true, amount: true } } } },
        returns: { orderBy: { createdAt: "asc" }, select: { id: true, amount: true, reason: true, createdAt: true } },
      },
    });
    if (!sale) throw new NotFoundException("Satış bulunamadı");
    const items = sale.items.map(({ returns, ...i }) => {
      const returnedQty = returns.reduce((s, r) => s.plus(r.qty), D(0));
      const returnedAmount = returns.reduce((s, r) => s.plus(r.amount), D(0));
      return { ...i, returnedQty: returnedQty.toString(), returnedAmount: money(returnedAmount), returnableQty: D(i.qty).minus(returnedQty).toString() };
    });
    const returnedTotal = sale.returns.reduce((s, r) => s.plus(r.amount), D(0));
    return { ...sale, items, returnedTotal: money(returnedTotal), netTotal: money(D(sale.total).minus(returnedTotal)) };
  }

  getSale(t: TenantInfo, id: string) {
    return this.prisma.withTenant(t, (tx) => StockService.saleDetail(tx, id));
  }

  listSales(t: TenantInfo, q: { from: string; to: string; staffId?: string; customerId?: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const rows = await tx.productSale.findMany({
        where: {
          occurredAt: { gte: new Date(q.from), lt: new Date(q.to) },
          ...(q.staffId ? { staffId: q.staffId } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: 500,
        select: { id: true },
      });
      return Promise.all(rows.map((r) => StockService.saleDetail(tx, r.id)));
    });
  }

  /**
   * Ürün iadesi: seçilen satırlar için kasaya iade yazılır, istenirse ürün stoğa geri girer.
   * İade tutarı satırın satış fiyatından hesaplanır; satılan adetten fazlası iade edilemez.
   */
  returnSale(t: TenantInfo, saleId: string, b: { items: { saleItemId: string; qty: number; restock?: boolean }[]; method?: PaymentMethod; reason: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      // Aynı satışa eşzamanlı iadeleri sıraya sokar (kasa iadesiyle aynı kilit).
      const sale = await tx.productSale.findUnique({ where: { id: saleId } });
      if (!sale) throw new NotFoundException("Satış bulunamadı");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"refund:" + sale.financeTransactionId}))::text`;
      const fresh = await tx.productSaleItem.findMany({ where: { saleId }, include: { returns: { select: { qty: true } } } });
      if (!b.items.length) throw new BadRequestException("İade edilecek ürün seçin");
      const lines = b.items.map((r) => {
        const it = fresh.find((x) => x.id === r.saleItemId);
        if (!it) throw new NotFoundException("Satış satırı bulunamadı");
        const left = D(it.qty).minus(it.returns.reduce((s, x) => s.plus(x.qty), D(0)));
        if (D(r.qty).greaterThan(left)) throw new ConflictException(`İade adedi kalan adedi (${left.toString()}) aşamaz`);
        const amount = D(it.unitPrice).times(r.qty).toDecimalPlaces(2);
        return { it, qty: D(r.qty), amount, vatAmount: vatOf(amount, it.vatRate), restock: r.restock ?? true };
      });
      if (new Set(lines.map((l) => l.it.id)).size !== lines.length) throw new BadRequestException("Aynı satır birden çok kez seçildi");
      const amount = lines.reduce((s, l) => s.plus(l.amount), D(0));
      const orig = await tx.financeTransaction.findUniqueOrThrow({ where: { id: sale.financeTransactionId } });
      const prev = await tx.financeTransaction.aggregate({ where: { refundOfId: orig.id }, _sum: { amount: true } });
      if (amount.greaterThan(D(orig.amount).minus(D(prev._sum.amount)))) throw new ConflictException("İade tutarı kalan tutarı aşamaz");
      const trx = await tx.financeTransaction.create({
        data: {
          tenantId: t.tenantId,
          type: "REFUND",
          category: "IADE",
          amount,
          method: b.method ?? orig.method,
          customerId: orig.customerId,
          staffId: orig.staffId,
          refundOfId: orig.id,
          description: b.reason,
          createdById: t.userId,
        },
      });
      const ret = await tx.productSaleReturn.create({
        data: { tenantId: t.tenantId, saleId, refundTransactionId: trx.id, amount, reason: b.reason, createdById: t.userId },
      });
      for (const l of lines) {
        await tx.productSaleReturnLine.create({ data: { tenantId: t.tenantId, returnId: ret.id, saleItemId: l.it.id, qty: l.qty, amount: l.amount, vatAmount: l.vatAmount, restocked: l.restock } });
        if (l.restock) {
          await StockService.move(tx, { tenantId: t.tenantId, productId: l.it.productId, type: "RETURN", qty: l.qty, createdById: t.userId, note: "Satış iadesi", productSaleId: saleId });
        }
      }
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "stock.sale_returned", entity: "ProductSale", entityId: saleId, metadata: { amount: money(amount), refundTransactionId: trx.id } });
      return StockService.saleDetail(tx, saleId);
    });
  }

  /** Ürün satış raporu: ürün bazında satılan/iade edilen adet, net ciro, maliyet ve brüt kâr. */
  salesReport(t: TenantInfo, q: { from: string; to: string }) {
    return this.prisma.withTenant(t, async (tx) => {
      const range = { gte: new Date(q.from), lt: new Date(q.to) };
      const [items, returns] = await Promise.all([
        tx.productSaleItem.findMany({ where: { sale: { occurredAt: range } }, include: { product: { select: { name: true, unit: true } } } }),
        tx.productSaleReturnLine.findMany({ where: { ret: { createdAt: range } }, include: { saleItem: { include: { product: { select: { name: true, unit: true } } } } } }),
      ]);
      type Row = { productId: string; name: string; unit: string; soldQty: Prisma.Decimal; returnedQty: Prisma.Decimal; revenue: Prisma.Decimal; vat: Prisma.Decimal; cost: Prisma.Decimal; costKnown: boolean; vatKnown: boolean };
      const by = new Map<string, Row>();
      const row = (id: string, p: { name: string; unit: string }) => {
        let r = by.get(id);
        if (!r) by.set(id, (r = { productId: id, name: p.name, unit: p.unit, soldQty: D(0), returnedQty: D(0), revenue: D(0), vat: D(0), cost: D(0), costKnown: true, vatKnown: true }));
        return r;
      };
      for (const i of items) {
        const r = row(i.productId, i.product);
        r.soldQty = r.soldQty.plus(i.qty);
        r.revenue = r.revenue.plus(i.lineTotal);
        r.vat = r.vat.plus(i.vatAmount);
        if (i.vatRate === null) r.vatKnown = false;
        if (i.unitCost === null) r.costKnown = false;
        r.cost = r.cost.plus(D(i.unitCost).times(i.qty));
      }
      for (const l of returns) {
        const i = l.saleItem;
        const r = row(i.productId, i.product);
        r.returnedQty = r.returnedQty.plus(l.qty);
        r.revenue = r.revenue.minus(l.amount);
        r.vat = r.vat.minus(l.vatAmount);
        if (l.restocked) r.cost = r.cost.minus(D(i.unitCost).times(l.qty));
      }
      const products = [...by.values()]
        .map((r) => ({
          productId: r.productId,
          name: r.name,
          unit: r.unit,
          soldQty: r.soldQty.toString(),
          returnedQty: r.returnedQty.toString(),
          revenue: money(r.revenue),
          vat: money(r.vat),
          netRevenue: money(r.revenue.minus(r.vat)),
          cost: money(r.cost),
          // Kâr KDV hariç ciro üzerinden (alış fiyatı KDV hariç girilir)
          profit: money(r.revenue.minus(r.vat).minus(r.cost)),
          costKnown: r.costKnown,
          vatKnown: r.vatKnown,
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue));
      const sum = (k: "revenue" | "vat" | "netRevenue" | "cost" | "profit") => money(products.reduce((s, p) => s.plus(p[k]), D(0)));
      const saleCount = await tx.productSale.count({ where: { occurredAt: range } });
      return { from: q.from, to: q.to, saleCount, revenue: sum("revenue"), vat: sum("vat"), netRevenue: sum("netRevenue"), cost: sum("cost"), profit: sum("profit"), products };
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
