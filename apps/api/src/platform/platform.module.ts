import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { EInvoiceProvider, einvoiceProviderFor } from "./finance/einvoice-provider";
import { PlatformFinanceController } from "./finance/finance.controller";
import { PlatformFinanceService } from "./finance/finance.service";
import { PlatformInvoiceService } from "./finance/invoice.service";
import { PlatformEmailController } from "./email-admin.controller";
import { PaymentReminderService } from "./finance/payment-reminder.service";
import { ManualSubscriptionService } from "./manual-subscription.service";
import { PlanAdminService } from "./plan-admin.service";
import { PlatformController } from "./platform.controller";
import { PlatformUsersService } from "./platform-users.service";
import { TenantAdminService } from "./tenant-admin.service";

@Module({
  controllers: [PlatformController, PlatformFinanceController, PlatformEmailController],
  providers: [
    TenantAdminService,
    ManualSubscriptionService,
    PlatformUsersService,
    PlanAdminService,
    PlatformFinanceService,
    PlatformInvoiceService,
    PaymentReminderService,
    { provide: EInvoiceProvider, useFactory: () => einvoiceProviderFor(loadEnv()) },
  ],
})
export class PlatformModule {}
