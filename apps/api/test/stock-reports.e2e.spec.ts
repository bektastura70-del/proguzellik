import { INestApplication } from "@nestjs/common";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

const RANGE = `from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`;

describe("Stok, sarf malzemeleri ve raporlar", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let gelId: string, kremId: string;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    s = await setupSalon(a, { price: 800 });
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("ürünler açılış stokuyla oluşturulur; stok kodu işletme içinde benzersiz", async () => {
    const gel = await a.post("/products").send({ name: "Lazer Jeli", sku: "JEL-01", unit: "ml", minQty: 100, costPrice: 0.5, initialQty: 300 }).expect(201);
    gelId = gel.body.id;
    expect(gel.body.stockQty).toBe("300");
    kremId = (await a.post("/products").send({ name: "Nemlendirici Krem", sku: "KRM-01", kind: "RETAIL", salePrice: 450, costPrice: 200, initialQty: 5 }).expect(201)).body.id;
    await a.post("/products").send({ name: "Kopya", sku: "JEL-01" }).expect(409);
    await b.post("/products").send({ name: "B Jel", sku: "JEL-01" }).expect(201);
  });

  it("stok girişi/çıkışı; yetersiz stokta çıkış reddedilir", async () => {
    await a.post(`/products/${gelId}/movements`).send({ type: "IN", qty: 50 }).expect(201);
    await a.post(`/products/${gelId}/movements`).send({ type: "OUT", qty: 1000 }).expect(409);
    const r = await a.post(`/products/${gelId}/movements`).send({ type: "ADJUST", qty: -10, note: "Sayım farkı" }).expect(201);
    expect(r.body.product.stockQty).toBe("340");
  });

  it("randevu tamamlanınca sarf malzemesi otomatik düşer", async () => {
    await a.put(`/services/${s.service.id}/consumables`).send({ items: [{ productId: gelId, qty: 120 }] }).expect(200);
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(2, "10:00") }).expect(201)).body;
    await a.post(`/appointments/${appt.id}/status`).send({ status: "COMPLETED" }).expect(201);
    const p = await su.product.findUniqueOrThrow({ where: { id: gelId } });
    expect(p.stockQty.toString()).toBe("220");
    const mv = await a.get(`/products/${gelId}/movements`).expect(200);
    expect(mv.body[0]).toMatchObject({ type: "CONSUME", qty: "-120", appointmentId: appt.id });
  });

  it("perakende satış stoğu düşer ve kasaya gelir yazar", async () => {
    const trx = await a.post("/product-sales").send({ productId: kremId, qty: 2, method: "CARD", customerId: s.customer.id }).expect(201);
    expect(trx.body).toMatchObject({ type: "INCOME", category: "URUN_SATISI", amount: "900" });
    await a.post("/product-sales").send({ productId: kremId, qty: 10, method: "CARD" }).expect(409);
    await a.post("/product-sales").send({ productId: gelId, qty: 1, method: "CARD" }).expect(400);
  });

  it("eşzamanlı satışlar stoğu eksiye düşüremez", async () => {
    const res = await Promise.all([1, 2, 3, 4].map(() => a.post("/product-sales").send({ productId: kremId, qty: 1, method: "CASH" })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    const p = await su.product.findUniqueOrThrow({ where: { id: kremId } });
    expect(p.stockQty.toString()).toBe("0");
  });

  it("stok hareketleri uygulama rolüyle değiştirilemez", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
        return tx.stockMovement.deleteMany({});
      }),
    ).rejects.toThrow(/permission denied/i);
    await appDb.$disconnect();
  });

  it("düşük stok listesi", async () => {
    const low = await a.get("/products?low=true").expect(200);
    expect(low.body.map((p: any) => p.name).sort()).toEqual(["Nemlendirici Krem"]);
  });

  it("B, A'nın ürünlerini göremez ve hareket yazamaz", async () => {
    await b.post(`/products/${gelId}/movements`).send({ type: "IN", qty: 1 }).expect(404);
    await b.put(`/services/${s.service.id}/consumables`).send({ items: [] }).expect(404);
    expect((await b.get("/products").expect(200)).body.map((p: any) => p.name)).toEqual(["B Jel"]);
  });

  it("yönetim paneli raporu doğru özetler", async () => {
    const appt2 = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(3, "11:00") }).expect(201)).body;
    await a.post(`/appointments/${appt2.id}/status`).send({ status: "NO_SHOW" }).expect(201);
    const r = await a.get(`/reports/dashboard?${RANGE}`).expect(200);
    expect(r.body.appointments).toMatchObject({ total: 2, completionRate: 50, noShowRate: 50 });
    expect(r.body.finance).toMatchObject({ income: "2250.00", net: "2250.00", serviceValue: "800.00" });
    expect(r.body.topServices[0]).toMatchObject({ name: "Lazer Epilasyon", count: 1, revenue: "800.00" });
    expect(r.body.staffPerformance).toEqual([expect.objectContaining({ name: "Elif", count: 1 })]);
    expect(r.body.stock.lowStock.map((p: any) => p.name)).toEqual(["Nemlendirici Krem"]);
    expect(r.body.stock.stockValue).toBe("110.00");
  });

  it("günlük gelir serisi", async () => {
    const r = await a.get(`/reports/daily-revenue?${RANGE}`).expect(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].income).toBe("2250.00");
    const rb = await b.get(`/reports/daily-revenue?${RANGE}`).expect(200);
    expect(rb.body).toEqual([]);
  });

  it("raporlar yalnızca OWNER/MANAGER içindir", async () => {
    const inv = await a.post("/team").send({ email: "r@test.local", fullName: "Resepsiyon", role: "RECEPTION" }).expect(201);
    const r = api(app, await login(app, "r@test.local", inv.body.temporaryPassword), A.tenant.id);
    await r.get(`/reports/dashboard?${RANGE}`).expect(403);
  });
});
