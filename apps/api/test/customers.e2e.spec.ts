import { INestApplication } from "@nestjs/common";
import { api, createApp, createTenantWithUser, login, owner, resetDb, addMember, TEST_PASSWORD, setupSalon, futureAt } from "./helpers";

describe("Müşteri CRM (API + gerçek veritabanı)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let ayseId: string;

  it("müşteri oluşturur, telefonu normalleştirir ve KVKK onay zamanını kaydeder", async () => {
    const res = await a
      .post("/customers")
      .send({ firstName: "Ayşe", lastName: "Test", phone: "0555 111 22 33", tags: ["VIP"], kvkkConsent: true })
      .expect(201);
    ayseId = res.body.id;
    expect(res.body.phone).toBe("05551112233");
    expect(res.body.kvkkConsentAt).toBeTruthy();
    expect(res.body.tenantId).toBe(A.tenant.id);
  });

  it("aynı işletmede aynı telefon tekrar kullanılamaz, başka işletmede kullanılabilir", async () => {
    await a.post("/customers").send({ firstName: "Başka", lastName: "Kişi", phone: "05551112233" }).expect(409);
    await b.post("/customers").send({ firstName: "Ayşe", lastName: "B", phone: "05551112233" }).expect(201);
  });

  it("geçersiz veri 400 döner", async () => {
    await a.post("/customers").send({ firstName: "", lastName: "X" }).expect(400);
    await a.post("/customers").send({ firstName: "X", lastName: "Y", phone: "abc" }).expect(400);
  });

  it("arama ve etiket filtresi çalışır", async () => {
    await a.post("/customers").send({ firstName: "Zeynep", lastName: "Deneme", email: "zeynep@test.local" }).expect(201);
    const s = await a.get("/customers?search=ayş").expect(200);
    expect(s.body.items.map((c: any) => c.firstName)).toEqual(["Ayşe"]);
    const t = await a.get("/customers?tag=VIP").expect(200);
    expect(t.body.total).toBe(1);
    const all = await a.get("/customers").expect(200);
    expect(all.body.total).toBe(2);
  });

  it("B, A'nın müşterisini göremez, değiştiremez, not ekleyemez", async () => {
    await b.get(`/customers/${ayseId}`).expect(404);
    await b.patch(`/customers/${ayseId}`).send({ firstName: "Hack" }).expect(404);
    await b.post(`/customers/${ayseId}/notes`).send({ body: "x" }).expect(404);
    await b.get(`/customers/${ayseId}/kvkk-export`).expect(404);
    await b.post(`/customers/${ayseId}/anonymize`).expect(404);
    const list = await b.get("/customers").expect(200);
    expect(list.body.items.every((c: any) => c.tenantId === B.tenant.id)).toBe(true);
  });

  it("not ekler ve geçmişte gösterir", async () => {
    await a.post(`/customers/${ayseId}/notes`).send({ body: "Hassas cilt, alerjisi var." }).expect(201);
    const h = await a.get(`/customers/${ayseId}/history`).expect(200);
    expect(h.body.notes).toHaveLength(1);
    expect(h.body.customer.id).toBe(ayseId);
  });

  it("veritabanı başka işletmenin müşterisine not bağlanmasını engeller (bileşik FK)", async () => {
    const bCustomer = await su.customer.findFirstOrThrow({ where: { tenantId: B.tenant.id } });
    await expect(
      su.customerNote.create({ data: { tenantId: A.tenant.id, customerId: bCustomer.id, body: "x" } }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });

  it("KVKK dışa aktarma ve anonimleştirme yalnızca yetkili rollerce yapılır", async () => {
    const owner = await a.get(`/customers/${ayseId}/kvkk-export`).expect(200);
    expect(owner.body.customer.firstName).toBe("Ayşe");
    expect(owner.body.notes).toHaveLength(1);

    const inv = await addMember(app, a, { email: "resepsiyon@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    const r = api(app, await login(app, "resepsiyon@test.local", TEST_PASSWORD), A.tenant.id);
    await r.get(`/customers/${ayseId}/kvkk-export`).expect(403);
    await r.post(`/customers/${ayseId}/anonymize`).expect(403);
    await r.get(`/customers/${ayseId}`).expect(200);

    const anon = await a.post(`/customers/${ayseId}/anonymize`).expect(201);
    expect(anon.body).toMatchObject({ firstName: "Anonim", phone: null, email: null });
    const notes = await su.customerNote.count({ where: { customerId: ayseId } });
    expect(notes).toBe(0);
    const list = await a.get("/customers").expect(200);
    expect(list.body.items.find((c: any) => c.id === ayseId)).toBeUndefined();
    await a.patch(`/customers/${ayseId}`).send({ firstName: "Geri" }).expect(409);
    const logs = await su.auditLog.findMany({ where: { entityId: ayseId } });
    expect(logs.map((l) => l.action).sort()).toEqual(["customer.anonymized", "customer.created", "customer.exported"]);
  });
  it("personel (STAFF) yalnız kendi randevusu olan müşterileri görür; takvimde başkasının müşterisinin telefonu gizlidir", async () => {
    const S = await createTenantWithUser(su, { name: "Personel Salonu", email: "ps@test.local" });
    const o = api(app, await login(app, "ps@test.local"), S.tenant.id);
    const salon = await setupSalon(o);
    await addMember(app, o, { email: "uzman@test.local", fullName: "Uzman", role: "STAFF" });
    const uzman = await su.user.findUniqueOrThrow({ where: { email: "uzman@test.local" } });
    await o.patch(`/staff/${salon.staff.id}`).send({ userId: uzman.id }).expect(200);
    const mine = salon.customer;
    const other = (await o.post("/customers").send({ firstName: "Diğer", lastName: "Müşteri", phone: "05550000002" }).expect(201)).body;
    await o.post("/appointments").send({ customerId: mine.id, staffId: salon.staff.id, serviceId: salon.service.id, startsAt: futureAt(3, "10:00") }).expect(201);
    await o.post("/appointments").send({ customerId: other.id, staffId: salon.staff2.id, serviceId: salon.service.id, startsAt: futureAt(3, "11:00") }).expect(201);

    const st = api(app, await login(app, "uzman@test.local"), S.tenant.id);
    const list = (await st.get("/customers").expect(200)).body;
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([mine.id]);
    expect(list.total).toBe(1);
    await st.get(`/customers/${mine.id}`).expect(200);
    await st.get(`/customers/${other.id}`).expect(404);
    await st.get(`/customers/${other.id}/history`).expect(404);
    await st.post(`/customers/${other.id}/notes`).send({ body: "x" }).expect(404);

    const from = encodeURIComponent(futureAt(3, "00:00"));
    const to = encodeURIComponent(futureAt(4, "00:00"));
    const appts = (await st.get(`/appointments?from=${from}&to=${to}`).expect(200)).body as { customer: { id: string; phone: string | null }; staff: Record<string, unknown> }[];
    expect(appts.find((x) => x.customer.id === mine.id)!.customer.phone).toBe("05550000001");
    expect(appts.find((x) => x.customer.id === other.id)!.customer.phone).toBeNull();
    expect(appts[0].staff).not.toHaveProperty("userId");
    // Sahip her şeyi görür
    expect((await o.get("/customers").expect(200)).body.total).toBe(2);
    const ownerAppts = (await o.get(`/appointments?from=${from}&to=${to}`).expect(200)).body as { customer: { phone: string | null } }[];
    expect(ownerAppts.every((x) => x.customer.phone)).toBe(true);
  });
});
