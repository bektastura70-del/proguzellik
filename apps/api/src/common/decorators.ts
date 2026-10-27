import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { Request } from "express";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = "roles";
/** Uç nokta işletme bağlamı ister; verilen rollerden biri gereklidir (boşsa tüm üyeler). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const PLATFORM_ADMIN = "platformAdmin";
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);

export const FEATURE = "feature";
/** Uç nokta işletmenin paketinde bu özelliğin olmasını ister (örn. AI_ASSISTANT). */
export const RequiresFeature = (feature: string) => SetMetadata(FEATURE, feature);

export const ALLOW_INACTIVE = "allowInactive";
/** Aboneliği bitmiş/iptal edilmiş işletmelerin de erişebileceği uç noktalar (ödeme ekranı). */
export const AllowInactive = () => SetMetadata(ALLOW_INACTIVE, true);

export interface AuthUser {
  id: string;
  isPlatformAdmin: boolean;
  sessionId: string;
  mfaVerified: boolean;
  mfaEnabled: boolean;
}

export interface TenantInfo {
  tenantId: string;
  userId: string;
  role: Role;
  plan: string;
  features: string[];
}

declare module "express" {
  interface Request {
    user?: AuthUser;
    tenant?: TenantInfo;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().user,
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().tenant,
);
