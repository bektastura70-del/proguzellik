import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { FinanceModule } from "../finance/finance.module";
import { ReportsModule } from "../reports/reports.module";
import { AiProvider, AnthropicAiProvider, MockAiProvider } from "./ai.provider";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [ReportsModule, FinanceModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    { provide: AiProvider, useFactory: () => (loadEnv().ASSISTANT_AI_MODE === "anthropic" ? new AnthropicAiProvider() : new MockAiProvider()) },
  ],
})
export class AssistantModule {}
