import { Global, Module } from "@nestjs/common";
import { NotificationHooks } from "../notifications/notification.hooks";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentHooks, AppointmentsService } from "./appointments.service";
import { AvailabilityService } from "./availability.service";

@Global()
@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AvailabilityService, { provide: AppointmentHooks, useExisting: NotificationHooks }],
  exports: [AppointmentsService, AvailabilityService, AppointmentHooks],
})
export class AppointmentsModule {}
