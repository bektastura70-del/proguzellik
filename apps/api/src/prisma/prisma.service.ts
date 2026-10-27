import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadEnv } from "../config/env";

export type Tx = Prisma.TransactionClient;

export interface TenantContext {
  tenantId: string;
  userId: string;
}

/**
 * İki ayrı veritabanı bağlantısı:
 *  - tenant  : app_tenant rolü, RLS her zaman uygulanır.
 *  - platform: app_platform rolü, yalnızca giriş ve SaaS sahibi işlemleri için.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly tenant: PrismaClient;
  readonly platform: PrismaClient;

  constructor() {
    const env = loadEnv();
    this.tenant = new PrismaClient({ datasourceUrl: env.APP_DATABASE_URL });
    this.platform = new PrismaClient({ datasourceUrl: env.PLATFORM_DATABASE_URL });
  }

  /**
   * İşlemi tek bir transaction içinde, kiracı bağlamı ayarlanmış olarak çalıştırır.
   * set_config(..., true) yalnızca bu transaction için geçerlidir (SET LOCAL).
   */
  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.tenant.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId}, true)`;
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await Promise.all([this.tenant.$disconnect(), this.platform.$disconnect()]);
  }
}
