import { Module } from "@nestjs/common";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";

// StaffLimitPolicy, BillingModule (global) tarafından paket sınırlarıyla sağlanır.
@Module({ controllers: [StaffController], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}
