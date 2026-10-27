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
import { ALLOW_INACTIVE, FEATURE, IS_PUBLIC, PLATFORM_ADMIN, ROLES } from "../common/decorators";
import { uuidParam } from "../common/zod.pipe";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { SessionService } from "./session.service";

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
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("Oturum gerekli");

    let payload: { sub: string; sid?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Oturum geçersiz veya süresi dolmuş");
    }
    // Yalnızca oturuma bağlı erişim belirteçleri kabul edilir (2FA ara belirteci kabul edilmez).
    if (payload.typ !== "access" || !payload.sid) throw new UnauthorizedException("Oturum geçersiz");
    const session = await this.sessions.validate(payload.sid, payload.sub);
    if (!session) throw new UnauthorizedException("Oturum sona erdi, lütfen yeniden giriş yapın");
    const user = await this.prisma.platform.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, isPlatformAdmin: true, mustChangePassword: true, mfaEnabledAt: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException("Oturum geçersiz");
    const always = ["/auth/me", "/auth/change-password", "/auth/logout", "/auth/sessions", "/auth/logout-others"];
    if (user.mustChangePassword && !always.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      throw new ForbiddenException({ message: "Devam etmek için parolanızı değiştirin", code: "PASSWORD_CHANGE_REQUIRED" });
    }
    req.user = { id: user.id, isPlatformAdmin: user.isPlatformAdmin, sessionId: session.id, mfaVerified: session.mfaVerified, mfaEnabled: !!user.mfaEnabledAt };

    const requireMfa = () => {
      if (!user.mfaEnabledAt) throw new ForbiddenException({ message: "Bu işlem için iki adımlı doğrulamayı açmanız gerekiyor", code: "MFA_SETUP_REQUIRED" });
      if (!session.mfaVerified) throw new ForbiddenException({ message: "Lütfen iki adımlı doğrulama ile yeniden giriş yapın", code: "MFA_REQUIRED" });
    };

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (!user.isPlatformAdmin) throw new ForbiddenException("Yetkiniz yok");
      if (loadEnv().MFA_ENFORCE_PLATFORM === "1") requireMfa();
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
      select: {
        role: true,
        isActive: true,
        tenant: { select: { status: true, trialEndsAt: true, planCode: true, requireMfa: true, plan: { select: { features: true, name: true } } } },
      },
    });
    if (!membership || !membership.isActive) throw new ForbiddenException("Bu işletmeye erişiminiz yok");

    const t = membership.tenant;
    const allowInactive = this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE, targets);
    if (t.status === "SUSPENDED") throw new ForbiddenException("İşletme hesabı askıya alınmış");
    if (!allowInactive) {
      if (t.status === "CANCELLED") {
        throw new HttpException("Abonelik sona erdi. Lütfen bir paket seçin.", HttpStatus.PAYMENT_REQUIRED);
      }
      const trialOver = t.status === "TRIAL" && t.trialEndsAt && t.trialEndsAt < new Date();
      if ((trialOver || t.status === "PAST_DUE") && req.method !== "GET") {
        throw new HttpException(
          trialOver ? "Deneme süresi doldu. Lütfen bir paket seçin." : "Abonelik ödemesi bekleniyor.",
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE, targets);
    if (feature && !t.plan.features.includes(feature)) {
      throw new ForbiddenException(`Bu özellik ${t.plan.name} paketinizde yok. Paketinizi yükseltin.`);
    }
    if (t.requireMfa && (membership.role === "OWNER" || membership.role === "MANAGER")) requireMfa();
    if (roles.length > 0 && !roles.includes(membership.role)) {
      throw new ForbiddenException("Bu işlem için yetkiniz yok");
    }
    req.tenant = { tenantId, userId: user.id, role: membership.role, plan: t.planCode, features: t.plan.features };
    return true;
  }
}
