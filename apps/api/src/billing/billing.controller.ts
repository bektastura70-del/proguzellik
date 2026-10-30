import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { AllowInactive, CurrentTenant, Public, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { planCodeSchema } from "./plans";
import { SubscriptionsService } from "./subscriptions.service";

const checkoutSchema = z.object({
  planCode: planCodeSchema,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  paymentToken: z.string().min(3).max(200),
});

@Controller()
export class BillingController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Public()
  @Get("plans")
  plans() {
    return this.subs.plans();
  }

  @Get("subscription")
  @AllowInactive()
  @Roles("OWNER", "MANAGER")
  current(@CurrentTenant() t: TenantInfo) {
    return this.subs.current(t);
  }

  @Post("subscription/checkout")
  @AllowInactive()
  @Roles("OWNER")
  checkout(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(checkoutSchema)) b: z.infer<typeof checkoutSchema>) {
    return this.subs.checkout(t, b);
  }

  @Post("subscription/cancel")
  @HttpCode(200)
  @Roles("OWNER")
  cancel(@CurrentTenant() t: TenantInfo) {
    return this.subs.cancel(t);
  }
}
