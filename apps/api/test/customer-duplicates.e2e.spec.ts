import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { findDuplicates, mergeCustomers, MergeError } from "../src/cli/customer-duplicates.lib";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

describe("Mükerrer müşteri raporu ve birleştirme betiği", () => {
  const su = owner();
  const platform = new PrismaClient({ datasourceUrl: process.env.PLATFORM_DATABASE_URL });
  const tenantDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let s: Awaited<ReturnType<typeof setupSalon>>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Mukerrer Salon", email: "m@salon.test" });
    B = await createTenantWithUser(su, { name: "Diger Salon", email: "d@salon.test" });
    app = await createApp();
    const a = api(app, await login(app, "m@salon.test"), A.tenant.id);
    s = await setupSalon(a, { duration: 60 });
  });
  afterAll(async () => {
    await app.close();
    await Promise.all([su.$disconnect(), platform.$disconnect(), tenantDb.$disconnect()]);
  });

  let oldC: { id: string };
  let newC: { id: string };
  it("rapor aynı numaranın farklı yazımlarını, e-postayı ve ad soyadı ayrı gruplar; başka salonu karıştırmaz", async () => {
    oldC = await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Ayla", lastName: "Demir", phone: "+905301112233", marketingConsent: true } });
    newC = await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Ayla", lastName: "Demir", phone: "05301112233", email: "ayla@x.test", source: "ONLINE" } });
    await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Can", lastName: "Er", phone: "05401112233", email: "CAN@x.test" } });
    await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Cem", lastName: "Er", phone: "05401112244", email: "can@x.test" } });
    await su.customer.create({ data: { tenantId: B.tenant.id, firstName: "Ayla", lastName: "Demir", phone: "05301112233" } });
    await su.appointment.create({
      data: { tenantId: A.tenant.id, customerId: oldC.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: new Date(futureAt(3, "10:00")), endsAt: new Date(futureAt(3, "11:00")), price: 100 },
    });
    const groups = await findDuplicates(platform, { tenantSlug: A.tenant.slug });
    const byReason = (r: string) => groups.filter((g) => g.reason === r);
    expect(byReason("telefon")).toHaveLength(1);
    expect(byReason("telefon")[0].customers.map((c) => c.id).sort()).toEqual([oldC.id, newC.id].sort());
    expect(byReason("telefon")[0].keepId).toBe(oldC.id); // geçmişi olan kayıt
    expect(byReason("e-posta")).toHaveLength(1);
    // Ayla Demir çifti telefon grubunda zaten var; ad-soyad grubunda tekrar listelenmez.
    expect(byReason("ad-soyad")).toHaveLength(0);
    expect(groups.every((g) => g.tenantId === A.tenant.id)).toBe(true);
  });

  it("birleştirme geçmişi ana kayda taşır, eksik alanları doldurur, diğerini siler ve denetim kaydı yazar", async () => {
    await su.customerNote.create({ data: { tenantId: A.tenant.id, customerId: newC.id, body: "online not" } });
    const r = await mergeCustomers(tenantDb, { tenantId: A.tenant.id, keepId: oldC.id, mergeId: newC.id, note: "Salon teyit etti" });
    expect(r.moved).toMatchObject({ appointments: 0, notes: 1 });
    const kept = await su.customer.findUniqueOrThrow({ where: { id: oldC.id } });
    expect(kept).toMatchObject({ phone: "05301112233", email: "ayla@x.test", marketingConsent: true });
    expect(await su.customer.findUnique({ where: { id: newC.id } })).toBeNull();
    expect(await su.appointment.count({ where: { customerId: oldC.id } })).toBe(1);
    expect(await su.auditLog.count({ where: { action: "customer.merged", entityId: oldC.id } })).toBe(1);
  });

  it("başka salonun kaydı RLS nedeniyle birleştirilemez", async () => {
    const other = await su.customer.findFirstOrThrow({ where: { tenantId: B.tenant.id } });
    await expect(mergeCustomers(tenantDb, { tenantId: A.tenant.id, keepId: oldC.id, mergeId: other.id, note: "x" })).rejects.toBeInstanceOf(MergeError);
    expect(await su.customer.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it("silinecek kayıtta kasa hareketi varsa birleştirme yapılmaz, hiçbir şey değişmez", async () => {
    const x = await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Kasa", lastName: "Var", phone: "05351112233" } });
    await su.financeTransaction.create({ data: { tenantId: A.tenant.id, customerId: x.id, type: "INCOME", amount: 50, method: "CASH", category: "SERVICE" } as never });
    await expect(mergeCustomers(tenantDb, { tenantId: A.tenant.id, keepId: oldC.id, mergeId: x.id, note: "x" })).rejects.toThrow(/--ana olarak seçin/);
    expect(await su.customer.findUnique({ where: { id: x.id } })).not.toBeNull();
  });
});
