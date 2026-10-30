import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { loadEnv, pricingPublic, productionIssues } from "../src/config/env";
import { api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

describe("Fiyatlar açıklanmadan gizlidir", () => {
  it("tanımsızsa canlıda kapalı, diğer ortamlarda açıktır; açık değer önceliklidir", () => {
    expect(pricingPublic({ NODE_ENV: "production", PRICING_PUBLIC: undefined })).toBe(false);
    expect(pricingPublic({ NODE_ENV: "production", PRICING_PUBLIC: "0" })).toBe(false);
    expect(pricingPublic({ NODE_ENV: "production", PRICING_PUBLIC: "1" })).toBe(true);
    expect(pricingPublic({ NODE_ENV: "test", PRICING_PUBLIC: undefined })).toBe(true);
    expect(pricingPublic({ NODE_ENV: "test", PRICING_PUBLIC: "0" })).toBe(false);
    expect(productionIssues({ ...loadEnv(), PRICING_PUBLIC: "1" }, {}).some((i) => /PRICING_PUBLIC/.test(i.message))).toBe(true);
  });

  describe("PRICING_PUBLIC=0", () => {
    const su = owner();
    let app: INestApplication;
    let t: ReturnType<typeof api>;
    let tenantId: string;
    const env = loadEnv();
    const before = env.PRICING_PUBLIC;

    beforeAll(async () => {
      await resetDb(su);
      const T = await createTenantWithUser(su, { name: "Fiyat Salonu", email: "fiyat@test.local", status: "TRIAL" });
      tenantId = T.tenant.id;
      app = await createApp();
      t = api(app, await login(app, "fiyat@test.local"), tenantId);
      Object.assign(env, { PRICING_PUBLIC: "0" });
    });
    afterAll(async () => {
      Object.assign(env, { PRICING_PUBLIC: before });
      await app.close();
      await su.$disconnect();
    });

    it("herkese açık paket listesinde tutar yoktur; ad, sınır ve özellikler vardır", async () => {
      const r = await request(app.getHttpServer()).get("/plans").expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      for (const p of r.body) {
        expect(p).toMatchObject({ monthlyPrice: null, yearlyPrice: null });
        expect(p.name).toBeTruthy();
        expect(p.maxStaff).toBeGreaterThan(0);
      }
      expect(JSON.stringify(r.body)).not.toMatch(/499|999|1799/);
      const site = await request(app.getHttpServer()).get("/public/site").expect(200);
      expect(site.body.pricesAnnounced).toBe(false);
    });

    it("satın alma yapılamaz; abonelik oluşmaz; işletme panelinde online ödeme kapalı görünür", async () => {
      const r = await t.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(503);
      expect(r.body.code).toBe("PRICING_NOT_ANNOUNCED");
      expect(await su.subscription.count({ where: { tenantId } })).toBe(0);
      expect(await su.subscriptionPayment.count({ where: { tenantId } })).toBe(0);
      expect((await t.get("/subscription").expect(200)).body.onlinePayment).toBe(false);
    });

    it("fiyatlar veritabanında korunur (SaaS sahibi panelinde görünür)", async () => {
      expect(Number((await su.plan.findUniqueOrThrow({ where: { code: "STARTER" } })).monthlyPrice)).toBeGreaterThan(0);
    });
  });
});
