import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller";
import { ManualSubscriptionService } from "./manual-subscription.service";
import { PlatformUsersService } from "./platform-users.service";
import { TenantAdminService } from "./tenant-admin.service";

@Module({ controllers: [PlatformController], providers: [TenantAdminService, ManualSubscriptionService, PlatformUsersService] })
export class PlatformModule {}
