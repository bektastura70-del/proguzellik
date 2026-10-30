import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Role } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
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
