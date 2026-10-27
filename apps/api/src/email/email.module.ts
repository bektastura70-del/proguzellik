import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { EmailProvider, MockEmailProvider, SmtpEmailProvider } from "./email.provider";
import { EmailService } from "./email.service";

@Global()
@Module({
  providers: [
    MockEmailProvider,
    {
      provide: EmailProvider,
      useFactory: (mock: MockEmailProvider) => (loadEnv().EMAIL_MODE === "smtp" ? new SmtpEmailProvider() : mock),
      inject: [MockEmailProvider],
    },
    EmailService,
  ],
  exports: [EmailService, EmailProvider, MockEmailProvider],
})
export class EmailModule {}
