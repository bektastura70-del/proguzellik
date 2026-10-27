import { Global, Module } from "@nestjs/common";
import { StaffLimitPolicy } from "../staff/staff.service";
import { BillingController } from "./billing.controller";
import { MockPaymentProvider, PaymentProvider } from "./payment-provider";
import { PlanStaffLimit, SubscriptionsService } from "./subscriptions.service";

@Global()
@Module({
  controllers: [BillingController],
  providers: [
    SubscriptionsService,
    // Gerçek sağlayıcı entegre edilene kadar yalnızca test sağlayıcısı kullanılır.
    { provide: PaymentProvider, useClass: MockPaymentProvider },
    { provide: StaffLimitPolicy, useClass: PlanStaffLimit },
  ],
  exports: [SubscriptionsService, StaffLimitPolicy, PaymentProvider],
})
export class BillingModule {}
