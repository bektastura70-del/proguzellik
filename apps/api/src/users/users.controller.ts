import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { TenantAdminService } from "../platform/tenant-admin.service";
import { UsersService } from "./users.service";

const role = z.enum(["OWNER", "MANAGER", "RECEPTION", "STAFF"]);
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  fullName: z.string().trim().min(2).max(120),
  role,
  phone: z.string().trim().max(30).optional(),
});
const updateSchema = z
  .object({ role: role.optional(), isActive: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, "Değişiklik yok");

@Controller("team")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly invites: TenantAdminService,
  ) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  list(@CurrentTenant() t: TenantInfo) {
    return this.users.list(t);
  }

  /**
   * Ekibe davet: süreli, tek kullanımlık bağlantı e-postayla gider; parolayı davetli belirler.
   * Geçici parola üretilmez. E-posta yapılandırılmamışsa davet "gönderilmedi" olarak döner.
   */
  @Post()
  @Roles("OWNER", "MANAGER")
  invite(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>, @Req() req: Request) {
    if (body.role === "OWNER") {
      if (t.role !== "OWNER") throw new ForbiddenException("Yalnızca işletme sahibi OWNER rolü verebilir");
      throw new BadRequestException("Sahip rolü davetle verilemez; kişi katıldıktan sonra rolünü değiştirin");
    }
    return this.invites.inviteMember(t.tenantId, t.userId, { email: body.email, fullName: body.fullName, role: body.role }, req.ip, "tenant");
  }

  @Get("invites")
  @Roles("OWNER", "MANAGER")
  listInvites(@CurrentTenant() t: TenantInfo) {
    return this.invites.listTeamInvites(t.tenantId);
  }

  @Post("invites/:id/resend")
  @HttpCode(200)
  @Roles("OWNER", "MANAGER")
  resend(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.invites.resendById(id, t.userId, req.ip, { tenantId: t.tenantId });
  }

  @Post("invites/:id/revoke")
  @HttpCode(200)
  @Roles("OWNER", "MANAGER")
  revoke(@CurrentTenant() t: TenantInfo, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.invites.revokeById(id, t.userId, req.ip, { tenantId: t.tenantId });
  }

  @Patch(":id")
  @Roles("OWNER", "MANAGER")
  update(
    @CurrentTenant() t: TenantInfo,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.users.update(t, id, body);
  }
}
