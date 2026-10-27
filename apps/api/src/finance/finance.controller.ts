import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { moneySchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { methodSchema } from "../packages/packages.controller";
import { FinanceService } from "./finance.service";

const amount = moneySchema.refine((v) => v > 0, "Tutar sıfırdan büyük olmalı");
const range = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
const listSchema = range.extend({
  type: z.enum(["INCOME", "EXPENSE", "REFUND"]).optional(),
  customerId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
});
const collectSchema = z.object({
  customerId: z.string().uuid(),
  amount,
  method: methodSchema,
  appointmentId: z.string().uuid().optional(),
  customerPackageId: z.string().uuid().optional(),
  description: z.string().max(300).optional(),
});
const recordSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  category: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => v.toLocaleUpperCase("tr-TR")),
  amount,
  method: methodSchema,
  staffId: z.string().uuid().optional(),
  description: z.string().max(300).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
const refundSchema = z.object({ amount, method: methodSchema.optional(), reason: z.string().trim().min(3).max(300) });

const DESK = ["OWNER", "MANAGER", "RECEPTION"] as const;

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("finance/transactions")
  @Roles(...DESK)
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.finance.list(t, q);
  }

  @Post("finance/payments")
  @Roles(...DESK)
  collect(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(collectSchema)) b: z.infer<typeof collectSchema>) {
    return this.finance.collect(t, b);
  }

  @Post("finance/transactions")
  @Roles("OWNER", "MANAGER")
  record(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(recordSchema)) b: z.infer<typeof recordSchema>) {
    return this.finance.record(t, b);
  }

  @Post("finance/transactions/:id/refund")
  @Roles("OWNER", "MANAGER")
  refund(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(refundSchema)) b: z.infer<typeof refundSchema>,
  ) {
    return this.finance.refund(t, id, b);
  }

  @Get("finance/summary")
  @Roles(...DESK)
  summary(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(range)) q: z.infer<typeof range>) {
    return this.finance.summary(t, q);
  }

  @Get("finance/commissions")
  @Roles("OWNER", "MANAGER")
  commissions(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(range)) q: z.infer<typeof range>) {
    return this.finance.commissions(t, q);
  }

  @Get("customers/:id/balance")
  @Roles(...DESK)
  balance(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.finance.balance(t, id);
  }
}
