import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { dateOnly } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { BusinessPwaService } from "./business.service";

const agendaSchema = z.object({ date: dateOnly, staffId: z.string().uuid().optional() });
const listSchema = z.object({ unread: z.enum(["1", "0"]).optional() });
const prefsSchema = z.object({
  newAppointments: z.boolean().optional(),
  cancellations: z.boolean().optional(),
  changes: z.boolean().optional(),
  assignments: z.boolean().optional(),
});

@Controller("pwa")
export class BusinessPwaController {
  constructor(private readonly svc: BusinessPwaService) {}

  @Get("flags")
  @Roles()
  flags(@CurrentTenant() t: TenantInfo) {
    return this.svc.flags(t);
  }

  @Get("agenda")
  @Roles()
  agenda(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(agendaSchema)) q: z.infer<typeof agendaSchema>) {
    return this.svc.agenda(t, q);
  }

  @Get("pending")
  @Roles()
  pending(@CurrentTenant() t: TenantInfo) {
    return this.svc.pending(t);
  }

  @Get("notifications")
  @Roles()
  notifications(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.notifications(t, { unread: q.unread === "1" });
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  @Roles()
  readAll(@CurrentTenant() t: TenantInfo) {
    return this.svc.markRead(t, "all");
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  @Roles()
  read(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.markRead(t, id);
  }

  @Get("preferences")
  @Roles()
  prefs(@CurrentTenant() t: TenantInfo) {
    return this.svc.preferences(t);
  }

  @Patch("preferences")
  @Roles()
  updatePrefs(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(prefsSchema)) b: z.infer<typeof prefsSchema>) {
    return this.svc.updatePreferences(t, b);
  }
}
