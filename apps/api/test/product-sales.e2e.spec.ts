import { INestApplication } from "@nestjs/common";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb, setupSalon, TEST_PASSWORD } from "./helpers";

const RANGE = `from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`;

describe("Ürün satış fişi, iade, prim ve rapor", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let sampuan: string, maske: string, sarf: string;
  let sale: any;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    s = await setupSalon(a, { price: 800 });
    sampuan = (await a.post("/products").send({ name: "Şampuan", kind: "RETAIL", salePrice: 300, costPrice: 120, initialQty: 10 }).expect(201)).body.id;
    maske = (await a.post("/products").send({ name: "Saç Maskesi", kind: "RETAIL", salePrice: 500, costPrice: 200, initialQty: 4 }).expect(201)).body.id;
    sarf = (await a.post("/products").send({ name: "Jel", kind: "CONSUMABLE", initialQty: 100 }).expect(201)).body.id;
    await a.patch(`/staff/${s.staff.id}`).send({ productCommissionRate: 10 }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  const qtyOf = async (id: string) => (await su.product.findUniqueOrThrow({ where: { id } })).stockQty.toString();

  it("çok ürünlü fiş: tek kasa kaydı, satırlar, satan personel, indirimli fiyat", async () => {
    const r = await a
      .post("/product-sales")
      .send({ items: [{ productId: sampuan, qty: 2 }, { productId: maske, qty: 1, unitPrice: 450 }], method: "CARD", customerId: s.customer.id, staffId: s.staff.id })
      .expect(201);
    expect(r.body).toMatchObject({ type: "INCOME", category: "URUN_SATISI", amount: "1050", staffId: s.staff.id, customerId: s.customer.id });
    sale = r.body.sale;
    expect(sale).toMatchObject({ total: "1050", netTotal: "1050.00", staff: { displayName: s.staff.displayName } });
    expect(sale.items).toHaveLength(2);
    expect(sale.items.find((i: any) => i.productId === maske)).toMatchObject({ unitPrice: "450", unitCost: "200", lineTotal: "450" });
    expect(await qtyOf(sampuan)).toBe("8");
    expect(await qtyOf(maske)).toBe("3");
    const mv = await su.stockMovement.findMany({ where: { productSaleId: sale.id } });
    expect(mv).toHaveLength(2);
  });

  it("fişteki bir ürün yetersizse hiçbir şey kaydedilmez", async () => {
    const before = await su.financeTransaction.count();
    await a.post("/product-sales").send({ items: [{ productId: sampuan, qty: 1 }, { productId: maske, qty: 99 }], method: "CASH" }).expect(409);
    expect(await su.financeTransaction.count()).toBe(before);
    expect(await qtyOf(sampuan)).toBe("8");
  });

  it("sarf malzemesi, başka işletmenin personeli ve boş fiş reddedilir", async () => {
    await a.post("/product-sales").send({ items: [{ productId: sarf, qty: 1 }], method: "CASH" }).expect(400);
    await a.post("/product-sales").send({ items: [], method: "CASH" }).expect(400);
    const bStaff = (await b.post("/staff").send({ displayName: "B Personel" }).expect(201)).body.id;
    await a.post("/product-sales").send({ items: [{ productId: sampuan, qty: 1 }], method: "CASH", staffId: bStaff }).expect(404);
  });

  it("kasadan genel iade ürün satışında engellenir", async () => {
    const r = await a.post(`/finance/transactions/${sale.financeTransactionId}/refund`).send({ amount: 100, reason: "deneme" }).expect(409);
    expect(r.body.code).toBe("USE_PRODUCT_RETURN");
  });

  it("ürün iadesi: kasaya iade, stoğa geri giriş; hasarlı ürün stoğa girmez", async () => {
    const sh = sale.items.find((i: any) => i.productId === sampuan);
    const mk = sale.items.find((i: any) => i.productId === maske);
    const r = await a
      .post(`/product-sales/${sale.id}/returns`)
      .send({ items: [{ saleItemId: sh.id, qty: 1 }, { saleItemId: mk.id, qty: 1, restock: false }], reason: "Müşteri beğenmedi" })
      .expect(201);
    expect(r.body).toMatchObject({ returnedTotal: "750.00", netTotal: "300.00" });
    expect(await qtyOf(sampuan)).toBe("9");
    expect(await qtyOf(maske)).toBe("3");
    const refund = await su.financeTransaction.findFirstOrThrow({ where: { refundOfId: sale.financeTransactionId } });
    expect(refund).toMatchObject({ type: "REFUND", category: "IADE" });
    expect(refund.amount.toString()).toBe("750");
    // Kalan adetten fazlası iade edilemez
    await a.post(`/product-sales/${sale.id}/returns`).send({ items: [{ saleItemId: mk.id, qty: 1 }], reason: "tekrar" }).expect(409);
    await a.post(`/product-sales/${sale.id}/returns`).send({ items: [{ saleItemId: sh.id, qty: 2 }], reason: "fazla" }).expect(409);
  });

  it("eşzamanlı iadeler satılan adedi aşamaz", async () => {
    const x = (await a.post("/product-sales").send({ items: [{ productId: sampuan, qty: 1 }], method: "CASH" }).expect(201)).body.sale;
    const res = await Promise.all([1, 2, 3].map(() => a.post(`/product-sales/${x.id}/returns`).send({ items: [{ saleItemId: x.items[0].id, qty: 1 }], reason: "aynı anda" })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await su.productSaleReturnLine.count({ where: { saleItemId: x.items[0].id } })).toBe(1);
  });

  it("personel primine ürün satışı (iadeler düşülerek) eklenir", async () => {
    const r = await a.get(`/finance/commissions?${RANGE}`).expect(200);
    const me = r.body.find((c: any) => c.staffId === s.staff.id);
    expect(me).toMatchObject({ productRate: "10", productSales: 1, productRevenue: "300.00", productEarned: "30.00", earned: "30.00", due: "30.00" });
  });

  it("ürün satış raporu: adet, net ciro, maliyet, kâr", async () => {
    const r = await a.get(`/product-sales/report?${RANGE}`).expect(200);
    expect(r.body.saleCount).toBe(2);
    const sh = r.body.products.find((p: any) => p.productId === sampuan);
    // 3 satıldı (2+1), 2 iade edildi; ciro 900-600=300, maliyet 120×3-120×2=120
    expect(sh).toMatchObject({ soldQty: "3", returnedQty: "2", revenue: "300.00", cost: "120.00", profit: "180.00" });
    const mk = r.body.products.find((p: any) => p.productId === maske);
    // 1 satıldı 450, iade 450 (stoğa girmedi → maliyet kalır)
    expect(mk).toMatchObject({ soldQty: "1", returnedQty: "1", revenue: "0.00", cost: "200.00", profit: "-200.00" });
  });

  it("satış listesi ve detay; B göremez", async () => {
    const list = await a.get(`/product-sales?${RANGE}`).expect(200);
    expect(list.body).toHaveLength(2);
    await a.get(`/product-sales/${sale.id}`).expect(200);
    await b.get(`/product-sales/${sale.id}`).expect(404);
    expect((await b.get(`/product-sales?${RANGE}`).expect(200)).body).toEqual([]);
    await b.post(`/product-sales/${sale.id}/returns`).send({ items: [{ saleItemId: sale.items[0].id, qty: 1 }], reason: "B dener" }).expect(404);
  });

  it("resepsiyon satış yapar ama iade ve rapor göremez", async () => {
    await addMember(app, a, { email: "r@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    const r = api(app, await login(app, "r@test.local", TEST_PASSWORD), A.tenant.id);
    await r.post("/product-sales").send({ items: [{ productId: sampuan, qty: 1 }], method: "CASH" }).expect(201);
    await r.get(`/product-sales/report?${RANGE}`).expect(403);
    await r.post(`/product-sales/${sale.id}/returns`).send({ items: [{ saleItemId: sale.items[0].id, qty: 1 }], reason: "deneme" }).expect(403);
  });

  it("fiş ve iade kayıtları uygulama rolüyle değiştirilemez", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    for (const op of [
      (tx: any) => tx.productSale.updateMany({ data: { total: 0 } }),
      (tx: any) => tx.productSaleItem.deleteMany({}),
      (tx: any) => tx.productSaleReturnLine.deleteMany({}),
    ]) {
      await expect(
        appDb.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
          return op(tx);
        }),
      ).rejects.toThrow(/permission denied/i);
    }
    await appDb.$disconnect();
  });
});
