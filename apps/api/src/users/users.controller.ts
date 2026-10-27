import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentTenant, Roles, TenantInfo } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { UsersService } from "./users.service";

const role = z.enum(["OWNER", "MANAGER", "RECEPTION", "STAFF"]);
const inviteSchema = z.object({
  email: z.string().email().max(200),
  fullName: z.string().trim().min(2).max(120),
  role,
  phone: z.string().trim().max(30).optional(),
});
const updateSchema = z
  .object({ role: role.optional(), isActive: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, "Değişiklik yok");

@Controller("team")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles("OWNER", "MANAGER")
  list(@CurrentTenant() t: TenantInfo) {
    return this.users.list(t);
  }

  @Post()
  @Roles("OWNER", "MANAGER")
  invite(@CurrentTenant() t: TenantInfo, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.users.invite(t, body);
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
