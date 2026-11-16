import { Module } from "@nestjs/common";
import { MessagingModule } from "./messaging/messaging.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
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
import { NotificationsModule } from "./notifications/notifications.module";
import { AssistantModule } from "./assistant/assistant.module";
import { EmailModule } from "./email/email.module";
import { JobsModule } from "./jobs/jobs.module";
import { PwaModule } from "./pwa/pwa.module";
import { DirectoryModule } from "./directory/directory.module";

@Module({
  imports: [PrismaModule, AuditModule, EmailModule, AuthModule, HealthModule, UsersModule, CustomersModule, CatalogModule, StaffModule, AppointmentsModule, PackagesModule, FinanceModule, StockModule, ReportsModule, BillingModule, PlatformModule, SettingsModule, PublicBookingModule, NotificationsModule, MessagingModule, CampaignsModule, AssistantModule, JobsModule, PwaModule, DirectoryModule],
})
export class AppModule {}
