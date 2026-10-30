import { Global, Module } from "@nestjs/common";
import { StaffLimitPolicy } from "../staff/staff.service";
import { BillingController } from "./billing.controller";
import { loadEnv } from "../config/env";
import { PaymentProvider, paymentProviderFor } from "./payment-provider";
import { PlanStaffLimit, SubscriptionsService } from "./subscriptions.service";

@Global()
@Module({
  controllers: [BillingController],
  providers: [
    SubscriptionsService,
    // Gerçek sağlayıcı entegre edilene kadar: geliştirme/testte test sağlayıcısı, canlıda online ödeme kapalı.
    { provide: PaymentProvider, useFactory: () => paymentProviderFor(loadEnv()) },
    { provide: StaffLimitPolicy, useClass: PlanStaffLimit },
  ],
  exports: [SubscriptionsService, StaffLimitPolicy, PaymentProvider],
})
export class BillingModule {}
