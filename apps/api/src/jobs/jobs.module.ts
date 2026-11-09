import { Global, Module } from "@nestjs/common";
import { PaymentReminderService } from "../platform/finance/payment-reminder.service";
import { StockModule } from "../stock/stock.module";
import { JobsService } from "./jobs.service";

@Global()
@Module({ imports: [StockModule], providers: [JobsService, PaymentReminderService], exports: [JobsService] })
export class JobsModule {}
