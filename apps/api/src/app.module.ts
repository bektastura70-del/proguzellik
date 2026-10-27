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
import { PackagesModule } from "./packages/packages.module";
import { FinanceModule } from "./finance/finance.module";
import { StockModule } from "./stock/stock.module";
import { ReportsModule } from "./reports/reports.module";
import { BillingModule } from "./billing/billing.module";
import { PlatformModule } from "./platform/platform.module";
import { SettingsModule } from "./settings/settings.module";
import { PublicBookingModule } from "./public-booking/public-booking.module";

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, HealthModule, UsersModule, CustomersModule, CatalogModule, StaffModule, AppointmentsModule, PackagesModule, FinanceModule, StockModule, ReportsModule, BillingModule, PlatformModule, SettingsModule, PublicBookingModule],
})
export class AppModule {}
