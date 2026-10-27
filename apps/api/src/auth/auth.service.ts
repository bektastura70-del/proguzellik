import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const TRIAL_DAYS = 14;

export const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync("zamanlama-dengeleme", BCRYPT_ROUNDS);

export function slugify(input: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const db = this.prisma.platform;
    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    const generic = new UnauthorizedException("E-posta veya parola hatalı");

    if (!user || !user.isActive) {
      // Zamanlama farkını azaltmak için yine de hash karşılaştırması yap.
      await bcrypt.compare(password, DUMMY_HASH);
      await this.audit.logPlatform({ action: "auth.login_failed", metadata: { email }, ip });
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.logPlatform({ action: "auth.login_locked", actorId: user.id, ip });
      throw new UnauthorizedException("Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.audit.logPlatform({ action: "auth.login_failed", actorId: user.id, ip });
      throw generic;
    }

    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.logPlatform({ action: "auth.login", actorId: user.id, ip });

    const accessToken = await this.jwt.signAsync({ sub: user.id, pa: user.isPlatformAdmin });
    return { accessToken, user: await this.profile(user.id) };
  }

  async profile(userId: string) {
    const user = await this.prisma.platform.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isPlatformAdmin: true,
        memberships: {
          where: { isActive: true },
          select: {
            role: true,
            tenant: {
              select: { id: true, name: true, slug: true, status: true, trialEndsAt: true, planCode: true, plan: { select: { name: true, features: true } } },
            },
          },
        },
      },
    });
    return user;
  }

  /** Yeni işletme kaydı: 14 günlük deneme ile başlar, kayıt olan kişi OWNER olur. */
  async registerBusiness(input: {
    businessName: string;
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    planCode?: "STARTER" | "PROFESSIONAL" | "SMART";
  }) {
    const db = this.prisma.platform;
    const email = input.email.toLowerCase();
    if (await db.user.findUnique({ where: { email } })) {
      throw new ConflictException("Bu e-posta ile kayıtlı bir hesap var");
    }
    let slug = slugify(input.businessName) || "isletme";
    if (await db.tenant.findUnique({ where: { slug } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.businessName,
          slug,
          status: "TRIAL",
          planCode: input.planCode ?? "PROFESSIONAL",
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
          phone: input.phone,
          email,
        },
      });
      const user = await tx.user.create({
        data: { email, passwordHash, fullName: input.fullName, phone: input.phone },
      });
      await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actorId: user.id, action: "tenant.registered" },
      });
      return { tenant, user };
    });
    const accessToken = await this.jwt.signAsync({ sub: result.user.id, pa: false });
    return { accessToken, user: await this.profile(result.user.id) };
  }
}
