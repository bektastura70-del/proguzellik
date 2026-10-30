import { Module } from "@nestjs/common";
import { TenantAdminService } from "../platform/tenant-admin.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({ controllers: [UsersController], providers: [UsersService, TenantAdminService] })
export class UsersModule {}
