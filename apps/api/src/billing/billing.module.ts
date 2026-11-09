import { Global, Module } from "@nestjs/common";
import { StaffLimitPolicy } from "../staff/staff.service";
import { BillingController } from "./billing.controller";
import { PurchaseController } from "./purchase.controller";
import { PurchaseService } from "./purchase.service";
import { loadEnv } from "../config/env";
import { PaymentProvider, paymentProviderFor } from "./payment-provider";
import { PlanStaffLimit, SubscriptionsService } from "./subscriptions.service";
import { HttpIyzicoClient, IyzicoClient } from "./iyzico/iyzico.client";
import { IyzicoBillingService } from "./iyzico/iyzico-billing.service";

@Global()
@Module({
  controllers: [BillingController, PurchaseController],
  providers: [
    SubscriptionsService,
    // Gerçek sağlayıcı entegre edilene kadar: geliştirme/testte test sağlayıcısı, canlıda online ödeme kapalı.
    { provide: IyzicoClient, useClass: HttpIyzicoClient },
    { provide: PaymentProvider, useFactory: (iyzico: IyzicoClient) => paymentProviderFor(loadEnv(), () => iyzico.environment != null), inject: [IyzicoClient] },
    IyzicoBillingService,
    PurchaseService,
    { provide: StaffLimitPolicy, useClass: PlanStaffLimit },
  ],
  exports: [PurchaseService, SubscriptionsService, StaffLimitPolicy, PaymentProvider, IyzicoClient, IyzicoBillingService],
})
export class BillingModule {}
