import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
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
const saleSchema = z.object({
  productId: z.string().uuid(),
  qty,
  method: methodSchema,
  customerId: z.string().uuid().optional(),
  unitPrice: moneySchema.optional(),
});
const consumablesSchema = z.object({ items: z.array(z.object({ productId: z.string().uuid(), qty })).max(50) });
const listSchema = z.object({ low: z.enum(["true", "false"]).optional(), kind: z.enum(["RETAIL", "CONSUMABLE"]).optional() });

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
