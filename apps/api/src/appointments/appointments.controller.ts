import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { dateOnly, moneySchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { AppointmentsService } from "./appointments.service";

const createSchema = z.object({
  customerId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  notes: z.string().max(1000).optional(),
  price: moneySchema.optional(),
  ignoreSchedule: z.boolean().optional(),
  customerPackageId: z.string().uuid().optional(),
});
const updateSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).optional(),
  staffId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  ignoreSchedule: z.boolean().optional(),
  price: moneySchema.optional(),
});
const statusSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  reason: z.string().max(300).optional(),
});
const listSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    staffId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
  })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 62 * 86_400_000, "En fazla 62 günlük aralık");
const availSchema = z.object({ date: dateOnly, serviceId: z.string().uuid(), staffId: z.string().uuid().optional() });

const DESK = ["OWNER", "MANAGER", "RECEPTION"] as const;

@Controller()
export class AppointmentsController {
  constructor(private readonly appts: AppointmentsService) {}

  @Get("appointments")
  @Roles()
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.appts.list(t, q);
  }

  /** Onay bekleyen randevular (her işletmede; salon uygulaması pilotuna bağlı değil). */
  @Get("appointments/pending")
  @Roles()
  pending(@CurrentTenant() t: TenantInfo) {
    return this.appts.pending(t);
  }

  @Get("appointments/:id")
  @Roles()
  get(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.appts.get(t, id);
  }

  @Post("appointments")
  @Roles(...DESK)
  create(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.appts.create(t, b);
  }

  @Patch("appointments/:id")
  @Roles(...DESK)
  update(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>,
  ) {
    return this.appts.reschedule(t, id, b);
  }

  @Post("appointments/:id/status")
  @Roles()
  status(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusSchema)) b: z.infer<typeof statusSchema>,
  ) {
    return this.appts.setStatus(t, id, b.status, b.reason);
  }

  @Get("availability")
  @Roles()
  availability(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(availSchema)) q: z.infer<typeof availSchema>) {
    return this.appts.availabilityFor(t, q);
  }
}
