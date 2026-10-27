import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";

/** Süper kullanıcı (migration sahibi) bağlantısı: yalnızca test kurulumu için. */
export const owner = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export async function resetDb(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
}

export const TEST_PASSWORD = "TestParola123";
let hash: string | undefined;

export async function createTenantWithUser(
  db: PrismaClient,
  opts: { name: string; email: string; role?: Role; status?: "TRIAL" | "ACTIVE"; platformAdmin?: boolean },
) {
  hash ??= await bcrypt.hash(TEST_PASSWORD, 4);
  const tenant = await db.tenant.create({
    data: {
      name: opts.name,
      slug: opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 6),
      status: opts.status ?? "ACTIVE",
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
    },
  });
  const user = await db.user.create({
    data: { email: opts.email, passwordHash: hash, fullName: opts.name + " Yetkili", isPlatformAdmin: !!opts.platformAdmin },
  });
  await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: opts.role ?? "OWNER" } });
  return { tenant, user };
}

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(mod.createNestApplication());
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: string, password = TEST_PASSWORD) {
  const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
  return res.body.accessToken as string;
}

/** Oturumlu ve işletme bağlamlı istek yardımcısı. */
export function api(app: INestApplication, token: string, tenantId?: string) {
  const server = app.getHttpServer();
  const wrap = (r: request.Test) => {
    r.set("Authorization", `Bearer ${token}`);
    if (tenantId) r.set("X-Tenant-Id", tenantId);
    return r;
  };
  return {
    get: (url: string) => wrap(request(server).get(url)),
    post: (url: string) => wrap(request(server).post(url)),
    patch: (url: string) => wrap(request(server).patch(url)),
    put: (url: string) => wrap(request(server).put(url)),
    delete: (url: string) => wrap(request(server).delete(url)),
  };
}

export const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 540, endMin: 1080 }));

/** Bir hizmet, iki personel (çalışma saatli) ve bir müşteri oluşturur. */
export async function setupSalon(a: ReturnType<typeof api>, opts: { price?: number; duration?: number } = {}) {
  const service = (await a.post("/services").send({ name: "Lazer Epilasyon", durationMin: opts.duration ?? 30, price: opts.price ?? 1000 }).expect(201)).body;
  const staff = (await a.post("/staff").send({ displayName: "Elif", commissionRate: 10 }).expect(201)).body;
  const staff2 = (await a.post("/staff").send({ displayName: "Merve", commissionRate: 20 }).expect(201)).body;
  for (const s of [staff, staff2]) {
    await a.put(`/staff/${s.id}/services`).send({ serviceIds: [service.id] }).expect(200);
    await a.put(`/staff/${s.id}/working-hours`).send({ hours: ALL_WEEK }).expect(200);
  }
  const customer = (await a.post("/customers").send({ firstName: "Ayşe", lastName: "Test", phone: "05550000001" }).expect(201)).body;
  return { service, staff, staff2, customer };
}

/** Bugünden n gün sonrası, İstanbul saatiyle hh:mm */
export function futureAt(daysAhead: number, hhmm: string) {
  const { zonedTime } = require("../src/common/time") as typeof import("../src/common/time");
  const day = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(day, h * 60 + m, "Europe/Istanbul").toISOString();
}
