import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { NotificationQueue } from "./notification-queue";
import { NotificationHooks } from "./notification.hooks";
import { NotificationsController } from "./notifications.controller";
import { CloudWhatsAppProvider, MockWhatsAppProvider, WhatsAppProvider } from "./whatsapp.provider";

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    MockWhatsAppProvider,
    {
      provide: WhatsAppProvider,
      useFactory: (mock: MockWhatsAppProvider) => (loadEnv().WHATSAPP_MODE === "cloud" ? new CloudWhatsAppProvider() : mock),
      inject: [MockWhatsAppProvider],
    },
    NotificationQueue,
    NotificationHooks,
  ],
  exports: [NotificationQueue, NotificationHooks, WhatsAppProvider, MockWhatsAppProvider],
})
export class NotificationsModule {}
