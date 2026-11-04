import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { NotificationQueue } from "./notification-queue";
import { NotificationHooks } from "./notification.hooks";
import { PushPlanner } from "./push/push.planner";
import { WebPushDelivery } from "./push/web-push.delivery";
import { LiveWebPushSender, MockWebPushSender } from "./push/web-push.sender";
import { NotificationsController } from "./notifications.controller";
import { RetentionService } from "./retention.service";
import { CloudWhatsAppProvider, DisabledWhatsAppProvider, MockWhatsAppProvider, WhatsAppProvider } from "./whatsapp.provider";

@Global()
@Module({
  controllers: [NotificationsController],
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
    MockWebPushSender,
    LiveWebPushSender,
    WebPushDelivery,
    PushPlanner,
  ],
  exports: [NotificationQueue, NotificationHooks, RetentionService, WhatsAppProvider, MockWhatsAppProvider, MockWebPushSender, PushPlanner],
})
export class NotificationsModule {}
