import { Module } from "@nestjs/common";
import { PublicBookingModule } from "../public-booking/public-booking.module";
import { BusinessPwaController } from "./business.controller";
import { BusinessPwaService } from "./business.service";
import { CustomerAuthService } from "./customer-auth.service";
import { PlatformPwaController } from "./platform-pwa.controller";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [PublicBookingModule],
  controllers: [PortalController, BusinessPwaController, PlatformPwaController],
  providers: [PortalService, CustomerAuthService, BusinessPwaService],
  exports: [PortalService, CustomerAuthService],
})
export class PwaModule {}
