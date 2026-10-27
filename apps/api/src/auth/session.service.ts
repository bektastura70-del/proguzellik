import { Injectable, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

const TOUCH_INTERVAL_MS = 60_000;

/** Sunucu tarafı oturumlar: her JWT bir oturum kaydına bağlıdır ve iptal edilebilir. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async create(userId: string, meta: { ip?: string; userAgent?: string; mfaVerified: boolean }) {
    const env = loadEnv();
    const session = await this.prisma.platform.session.create({
      data: {
        userId,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        mfaVerified: meta.mfaVerified,
        expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: session.id, typ: "access" }, { expiresIn: `${env.SESSION_TTL_HOURS}h` });
    return { accessToken, session };
  }

  /** Oturum geçerli mi (iptal, mutlak süre ve hareketsizlik kontrolü)? Gerekirse son görülme zamanını günceller. */
  async validate(sid: string, userId: string) {
    const env = loadEnv();
    const s = await this.prisma.platform.session.findUnique({ where: { id: sid } });
    const now = Date.now();
    if (!s || s.userId !== userId || s.revokedAt || s.expiresAt.getTime() <= now) return null;
    if (now - s.lastSeenAt.getTime() > env.SESSION_IDLE_MINUTES * 60_000) {
      await this.prisma.platform.session.update({ where: { id: sid }, data: { revokedAt: new Date() } });
      return null;
    }
    if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.platform.session.update({ where: { id: sid }, data: { lastSeenAt: new Date() } });
    }
    return s;
  }

  list(userId: string) {
    return this.prisma.platform.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, mfaVerified: true },
    });
  }

  async revoke(userId: string, sid: string) {
    const r = await this.prisma.platform.session.updateMany({ where: { id: sid, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException("Oturum bulunamadı");
    return { revoked: true };
  }

  /** exceptSid verilirse o oturum açık kalır. */
  async revokeAll(userId: string, exceptSid?: string) {
    const r = await this.prisma.platform.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }
}
