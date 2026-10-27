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

export interface AuthUser {
  id: string;
  isPlatformAdmin: boolean;
}

export interface TenantInfo {
  tenantId: string;
  userId: string;
  role: Role;
  plan?: string | null;
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
