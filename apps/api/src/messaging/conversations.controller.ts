import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { InboxService } from "./inbox.service";

const listSchema = z.object({ mode: z.enum(["AI", "HUMAN"]).optional(), unread: z.enum(["true", "false"]).optional() });
const replySchema = z.object({ text: z.string().trim().min(1).max(1000) });
const modeSchema = z.object({ mode: z.enum(["AI", "HUMAN"]) });
const linkSchema = z.object({ customerId: z.string().uuid().nullable() });

/** WhatsApp/Instagram gelen kutusu. */
@RequiresFeature("WHATSAPP")
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @Roles("OWNER", "MANAGER", "RECEPTION")
  list(@CurrentTenant() t: TenantInfo, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.inbox.list(t, { mode: q.mode, unread: q.unread === "true" });
  }

  @Get(":id")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  get(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string) {
    return this.inbox.get(t, id);
  }

  @Post(":id/messages")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  reply(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.inbox.staffReply(t, id, b.text);
  }

  @Patch(":id/mode")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  mode(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(modeSchema)) b: z.infer<typeof modeSchema>) {
    return this.inbox.setMode(t, id, b.mode);
  }

  @Patch(":id/customer")
  @Roles("OWNER", "MANAGER", "RECEPTION")
  link(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(linkSchema)) b: z.infer<typeof linkSchema>) {
    return this.inbox.linkCustomer(t, id, b.customerId);
  }
}
