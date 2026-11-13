import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { createDemoSalon, DemoSetupError, generatePassword } from "../src/cli/create-demo-salon.lib";
import { createApp, createTenantWithUser, futureAt, owner, resetDb } from "./helpers";
import { portal } from "./portal-helpers";

describe("Demo salon (mağaza incelemesi)", () => {
  const su = owner();
  // Canlıdaki gibi platform rolüyle çalışır (sahip/süper kullanıcı değil)
  const platform = new PrismaClient({ datasourceUrl: process.env.PLATFORM_DATABASE_URL });
  const tenantDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
  const dbs = { platform, tenant: tenantDb };
  let app: INestApplication;
  let firstPassword = "";
  const http = () => request(app.getHttpServer());
  const loginStatus = (email: string, password: string) => http().post("/auth/login").send({ email, password }).then((r) => r.status);

  beforeAll(async () => {
    await resetDb(su);
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
    await platform.$disconnect();
    await tenantDb.$disconnect();
  });

  it("parola üreteci harf ve rakam içerir, tahmin edilemez", () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z2-9]{18}$/);
    expect(a).toMatch(/[0-9]/);
    expect(generatePassword()).not.toBe(a);
  });

  it("gerçek veri olmadan salon, sahip, hizmet, personel ve portal bayraklarını oluşturur; sahip parolayla giriş yapar", async () => {
    const r = await createDemoSalon(dbs);
    expect(r.status).toBe("created");
    expect(r.password).toBeTruthy();
    firstPassword = r.password!;
    const t = await su.tenant.findUniqueOrThrow({ where: { slug: "demo-salon" } });
    expect(t.status).toBe("TRIAL");
    expect(t.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 700 * 86_400_000);
    expect(await su.customer.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await su.appointment.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await su.service.count({ where: { tenantId: t.id } })).toBe(4);
    expect(await su.workingHour.count({ where: { tenantId: t.id } })).toBe(12);
    const info = await http().get("/public/salons/demo-salon/app").expect(200);
    expect(info.body.features.portal).toBe(true);
    await http().get("/public/salons/demo-salon").expect(200);
    expect(await loginStatus("demo-isletme@proguzellik.com", r.password!)).toBe(200);
  });

  it("tekrar çalıştırmada çoğaltmaz ve parolayı değiştirmez; --reset-password yeni parola verir, eskisi geçmez", async () => {
    const again = await createDemoSalon(dbs);
    expect(again.status).toBe("exists");
    expect(again.password).toBeUndefined();
    expect(await su.tenant.count({ where: { slug: { startsWith: "demo-salon" } } })).toBe(1);
    const reset = await createDemoSalon(dbs, {}, { resetPassword: true });
    expect(reset.password).toBeTruthy();
    expect(await loginStatus("demo-isletme@proguzellik.com", firstPassword)).toBe(401);
    expect(await loginStatus("demo-isletme@proguzellik.com", reset.password!)).toBe(200);
  });

  it("inceleme ekibinin yolu: sabit kodla giriş, randevu, Randevularım, hesap silme, yeniden giriş", async () => {
    const env = loadEnv();
    const before = { REVIEW_LOGIN_SLUG: env.REVIEW_LOGIN_SLUG, REVIEW_LOGIN_EMAIL: env.REVIEW_LOGIN_EMAIL, REVIEW_LOGIN_CODE: env.REVIEW_LOGIN_CODE };
    const email = "demo-musteri@proguzellik.com";
    const code = "731942";
    Object.assign(env, { REVIEW_LOGIN_SLUG: "demo-salon", REVIEW_LOGIN_EMAIL: email, REVIEW_LOGIN_CODE: code });
    const slug = "demo-salon";
    const signIn = async () => {
      await http().post(`/public/salons/${slug}/portal/otp`).send({ email }).expect(202);
      return (await http().post(`/public/salons/${slug}/portal/verify`).send({ email, code }).expect(200)).body.token as string;
    };
    try {
      const info = await http().get(`/public/salons/${slug}/app`).expect(200);
      expect(info.body.features).toMatchObject({ portal: true, packages: true });
      const token = await signIn();
      const t = await su.tenant.findUniqueOrThrow({ where: { slug } });
      const service = await su.service.findFirstOrThrow({ where: { tenantId: t.id, name: "Manikür" } });
      // En yakın iş günü (Pazar kapalı), 11:00
      let d = 3;
      while (new Date(futureAt(d, "11:00")).getUTCDay() === 0) d++;
      const r = await portal(app, slug, token).post("/bookings").set("Idempotency-Key", "demo-review-0001")
        .send({ firstName: "Demo", lastName: "Müşteri", phone: "0532 000 00 00", kvkkConsent: true, serviceId: service.id, startsAt: futureAt(d, "11:00") }).expect(201);
      expect(r.body.status).toBe("BOOKED");
      const mine = await portal(app, slug, token).get("/appointments").expect(200);
      expect(JSON.stringify(mine.body)).toContain(r.body.bookingId);
      // Hesap silme: yeni kod istenir, sabit kod geçer
      await portal(app, slug, token).post("/otp").send({ email }).expect(202);
      await portal(app, slug, token).post("/me/delete").send({ code }).expect(200);
      await portal(app, slug, token).get("/me").expect(401);
      expect(await su.customerIdentity.count({ where: { tenantId: t.id } })).toBe(0);
      // Tekrar giriş çalışır (inceleme ekibi yeniden deneyebilir)
      await portal(app, slug, await signIn()).get("/me").expect(200);
    } finally {
      Object.assign(env, before);
    }
  });

  it("adres veya e-posta başka işletmeye aitse hiçbir şey değiştirmez", async () => {
    const other = await createTenantWithUser(su, { name: "Gerçek Salon", email: "gercek@test.local" });
    await expect(createDemoSalon(dbs, { slug: other.tenant.slug })).rejects.toBeInstanceOf(DemoSetupError);
    await expect(createDemoSalon(dbs, { slug: "demo-iki", ownerEmail: "gercek@test.local" })).rejects.toBeInstanceOf(DemoSetupError);
    expect(await su.tenant.findUnique({ where: { slug: "demo-iki" } })).toBeNull();
  });
});
