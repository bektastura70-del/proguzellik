import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService, Tx } from "../prisma/prisma.service";

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kiracı transaction'ı içinden kayıt (RLS altında). */
  log(tx: Tx, entry: AuditEntry) {
    return tx.auditLog.create({ data: entry });
  }

  /** Platform düzeyinde kayıt (giriş denemeleri, SaaS sahibi işlemleri). */
  logPlatform(entry: AuditEntry) {
    return this.prisma.platform.auditLog.create({ data: entry });
  }
}
