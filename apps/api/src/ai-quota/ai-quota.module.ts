import { Global, Module } from "@nestjs/common";
import { AiQuotaController, AiTopupCallbackController, PlatformAiController } from "./ai-quota.controller";
import { AiTopupService } from "./ai-topup.service";
import { AiQuotaService } from "./ai-quota.service";

@Global()
@Module({
  controllers: [AiQuotaController, AiTopupCallbackController, PlatformAiController],
  providers: [AiQuotaService, AiTopupService],
  exports: [AiQuotaService, AiTopupService],
})
export class AiQuotaModule {}
