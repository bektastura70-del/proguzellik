import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller";
import { ManualSubscriptionService } from "./manual-subscription.service";
import { TenantAdminService } from "./tenant-admin.service";

@Module({ controllers: [PlatformController], providers: [TenantAdminService, ManualSubscriptionService] })
export class PlatformModule {}
