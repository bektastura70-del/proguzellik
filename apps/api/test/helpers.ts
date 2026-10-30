import { INestApplication } from "@nestjs/common";
import { Test, TestingModuleBuilder } from "@nestjs/testing";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";

/** Süper kullanıcı (migration sahibi) bağlantısı: yalnızca test kurulumu için. */
export const owner = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export async function resetDb(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'Plan')`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  // Testlerde oluşturulan paketler silinir; seed paketleri (migration ile gelen) kalır.
  await db.plan.deleteMany({ where: { code: { notIn: ["STARTER", "PROFESSIONAL", "SMART"] } } });
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
    data: { email: opts.email, passwordHash: hash, fullName: opts.name + " Yetkili", isPlatformAdmin: !!opts.platformAdmin, emailVerifiedAt: new Date() },
  });
  await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: opts.role ?? "OWNER" } });
  return { tenant, user };
}

export async function createApp(configure?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const mod = await (configure ? configure(builder) : builder).compile();
  const app = configureApp(mod.createNestApplication({ rawBody: true }));
  await app.init();
  return app;
}

/** Giriş yapar; geçici parolalı (davet edilen) kullanıcıda parolayı değiştirip aynı token'ı döner. */
export async function login(app: INestApplication, email: string, password = TEST_PASSWORD) {
  const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
  const token = res.body.accessToken as string;
  if (res.body.user?.mustChangePassword) {
    await request(app.getHttpServer())
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: `${password}Yn1` })
      .expect(200);
  }
  return token;
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

import { currentStep, totp } from "../src/security/crypto";

/**
 * Testte geçerli TOTP kodu üretir. Sunucu aynı 30 sn'lik adımın tekrar kullanımını reddettiği için,
 * zamanın ilerlemesini simüle etmek üzere kullanıcının son kullanılan adımı sıfırlanır (yalnızca test).
 */
export async function freshTotp(email: string, secret: string) {
  const db = owner();
  await db.user.update({ where: { email }, data: { mfaLastStep: null } });
  await db.$disconnect();
  return totp(secret, currentStep());
}
let lastStepUsed = 0;
export const nextTotp = (secret: string) => totp(secret, currentStep());

/** Kullanıcı için 2FA'yı açar ve 2FA ile yeni oturum token'ı döner. */
export async function enableMfa(app: INestApplication, email: string, password = TEST_PASSWORD) {
  const server = app.getHttpServer();
  const t1 = (await request(server).post("/auth/login").send({ email, password }).expect(200)).body.accessToken as string;
  const setup = await request(server).post("/auth/mfa/setup").set("Authorization", `Bearer ${t1}`).send({ password }).expect(200);
  const secret = setup.body.secret as string;
  const en = await request(server).post("/auth/mfa/enable").set("Authorization", `Bearer ${t1}`).send({ code: totp(secret, currentStep()) }).expect(200);
  lastStepUsed = currentStep();
  void lastStepUsed;
  return { token: t1, secret, recoveryCodes: en.body.recoveryCodes as string[] };
}

export async function loginWithMfa(app: INestApplication, email: string, secret: string, password = TEST_PASSWORD) {
  const server = app.getHttpServer();
  const r = await request(server).post("/auth/login").send({ email, password }).expect(200);
  const v = await request(server).post("/auth/mfa/verify").send({ mfaToken: r.body.mfaToken, code: await freshTotp(email, secret) }).expect(200);
  return v.body.accessToken as string;
}

/**
 * İşletme ekibine davet eder ve e-postadaki bağlantıyla hesabı açar (parola: TEST_PASSWORD).
 * Geçici parola yok; davetli parolasını kendisi belirler.
 */
export async function addMember(
  app: INestApplication,
  a: ReturnType<typeof api>,
  body: { email: string; fullName: string; role: "MANAGER" | "RECEPTION" | "STAFF" },
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MockEmailProvider } = require("../src/email/email.provider");
  const res = await a.post("/team").send(body).expect(201);
  const mail = [...app.get(MockEmailProvider).outbox].reverse().find((m: { to: string }) => m.to === body.email.toLowerCase());
  const token = /davet\?token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  if (!token) throw new Error("Davet e-postası bulunamadı");
  await request(app.getHttpServer()).post("/auth/accept-invite").send({ token, password: TEST_PASSWORD, kvkkAccepted: true }).expect(200);
  return res;
}
