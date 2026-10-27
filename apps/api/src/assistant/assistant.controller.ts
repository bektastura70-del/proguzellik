import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AssistantService } from "./assistant.service";

const askSchema = z.object({ question: z.string().trim().min(3).max(1000) });

/** Yalnızca Akıllı pakette bulunan yapay zekâ işletme asistanı. */
@RequiresFeature("AI_ASSISTANT")
@Controller("assistant")
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post("ask")
  @HttpCode(200)
  @Roles("OWNER", "MANAGER")
  ask(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(askSchema)) b: z.infer<typeof askSchema>) {
    return this.assistant.ask(t, b.question);
  }
}
