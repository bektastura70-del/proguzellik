import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { CustomersModule } from "./customers/customers.module";
import { CatalogModule } from "./catalog/catalog.module";
import { StaffModule } from "./staff/staff.module";
import { AppointmentsModule } from "./appointments/appointments.module";

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, HealthModule, UsersModule, CustomersModule, CatalogModule, StaffModule, AppointmentsModule],
})
export class AppModule {}
