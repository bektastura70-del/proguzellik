import { Global, Injectable, Module } from "@nestjs/common";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentHooks, AppointmentsService } from "./appointments.service";
import { AvailabilityService } from "./availability.service";

@Injectable()
export class NoopAppointmentHooks extends AppointmentHooks {
  async onCreated() {}
  async onStatusChanged() {}
}

@Global()
@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AvailabilityService, { provide: AppointmentHooks, useClass: NoopAppointmentHooks }],
  exports: [AppointmentsService, AvailabilityService],
})
export class AppointmentsModule {}
