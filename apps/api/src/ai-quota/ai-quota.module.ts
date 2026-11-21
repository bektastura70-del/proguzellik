import { Global, Module } from "@nestjs/common";
import { AiQuotaController, PlatformAiController } from "./ai-quota.controller";
import { AiQuotaService } from "./ai-quota.service";

@Global()
@Module({
  controllers: [AiQuotaController, PlatformAiController],
  providers: [AiQuotaService],
  exports: [AiQuotaService],
})
export class AiQuotaModule {}
