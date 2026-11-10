import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put } from "@nestjs/common";
import { ChannelType } from "@prisma/client";
import { z } from "zod";
import { CurrentTenant, RequiresFeature, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { CHANNEL_PATH, ChannelsService } from "./channels.service";

const metaId = z.string().trim().regex(/^\d{5,25}$/, "Meta kimliği yalnızca rakamlardan oluşur");
const saveSchema = z.object({
  externalId: metaId,
  businessAccountId: metaId.optional().nullable(),
  accessToken: z.string().trim().min(20, "Erişim anahtarı çok kısa").max(1024).optional(),
  appSecret: z.string().trim().regex(/^[0-9a-f]{32}$/i, "Uygulama gizli anahtarı 32 karakterlik onaltılık bir değerdir").optional(),
});
const esSchema = z.object({
  code: z.string().trim().min(10).max(2048),
  phoneNumberId: metaId,
  wabaId: metaId,
});
const aiSchema = z.object({ aiAutoReply: z.boolean(), aiDataConsent: z.boolean().optional() });
const testSchema = z.object({
  to: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, "Geçerli bir telefon numarası girin"),
  confirm: z.literal(true, { error: "Gönderimi onaylamalısınız" }),
});

function channelOf(p: string): ChannelType {
  const c = CHANNEL_PATH[p];
  if (!c) throw new NotFoundException("Bilinmeyen kanal");
  return c;
}

/** İşletmenin kendi WhatsApp/Instagram hesap bağlantısı (kurulum sihirbazı). */
@RequiresFeature("WHATSAPP")
@Controller("channels")
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  list(@CurrentTenant() t: TenantInfo) {
    return this.channels.list(t);
  }

  @Put(":channel")
  @Roles("OWNER")
  save(@CurrentTenant() t: TenantInfo, @Param("channel") p: string, @Body(new ZodPipe(saveSchema)) b: z.infer<typeof saveSchema>) {
    return this.channels.save(t, channelOf(p), b);
  }

  @Get(":channel/verify-token")
  @Roles("OWNER")
  verifyToken(@CurrentTenant() t: TenantInfo, @Param("channel") p: string) {
    return this.channels.verifyToken(t, channelOf(p));
  }

  @Post(":channel/verify")
  @HttpCode(200)
  @Roles("OWNER")
  verify(@CurrentTenant() t: TenantInfo, @Param("channel") p: string) {
    return this.channels.verify(t, channelOf(p));
  }

  /** "WhatsApp'ı bağla" (Embedded Signup) penceresinden dönen kod ve kimliklerle bağlantıyı kurar. */
  @Post("whatsapp/embedded-signup")
  @HttpCode(200)
  @Roles("OWNER")
  embeddedSignup(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(esSchema)) b: z.infer<typeof esSchema>) {
    return this.channels.embeddedSignup(t, b);
  }

  @Get("whatsapp/templates")
  @Roles("OWNER", "MANAGER")
  templates(@CurrentTenant() t: TenantInfo) {
    return this.channels.templates(t);
  }

  @Post("whatsapp/test-message")
  @HttpCode(200)
  @Roles("OWNER")
  test(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(testSchema)) b: z.infer<typeof testSchema>) {
    return this.channels.testMessage(t, b.to);
  }

  @Patch(":channel/ai")
  @Roles("OWNER")
  ai(@CurrentTenant() t: TenantInfo, @Param("channel") p: string, @Body(new ZodPipe(aiSchema)) b: z.infer<typeof aiSchema>) {
    return this.channels.updateAi(t, channelOf(p), b);
  }

  @Delete(":channel")
  @Roles("OWNER")
  disconnect(@CurrentTenant() t: TenantInfo, @Param("channel") p: string) {
    return this.channels.disconnect(t, channelOf(p));
  }
}
