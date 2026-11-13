import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createDemoSalon, DemoSetupError, generatePassword } from "../src/cli/create-demo-salon.lib";
import { createApp, createTenantWithUser, owner, resetDb } from "./helpers";

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

  it("adres veya e-posta başka işletmeye aitse hiçbir şey değiştirmez", async () => {
    const other = await createTenantWithUser(su, { name: "Gerçek Salon", email: "gercek@test.local" });
    await expect(createDemoSalon(dbs, { slug: other.tenant.slug })).rejects.toBeInstanceOf(DemoSetupError);
    await expect(createDemoSalon(dbs, { slug: "demo-iki", ownerEmail: "gercek@test.local" })).rejects.toBeInstanceOf(DemoSetupError);
    expect(await su.tenant.findUnique({ where: { slug: "demo-iki" } })).toBeNull();
  });
});
