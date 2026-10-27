import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@prisma/client";
import type { Request } from "express";
import { IS_PUBLIC, PLATFORM_ADMIN, ROLES } from "../common/decorators";
import { uuidParam } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Tek global koruma:
 *  1) @Public değilse geçerli JWT ister.
 *  2) @PlatformAdmin ise platform yöneticisi ister.
 *  3) @Roles varsa X-Tenant-Id başlığını, aktif üyeliği, rolü ve işletme durumunu doğrular.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Oturum gerekli");

    let payload: { sub: string; pa?: boolean };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Oturum geçersiz veya süresi dolmuş");
    }
    const user = await this.prisma.platform.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, isPlatformAdmin: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException("Oturum geçersiz");
    req.user = { id: user.id, isPlatformAdmin: user.isPlatformAdmin };

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (!user.isPlatformAdmin) throw new ForbiddenException("Yetkiniz yok");
      return true;
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles === undefined) return true;

    const tenantId = req.headers["x-tenant-id"];
    if (typeof tenantId !== "string" || !uuidParam.test(tenantId)) {
      throw new BadRequestException("X-Tenant-Id başlığı gerekli");
    }
    const membership = await this.prisma.platform.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      select: { role: true, isActive: true, tenant: { select: { status: true, trialEndsAt: true } } },
    });
    if (!membership || !membership.isActive) throw new ForbiddenException("Bu işletmeye erişiminiz yok");

    const t = membership.tenant;
    if (t.status === "SUSPENDED" || t.status === "CANCELLED") {
      throw new ForbiddenException("İşletme hesabı askıya alınmış");
    }
    if (t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt < new Date() && req.method !== "GET") {
      throw new HttpException("Deneme süresi doldu. Lütfen bir paket seçin.", HttpStatus.PAYMENT_REQUIRED);
    }
    if (roles.length > 0 && !roles.includes(membership.role)) {
      throw new ForbiddenException("Bu işlem için yetkiniz yok");
    }
    req.tenant = { tenantId, userId: user.id, role: membership.role };
    return true;
  }
}
