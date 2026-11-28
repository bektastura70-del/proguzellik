import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { BookingEmailPlanner } from "./booking-email.planner";
import { NotificationQueue } from "./notification-queue";
import { NotificationHooks } from "./notification.hooks";
import { PushPlanner } from "./push/push.planner";
import { WebPushDelivery } from "./push/web-push.delivery";
import { LiveWebPushSender, MockWebPushSender } from "./push/web-push.sender";
import { NotificationsController } from "./notifications.controller";
import { RenewalService } from "./renewal.service";
import { RenewalOptOutController, RenewalsController } from "./renewals.controller";
import { RetentionService } from "./retention.service";
import { CloudWhatsAppProvider, DisabledWhatsAppProvider, MockWhatsAppProvider, WhatsAppProvider } from "./whatsapp.provider";

@Global()
@Module({
  controllers: [NotificationsController, RenewalsController, RenewalOptOutController],
  providers: [
    MockWhatsAppProvider,
    {
      provide: WhatsAppProvider,
      useFactory: (mock: MockWhatsAppProvider) => {
        const env = loadEnv();
        if (env.WHATSAPP_MODE === "cloud") return new CloudWhatsAppProvider();
        // Canlıda test sağlayıcısı kullanılmaz: sahte "gönderildi" kaydı ve kişisel veri logu olmaz.
        return env.NODE_ENV === "production" ? new DisabledWhatsAppProvider() : mock;
      },
      inject: [MockWhatsAppProvider],
    },
    NotificationQueue,
    NotificationHooks,
    RetentionService,
    RenewalService,
    MockWebPushSender,
    LiveWebPushSender,
    WebPushDelivery,
    PushPlanner,
    BookingEmailPlanner,
  ],
  exports: [NotificationQueue, NotificationHooks, RetentionService, RenewalService, WhatsAppProvider, MockWhatsAppProvider, MockWebPushSender, PushPlanner, BookingEmailPlanner],
})
export class NotificationsModule {}
