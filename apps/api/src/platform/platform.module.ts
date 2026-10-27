import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller";
import { TenantAdminService } from "./tenant-admin.service";

@Module({ controllers: [PlatformController], providers: [TenantAdminService] })
export class PlatformModule {}
