import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { NotificationQueue } from "./notification-queue";
import { NotificationHooks } from "./notification.hooks";
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
  ],
  exports: [NotificationQueue, NotificationHooks, RetentionService, WhatsAppProvider, MockWhatsAppProvider],
})
export class NotificationsModule {}
