import { Module } from "@nestjs/common";
import { PublicBookingModule } from "../public-booking/public-booking.module";
import { CustomerAuthService } from "./customer-auth.service";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [PublicBookingModule],
  controllers: [PortalController],
  providers: [PortalService, CustomerAuthService],
  exports: [PortalService, CustomerAuthService],
})
export class PwaModule {}
