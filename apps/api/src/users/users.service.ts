import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { BCRYPT_ROUNDS } from "../auth/auth.service";
import { TenantInfo } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(t: TenantInfo) {
    return this.prisma.withTenant(t, (tx) =>
      tx.membership.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          isActive: true,
          createdAt: true,
          user: { select: { id: true, email: true, fullName: true, phone: true } },
        },
      }),
    );
  }

  private assertCanAssign(actor: Role, target: Role) {
    if (target === "OWNER" && actor !== "OWNER") {
      throw new ForbiddenException("Yalnızca işletme sahibi OWNER rolü verebilir");
    }
  }

  /**
   * Ekibe kullanıcı ekler. Kullanıcı yoksa geçici parola ile oluşturulur
   * (gerçek ortamda davet e-postası/SMS ile iletilmeli; burada yanıtta döner).
   */
  async invite(t: TenantInfo, input: { email: string; fullName: string; role: Role; phone?: string }) {
    this.assertCanAssign(t.role, input.role);
    const email = input.email.toLowerCase();
    let user = await this.prisma.platform.user.findUnique({ where: { email } });
    let temporaryPassword: string | undefined;
    if (!user) {
      temporaryPassword = randomBytes(9).toString("base64url") + "7a";
      user = await this.prisma.platform.user.create({
        data: {
          email,
          fullName: input.fullName,
          phone: input.phone,
          passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
          mustChangePassword: true,
        },
      });
    }
    const userId = user.id;
    const membership = await this.prisma.withTenant(t, async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: t.tenantId, userId } },
      });
      if (existing) throw new ConflictException("Kullanıcı zaten ekipte");
      const m = await tx.membership.create({
        data: { tenantId: t.tenantId, userId, role: input.role },
      });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "member.invited",
        entity: "Membership",
        entityId: m.id,
        metadata: { role: input.role },
      });
      return m;
    });
    return { membership, temporaryPassword };
  }

  update(t: TenantInfo, membershipId: string, input: { role?: Role; isActive?: boolean }) {
    return this.prisma.withTenant(t, async (tx) => {
      const m = await tx.membership.findUnique({ where: { id: membershipId } });
      if (!m) throw new NotFoundException("Üye bulunamadı");
      if (m.userId === t.userId) throw new ForbiddenException("Kendi rolünüzü değiştiremezsiniz");
      if (m.role === "OWNER" && t.role !== "OWNER") throw new ForbiddenException("Yetkiniz yok");
      if (input.role) this.assertCanAssign(t.role, input.role);
      const updated = await tx.membership.update({ where: { id: membershipId }, data: input });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "member.updated",
        entity: "Membership",
        entityId: membershipId,
        metadata: input,
      });
      return updated;
    });
  }
}
