import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { moneySchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { methodSchema } from "../packages/packages.controller";
import { StockService } from "./stock.service";

const qty = z.number().positive().max(1_000_000);
const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional(),
  unit: z.string().trim().max(20).optional(),
  kind: z.enum(["RETAIL", "CONSUMABLE"]).optional(),
  minQty: z.number().min(0).max(1_000_000).optional(),
  costPrice: moneySchema.optional(),
  salePrice: moneySchema.optional(),
  isActive: z.boolean().optional(),
});
const createSchema = productSchema.extend({ initialQty: qty.optional() });
const moveSchema = z.object({
  type: z.enum(["IN", "OUT", "ADJUST"]),
  qty: z.number().refine((v) => v !== 0 && Math.abs(v) <= 1_000_000, "Geçersiz miktar"),
  note: z.string().max(200).optional(),
}).refine((v) => v.type === "ADJUST" || v.qty > 0, "Giriş/çıkış miktarı pozitif olmalı");
const saleLine = z.object({ productId: z.string().uuid(), qty, unitPrice: moneySchema.optional() });
// Tek ürünlü eski biçim ({productId, qty, unitPrice}) ve çok satırlı fiş ({items: [...]}) birlikte desteklenir.
const saleSchema = z
  .object({
    items: z.array(saleLine).min(1).max(50).optional(),
    productId: z.string().uuid().optional(),
    qty: qty.optional(),
    unitPrice: moneySchema.optional(),
    method: methodSchema,
    customerId: z.string().uuid().optional(),
    staffId: z.string().uuid().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => !!v.items !== !!v.productId, "Ürün listesi ya da tek ürün verilmelidir")
  .refine((v) => !v.productId || v.qty !== undefined, "Adet gerekli")
  .transform(({ items, productId, qty: q, unitPrice, ...rest }) => ({
    ...rest,
    items: items ?? [{ productId: productId!, qty: q!, unitPrice }],
  }));
const returnSchema = z.object({
  items: z.array(z.object({ saleItemId: z.string().uuid(), qty, restock: z.boolean().optional() })).min(1).max(50),
  method: methodSchema.optional(),
  reason: z.string().trim().min(3).max(300),
});
const salesListSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});
const rangeSchema = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
const consumablesSchema = z.object({ items: z.array(z.object({ productId: z.string().uuid(), qty })).max(50) });
const listSchema = z.object({ low: z.enum(["true", "false"]).optional(), kind: z.enum(["RETAIL", "CONSUMABLE"]).optional() });

@RequiresFeature("STOCK")
@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get("products")
  @Roles()
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.stock.list(t, { lowOnly: q.low === "true", kind: q.kind });
  }

  @Post("products")
  @Roles("OWNER", "MANAGER")
  create(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.stock.create(t, b);
  }

  @Patch("products/:id")
  @Roles("OWNER", "MANAGER")
  update(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(productSchema.partial())) b: Partial<z.infer<typeof productSchema>>) {
    return this.stock.update(t, id, b);
  }

  @Post("products/:id/movements")
  @Roles("OWNER", "MANAGER")
  move(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(moveSchema)) b: z.infer<typeof moveSchema>) {
    return this.stock.movement(t, id, b);
  }

  @Get("products/:id/movements")
  @Roles("OWNER", "MANAGER")
  movements(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.stock.movements(t, id);
  }

  @Post("product-sales")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  sell(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(saleSchema)) b: z.infer<typeof saleSchema>) {
    return this.stock.sell(t, b);
  }

  @Get("product-sales")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  listSales(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(salesListSchema)) q: z.infer<typeof salesListSchema>) {
    return this.stock.listSales(t, q);
  }

  @Get("product-sales/report")
  @Roles("OWNER", "MANAGER")
  report(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.stock.salesReport(t, q);
  }

  @Get("product-sales/:id")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  getSale(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.stock.getSale(t, id);
  }

  @Post("product-sales/:id/returns")
  @Roles("OWNER", "MANAGER")
  returnSale(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(returnSchema)) b: z.infer<typeof returnSchema>) {
    return this.stock.returnSale(t, id, b);
  }

  @Get("services/:id/consumables")
  @Roles()
  consumables(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.stock.getConsumables(t, id);
  }

  @Put("services/:id/consumables")
  @Roles("OWNER", "MANAGER")
  setConsumables(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(consumablesSchema)) b: z.infer<typeof consumablesSchema>) {
    return this.stock.setConsumables(t, id, b.items);
  }
}
