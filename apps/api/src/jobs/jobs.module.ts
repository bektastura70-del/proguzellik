import { Global, Module } from "@nestjs/common";
import { PaymentReminderService } from "../platform/finance/payment-reminder.service";
import { JobsService } from "./jobs.service";

@Global()
@Module({ providers: [JobsService, PaymentReminderService], exports: [JobsService] })
export class JobsModule {}
