import { Module } from "@nestjs/common";
import { PublicBookingModule } from "../public-booking/public-booking.module";
import { BrandingController } from "./branding.controller";
import { BrandingService } from "./branding.service";
import { BusinessPwaController } from "./business.controller";
import { BusinessPwaService } from "./business.service";
import { CustomerAuthService } from "./customer-auth.service";
import { PlatformPwaController } from "./platform-pwa.controller";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";
import { PushSubscriptionsService } from "./push-subscriptions.service";

@Module({
  imports: [PublicBookingModule],
  controllers: [PortalController, BusinessPwaController, PlatformPwaController, BrandingController],
  providers: [PortalService, CustomerAuthService, BusinessPwaService, BrandingService, PushSubscriptionsService],
  exports: [PortalService, CustomerAuthService],
})
export class PwaModule {}
