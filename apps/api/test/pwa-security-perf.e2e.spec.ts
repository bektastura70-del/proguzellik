import { INestApplication } from "@nestjs/common";
import { createHash } from "node:crypto";
import request from "supertest";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";
import { enablePwa, portal, portalLogin } from "./portal-helpers";

/** PWA V1.0 güvenlik ve performans denetimleri (Faz 6). */
describe("PWA güvenlik ve performans", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  const timings: Record<string, number> = {};

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Guvenlik A", email: "gva@test.local" });
    app = await createApp();
    a = api(app, await login(app, "gva@test.local"), A.tenant.id);
    s = await setupSalon(a, { duration: 30 });
    await enablePwa(su, A.tenant.id, { businessPwaEnabled: true });
  });
  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log("PWA uç nokta süreleri (ms):", JSON.stringify(timings));
    await app.close();
    await su.$disconnect();
  });

  it("doğrulama kodu isteği: kayıtlı/kayıtsız e-postaya aynı yanıt (hesap varlığı sızmaz); aynı adrese 5'ten fazla istek sınırlanır", async () => {
    const http = () => request(app.getHttpServer());
    const known = await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "gva@test.local" });
    const unknown = await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "hic-yok@test.local" });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(known.body).toEqual(unknown.body);
    process.env.DISABLE_RATE_LIMIT = "0";
    try {
      for (let i = 0; i < 5; i++) await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "limit@test.local" }).expect(202);
      await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "limit@test.local" }).expect(429);
      // Kod doğrulama denemesi de IP başına sınırlı (kaba kuvvet)
      for (let i = 0; i < 30; i++) await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email: "kaba@test.local", code: "000000" });
      await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email: "kaba@test.local", code: "000000" }).expect(429);
    } finally {
      process.env.DISABLE_RATE_LIMIT = "1";
    }
  });

  it("oturum belirteci veritabanında yalnızca özetiyle tutulur; süresi dolan oturum reddedilir", async () => {
    const token = await portalLogin(app, A.tenant.slug, "oturum@test.local");
    const hash = createHash("sha256").update(token).digest("hex");
    const row = await su.customerPortalSession.findFirstOrThrow({ where: { tokenHash: hash } });
    expect(JSON.stringify(row)).not.toContain(token);
    await portal(app, A.tenant.slug, token).get("/me").expect(200);
    await su.customerPortalSession.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await portal(app, A.tenant.slug, token).get("/me").expect(401);
    await portal(app, A.tenant.slug, "uydurma-belirtec-0123456789").get("/me").expect(401);
  });

  it("müşteri kaydı anonimleştirilince e-posta eşleşmesiyle eski randevular portalda görünmez", async () => {
    const c = (await a.post("/customers").send({ firstName: "Silinecek", lastName: "Kisi", phone: "05449990011", email: "silinecek@test.local" }).expect(201)).body;
    await a.post("/appointments").send({ customerId: c.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(2, "10:00") }).expect(201);
    const token = await portalLogin(app, A.tenant.slug, "silinecek@test.local");
    expect((await portal(app, A.tenant.slug, token).get("/appointments").expect(200)).body.upcoming).toHaveLength(1);
    await a.post(`/customers/${c.id}/anonymize`).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await portal(app, A.tenant.slug, token).get("/appointments").expect(200)).body.upcoming).toHaveLength(0);
  });

  it("görsel türünde gövdeyle JSON uç noktasına istek 500 değil 400 döner", async () => {
    await a.post("/customers").set("Content-Type", "image/png").send(Buffer.from([0x89, 0x50, 0x4e, 0x47])).expect(400);
    await request(app.getHttpServer()).post(`/public/salons/${A.tenant.slug}/portal/otp`).set("Content-Type", "image/png").send(Buffer.from("x")).expect(400);
  });

  it("performans: 600 randevulu işletmede mobil panel ve portal uçları hızlı yanıt verir", async () => {
    const email = "yogun@test.local";
    const cust = (await a.post("/customers").send({ firstName: "Yogun", lastName: "Musteri", phone: "05440001122", email }).expect(201)).body;
    const others = await Promise.all(
      Array.from({ length: 20 }, (_, i) => a.post("/customers").send({ firstName: `M${i}`, lastName: "Test", phone: `0544${String(1000000 + i)}` }).then((r) => r.body.id as string)),
    );
    // 30 gün × 2 personel × 10 saat dilimi = 600 randevu (çakışmasız)
    const data = [];
    const base = new Date(futureAt(1, "09:00")).getTime();
    for (let d = 0; d < 30; d++) {
      for (const staffId of [s.staff.id, s.staff2.id]) {
        for (let k = 0; k < 10; k++) {
          const startsAt = new Date(base + d * 86_400_000 + k * 30 * 60_000);
          const mine = d % 6 === 0 && k === 0 && staffId === s.staff.id;
          data.push({ tenantId: A.tenant.id, customerId: mine ? cust.id : others[(d + k) % others.length], staffId, serviceId: s.service.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), price: 100, source: "PANEL" as const });
        }
      }
    }
    await su.appointment.createMany({ data });
    const token = await portalLogin(app, A.tenant.slug, email);
    const day = new Date(base + 2 * 86_400_000).toISOString().slice(0, 10);
    const measure = async (name: string, fn: () => Promise<unknown>) => {
      await fn(); // ısınma
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) await fn();
      timings[name] = Math.round((performance.now() - t0) / 5);
    };
    await measure("panel_gunluk_plan", () => a.get(`/pwa/agenda?date=${day}`).expect(200));
    await measure("panel_onay_bekleyen", () => a.get("/pwa/pending").expect(200));
    await measure("portal_randevularim", () => portal(app, A.tenant.slug, token).get("/appointments").expect(200));
    await measure("portal_paketlerim", () => portal(app, A.tenant.slug, token).get("/packages").expect(200));
    await measure("uygulama_bilgisi", () => request(app.getHttpServer()).get(`/public/salons/${A.tenant.slug}/app`).expect(200));
    await measure("bos_saatler", () => request(app.getHttpServer()).get(`/public/salons/${A.tenant.slug}/availability?serviceId=${s.service.id}&date=${day}`).expect(200));
    const mine = (await portal(app, A.tenant.slug, token).get("/appointments").expect(200)).body;
    expect(mine.upcoming.length + mine.past.length).toBe(5);
    for (const [k, v] of Object.entries(timings)) expect({ k, v: v < 400 }).toEqual({ k, v: true });
  });
});
