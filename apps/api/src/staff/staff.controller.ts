import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { phoneSchema } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { StaffService } from "./staff.service";

const staffSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  title: z.string().max(80).optional(),
  phone: phoneSchema.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  onlineBookable: z.boolean().optional(),
  userId: z.string().uuid().nullable().optional(),
});
const servicesSchema = z.object({ serviceIds: z.array(z.string().uuid()).max(200) });
const hoursSchema = z.object({
  hours: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          startMin: z.number().int().min(0).max(1440),
          endMin: z.number().int().min(0).max(1440),
        })
        .refine((h) => h.startMin < h.endMin, "Başlangıç bitişten önce olmalı"),
    )
    .max(50),
});
const timeOffSchema = z
  .object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().max(200).optional() })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), "Başlangıç bitişten önce olmalı");

const rangeSchema = z
  .object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 62 * 86_400_000, "En fazla 62 günlük aralık");

@Controller("time-off")
export class TimeOffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Roles()
  range(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.staff.timeOffRange(t, q.from, q.to);
  }
}

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Roles()
  list(@CurrentTenant() t: TenantInfo, @Query("includeInactive") inc?: string) {
    return this.staff.list(t, inc === "true");
  }

  @Post()
  @Roles("OWNER", "MANAGER")
  create(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(staffSchema)) b: z.infer<typeof staffSchema>) {
    return this.staff.create(t, b);
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER")
  update(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(staffSchema.partial())) b: Partial<z.infer<typeof staffSchema>>,
  ) {
    return this.staff.update(t, id, b);
  }

  @Put(":id/services")
  @Roles("OWNER", "MANAGER")
  services(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(servicesSchema)) b: z.infer<typeof servicesSchema>,
  ) {
    return this.staff.setServices(t, id, b.serviceIds);
  }

  @Put(":id/working-hours")
  @Roles("OWNER", "MANAGER")
  hours(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(hoursSchema)) b: z.infer<typeof hoursSchema>,
  ) {
    return this.staff.setWorkingHours(t, id, b.hours);
  }

  @Get(":id/time-off")
  @Roles()
  timeOff(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.staff.listTimeOff(t, id);
  }

  @Post(":id/time-off")
  @Roles("OWNER", "MANAGER")
  addTimeOff(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(timeOffSchema)) b: z.infer<typeof timeOffSchema>,
  ) {
    return this.staff.addTimeOff(t, id, b);
  }

  @Delete(":id/time-off/:timeOffId")
  @Roles("OWNER", "MANAGER")
  removeTimeOff(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("timeOffId", ParseUUIDPipe) timeOffId: string,
  ) {
    return this.staff.removeTimeOff(t, id, timeOffId);
  }
}
