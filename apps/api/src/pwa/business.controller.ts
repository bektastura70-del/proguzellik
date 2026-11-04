import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { dateOnly } from "../common/schemas";
import { ZodPipe } from "../common/zod.pipe";
import { BusinessPwaService } from "./business.service";
import { PushSubscriptionsService } from "./push-subscriptions.service";

const agendaSchema = z.object({ date: dateOnly, staffId: z.string().uuid().optional() });
const listSchema = z.object({ unread: z.enum(["1", "0"]).optional() });
const prefsSchema = z.object({
  newAppointments: z.boolean().optional(),
  cancellations: z.boolean().optional(),
  changes: z.boolean().optional(),
  assignments: z.boolean().optional(),
});
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export const endpointSchema = z.object({ endpoint: z.string().url().max(1000) });

@Controller("pwa")
export class BusinessPwaController {
  constructor(
    private readonly svc: BusinessPwaService,
    private readonly push: PushSubscriptionsService,
  ) {}

  @Get("push")
  @Roles()
  pushStatus(@CurrentTenant() t: TenantInfo) {
    return this.push.staffStatus(t);
  }

  @Post("push/subscriptions")
  @Roles()
  subscribe(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(subscriptionSchema)) b: z.infer<typeof subscriptionSchema>, @Headers("user-agent") ua?: string) {
    return this.push.staffSubscribe(t, b, ua);
  }

  @Delete("push/subscriptions")
  @Roles()
  unsubscribe(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(endpointSchema)) b: z.infer<typeof endpointSchema>) {
    return this.push.staffUnsubscribe(t, b.endpoint);
  }

  @Post("push/test")
  @HttpCode(202)
  @Roles()
  testPush(@CurrentTenant() t: TenantInfo) {
    return this.push.staffTest(t);
  }

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
