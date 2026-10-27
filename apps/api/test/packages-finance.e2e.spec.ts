import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

const RANGE = `from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`;

describe("Paket/seans ve kasa (gelir-gider, tahsilat, iade, prim)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let tplId: string, pkgId: string;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    s = await setupSalon(a);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("paket şablonu oluşturulur ve müşteriye peşinatla satılır", async () => {
    tplId = (await a.post("/package-templates").send({ name: "6 Seans Lazer", serviceId: s.service.id, sessionCount: 3, price: 4500, validityDays: 180 }).expect(201)).body.id;
    const pkg = await a
      .post("/customer-packages")
      .send({ customerId: s.customer.id, templateId: tplId, payment: { amount: 2000, method: "CARD" } })
      .expect(201);
    pkgId = pkg.body.id;
    expect(pkg.body).toMatchObject({ totalSessions: 3, usedSessions: 0, status: "ACTIVE", price: "4500" });
    const bal = await a.get(`/customers/${s.customer.id}/balance`).expect(200);
    expect(bal.body).toMatchObject({ charges: "4500.00", payments: "2000.00", balance: "2500.00" });
  });

  it("tahsilat paket tutarını aşamaz", async () => {
    await a.post("/customer-packages").send({ customerId: s.customer.id, templateId: tplId, payment: { amount: 5000, method: "CASH" } }).expect(400);
  });

  it("paketli randevu ücretsiz oluşur; seans sayısı rezervasyonla sınırlanır", async () => {
    const ids: string[] = [];
    for (const [i, hh] of ["10:00", "11:00", "12:00"].entries()) {
      const r = await a
        .post("/appointments")
        .send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3 + i, hh), customerPackageId: pkgId })
        .expect(201);
      expect(r.body.price).toBe("0");
      ids.push(r.body.id);
    }
    await a
      .post("/appointments")
      .send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(8, "10:00"), customerPackageId: pkgId })
      .expect(409);
    await a.post(`/appointments/${ids[0]}/status`).send({ status: "COMPLETED" }).expect(201);
    await a.post(`/appointments/${ids[1]}/status`).send({ status: "COMPLETED" }).expect(201);
    const pk = await a.get(`/customers/${s.customer.id}/packages`).expect(200);
    expect(pk.body[0]).toMatchObject({ usedSessions: 2, status: "ACTIVE" });
    expect(pk.body[0].usages).toHaveLength(2);
    await a.post(`/appointments/${ids[2]}/status`).send({ status: "COMPLETED" }).expect(201);
    const done = await a.get(`/customers/${s.customer.id}/packages`).expect(200);
    expect(done.body[0]).toMatchObject({ usedSessions: 3, status: "COMPLETED" });
  });

  it("paket başka müşteri veya hizmet için kullanılamaz", async () => {
    const other = (await a.post("/customers").send({ firstName: "Zeynep", lastName: "Test" }).expect(201)).body;
    const pkg2 = (await a.post("/customer-packages").send({ customerId: s.customer.id, templateId: tplId }).expect(201)).body;
    await a
      .post("/appointments")
      .send({ customerId: other.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(9, "10:00"), customerPackageId: pkg2.id })
      .expect(404);
  });

  let incomeId: string;
  it("randevu tahsilatı personel bilgisiyle kaydedilir", async () => {
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(2, "14:00") }).expect(201)).body;
    await a.post(`/appointments/${appt.id}/status`).send({ status: "COMPLETED" }).expect(201);
    const pay = await a.post("/finance/payments").send({ customerId: s.customer.id, appointmentId: appt.id, amount: 1000, method: "CASH" }).expect(201);
    incomeId = pay.body.id;
    expect(pay.body.staffId).toBe(s.staff2.id);
  });

  it("kısmi iadeler kalan tutarı aşamaz; giderler kaydedilir", async () => {
    await a.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 300, reason: "Memnuniyetsizlik" }).expect(201);
    await a.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 800, reason: "Fazla iade" }).expect(409);
    await a.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 700, reason: "Kalan" }).expect(201);
    await a.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 1, reason: "Yine" }).expect(409);
    await a.post("/finance/transactions").send({ type: "EXPENSE", category: "kira", amount: 500, method: "TRANSFER" }).expect(201);
  });

  it("eşzamanlı iadeler toplamda gelir tutarını aşamaz", async () => {
    const pay = (await a.post("/finance/payments").send({ customerId: s.customer.id, amount: 100, method: "CARD" }).expect(201)).body;
    const results = await Promise.all(
      [1, 2, 3].map(() => a.post(`/finance/transactions/${pay.id}/refund`).send({ amount: 60, reason: "Eşzamanlı" })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const sum = await su.financeTransaction.aggregate({ where: { refundOfId: pay.id }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(60);
  });

  it("kasa özeti doğru hesaplanır", async () => {
    const r = await a.get(`/finance/summary?${RANGE}`).expect(200);
    expect(r.body).toMatchObject({ income: "3100.00", expense: "500.00", refund: "1060.00", net: "1540.00" });
    expect(r.body.byMethod).toMatchObject({ CARD: "2040.00", CASH: "0.00", TRANSFER: "-500.00" });
  });

  it("prim raporu: paketli seans değeri ve normal randevu", async () => {
    const r = await a.get(`/finance/commissions?${RANGE}`).expect(200);
    const elif = r.body.find((x: any) => x.staffName === "Elif");
    const merve = r.body.find((x: any) => x.staffName === "Merve");
    expect(elif).toMatchObject({ appointments: 3, revenue: "4500.00", earned: "450.00", due: "450.00" });
    expect(merve).toMatchObject({ appointments: 1, revenue: "1000.00", earned: "200.00" });
    await a.post("/finance/transactions").send({ type: "EXPENSE", category: "PRIM", amount: 150, method: "CASH", staffId: s.staff.id }).expect(201);
    const after = await a.get(`/finance/commissions?${RANGE}`).expect(200);
    expect(after.body.find((x: any) => x.staffName === "Elif")).toMatchObject({ paid: "150.00", due: "300.00" });
  });

  it("mali kayıtlar uygulama rolüyle değiştirilemez/silinemez", async () => {
    const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    const run = (fn: (tx: any) => Promise<unknown>) =>
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
        return fn(tx);
      });
    await expect(run((tx) => tx.financeTransaction.updateMany({ data: { amount: 1 } }))).rejects.toThrow(/permission denied/i);
    await expect(run((tx) => tx.financeTransaction.deleteMany({}))).rejects.toThrow(/permission denied/i);
    await appDb.$disconnect();
  });

  it("RECEPTION tahsilat alabilir ama iade/gider/prim yapamaz", async () => {
    const inv = await a.post("/team").send({ email: "r@test.local", fullName: "Resepsiyon", role: "RECEPTION" }).expect(201);
    const r = api(app, await login(app, "r@test.local", inv.body.temporaryPassword), A.tenant.id);
    await r.post("/finance/payments").send({ customerId: s.customer.id, amount: 50, method: "CASH" }).expect(201);
    await r.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 1, reason: "Deneme" }).expect(403);
    await r.post("/finance/transactions").send({ type: "EXPENSE", category: "X", amount: 1, method: "CASH" }).expect(403);
    await r.get(`/finance/commissions?${RANGE}`).expect(403);
  });

  it("B, A'nın kasasını ve paketlerini göremez/kullanamaz", async () => {
    await b.post(`/finance/transactions/${incomeId}/refund`).send({ amount: 1, reason: "Saldırı" }).expect(404);
    await b.post("/finance/payments").send({ customerId: s.customer.id, amount: 10, method: "CASH" }).expect(404);
    await b.post("/customer-packages").send({ customerId: s.customer.id, templateId: tplId }).expect(404);
    const sum = await b.get(`/finance/summary?${RANGE}`).expect(200);
    expect(sum.body.income).toBe("0.00");
    expect((await b.get(`/finance/transactions?${RANGE}`).expect(200)).body).toEqual([]);
  });

  it("müşteri geçmişi randevu, paket, ödeme ve bakiyeyi içerir", async () => {
    const h = await a.get(`/customers/${s.customer.id}/history`).expect(200);
    expect(h.body.appointments.length).toBe(4);
    expect(h.body.packages.length).toBe(2);
    expect(h.body.transactions.length).toBeGreaterThanOrEqual(5);
    expect(h.body.balance.customerId).toBe(s.customer.id);
  });
});
