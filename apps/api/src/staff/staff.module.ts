import { Injectable, Module } from "@nestjs/common";
import { StaffController } from "./staff.controller";
import { StaffLimitPolicy, StaffService } from "./staff.service";

/** Varsayılan: sınır yok. Abonelik modülü bunu paket sınırlarıyla değiştirir. */
@Injectable()
export class NoStaffLimit extends StaffLimitPolicy {
  async assertCanAddStaff() {}
}

@Module({
  controllers: [StaffController],
  providers: [StaffService, { provide: StaffLimitPolicy, useClass: NoStaffLimit }],
  exports: [StaffService],
})
export class StaffModule {}
