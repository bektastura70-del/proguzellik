import { Controller, Get, HttpException, HttpStatus, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";
import { Public } from "../common/decorators";
import { loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("zaman aşımı")), ms))]);

@Public()
@Controller("health")
export class HealthController implements OnModuleDestroy {
  private redis?: IORedis;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  /** Canlılık: süreç ayakta mı? (bağımlılık kontrol etmez) */
  @Get()
  check() {
    return { status: "ok", service: "api", timestamp: new Date().toISOString() };
  }

  /** Hazırlık: veritabanı (iki uygulama rolü) ve Redis erişilebilir mi? Yük dengeleyici bunu kullanmalı. */
  @Get("ready")
  async ready() {
    this.redis ??= new IORedis(loadEnv().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    const checks: Record<string, "ok" | "fail"> = {};
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await withTimeout(fn(), 2000);
        checks[name] = "ok";
      } catch {
        checks[name] = "fail";
      }
    };
    await Promise.all([
      run("database_tenant", () => this.prisma.tenant.$queryRaw`SELECT 1`),
      run("database_platform", () => this.prisma.platform.$queryRaw`SELECT 1`),
      run("redis", async () => {
        if (this.redis!.status === "wait") await this.redis!.connect();
        await this.redis!.ping();
      }),
    ]);
    const ok = Object.values(checks).every((v) => v === "ok");
    const body = { status: ok ? "ok" : "degraded", checks, timestamp: new Date().toISOString() };
    if (!ok) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
