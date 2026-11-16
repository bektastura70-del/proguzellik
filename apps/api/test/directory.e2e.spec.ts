import { INestApplication } from "@nestjs/common";
import bcrypt from "bcryptjs";
import request from "supertest";
import { PROVINCES } from "../src/directory/tr-admin-units";
import { allUnits } from "../src/directory/admin-units";
import { directionsUrl, fullAddress } from "../src/directory/address";
import { PrismaService } from "../src/prisma/prisma.service";
import { TEST_PASSWORD, addMember, api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb } from "./helpers";

const istanbul = PROVINCES.find((p) => p.code === 34)!;
const kadikoy = istanbul.districts.find((d) => d.slug === "kadikoy")!;
const besiktas = istanbul.districts.find((d) => d.slug === "besiktas")!;
const ankara = PROVINCES.find((p) => p.code === 6)!;
const cankaya = ankara.districts.find((d) => d.slug === "cankaya")!;

const on = (provinceCode: number, districtCode: number, extra: Partial<{ showAddress: boolean; showPhone: boolean }> = {}) => ({
  enabled: true, provinceCode, districtCode, showAddress: false, showPhone: false, ...extra,
});

describe("İl/ilçe verisi (İçişleri Bakanlığı)", () => {
  it("81 il, 973 ilçe; kodlar ve il içinde adresler benzersiz", () => {
    expect(PROVINCES).toHaveLength(81);
    expect(PROVINCES.map((p) => p.code).sort((a, b) => a - b)).toEqual(Array.from({ length: 81 }, (_, i) => i + 1));
    const codes = PROVINCES.flatMap((p) => p.districts.map((d) => d.code));
    expect(codes).toHaveLength(973);
    expect(new Set(codes).size).toBe(973);
    for (const p of PROVINCES) expect(new Set(p.districts.map((d) => d.slug)).size).toBe(p.districts.length);
    expect(new Set(PROVINCES.map((p) => p.slug)).size).toBe(81);
  });

  it("Türkçe sıralama ve yazım", () => {
    const units = allUnits();
    expect(units[0].name).toBe("Adana");
    const names = units.map((u) => u.name);
    expect(names.indexOf("Çanakkale")).toBeGreaterThan(names.indexOf("Bursa"));
    expect(names.indexOf("Çanakkale")).toBeLessThan(names.indexOf("Denizli"));
    expect(names).toContain("İstanbul");
    expect(names).toContain("Iğdır");
    expect(istanbul.slug).toBe("istanbul");
  });
});

describe("Tam adres ve yol tarifi bağlantısı", () => {
  it("açık adres + mahalle + ilçe / il; yazılı olan tekrarlanmaz", () => {
    expect(fullAddress("Atatürk Cad. No: 5", "Kirişçi Mahallesi", { provinceCode: 70, districtCode: 60042 })).toBe("Atatürk Cad. No: 5, Kirişçi Mahallesi, Merkez / Karaman");
    expect(fullAddress(null, "Kirişçi Mahallesi", { provinceCode: 70, districtCode: 60042 })).toBe("Kirişçi Mahallesi, Merkez / Karaman");
    expect(fullAddress("KİRİŞÇİ Mah. 3. Sok. No 2 Karaman", "Kirişçi Mah.", { provinceCode: 70, districtCode: 60042 })).toBe("KİRİŞÇİ Mah. 3. Sok. No 2 Karaman, Merkez");
    expect(fullAddress("Moda Cad. 1", null, null)).toBe("Moda Cad. 1");
    expect(fullAddress("  ", " ", { provinceCode: null, districtCode: null })).toBeNull();
    // İle ait olmayan ilçe kodu yok sayılır
    expect(fullAddress("X", null, { provinceCode: 34, districtCode: 60042 })).toBe("X, İstanbul");
  });
  it("yol tarifi yalnız adresle harita araması (koordinat yok)", () => {
    expect(directionsUrl(null)).toBeNull();
    expect(directionsUrl("Kirişçi Mahallesi, Merkez / Karaman")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Kiri%C5%9F%C3%A7i%20Mahallesi%2C%20Merkez%20%2F%20Karaman",
    );
  });
});

describe("Salon rehberi (mobil uygulama)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let C: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let c: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  const pub = (url: string) => request(app.getHttpServer()).get(url);

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Rehber A", email: "rha@test.local" });
    B = await createTenantWithUser(su, { name: "Rehber B", email: "rhb@test.local" });
    C = await createTenantWithUser(su, { name: "Rehber C", email: "rhc@test.local", status: "TRIAL" });
    await su.tenant.update({ where: { id: A.tenant.id }, data: { address: "Moda Cad. 1", phone: "02160000000" } });
    await su.tenant.update({ where: { id: B.tenant.id }, data: { address: "Gizli Sok. 2", phone: "02169999999" } });
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "Sahip", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    a = api(app, await login(app, "rha@test.local"), A.tenant.id);
    b = api(app, await login(app, "rhb@test.local"), B.tenant.id);
    c = api(app, await login(app, "rhc@test.local"), C.tenant.id);
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("varsayılan kapalı: kayıt yokken rehber boş, işletme ayarı kapalı görünür", async () => {
    const r = await a.get("/directory/listing").expect(200);
    expect(r.body.listing).toMatchObject({ enabled: false, provinceCode: null, showAddress: false, showPhone: false });
    expect(r.body.visible).toBe(false);
    expect((await pub("/public/directory/provinces").expect(200)).body.provinces).toEqual([]);
  });

  it("doğrulama: il/ilçe zorunlu, ilçe ile uyumlu olmalı", async () => {
    await a.put("/directory/listing").send({ enabled: true, provinceCode: null, districtCode: null, showAddress: false, showPhone: false }).expect(400);
    await a.put("/directory/listing").send(on(34, cankaya.code)).expect(400);
    await a.put("/directory/listing").send(on(99, kadikoy.code)).expect(400);
    await a.put("/directory/listing").send({ ...on(34, kadikoy.code), enabled: "evet" }).expect(400);
  });

  it("yalnız işletme sahibi değiştirir; yönetici görür, personel göremez", async () => {
    await addMember(app, a, { email: "rha-mgr@test.local", fullName: "Yönetici", role: "MANAGER" });
    await addMember(app, a, { email: "rha-staff@test.local", fullName: "Personel", role: "STAFF" });
    const mgr = api(app, await login(app, "rha-mgr@test.local"), A.tenant.id);
    const staff = api(app, await login(app, "rha-staff@test.local"), A.tenant.id);
    await mgr.get("/directory/listing").expect(200);
    await mgr.put("/directory/listing").send(on(34, kadikoy.code)).expect(403);
    await staff.get("/directory/listing").expect(403);
  });

  it("açılınca il > ilçe > salon listesinde görünür; adres/telefon yalnız izinle", async () => {
    const r = await a.put("/directory/listing").send(on(34, kadikoy.code, { showAddress: true })).expect(200);
    expect(r.body.visible).toBe(true);
    expect(r.body.preview).toMatchObject({ name: "Rehber A", address: "Moda Cad. 1, Kadıköy / İstanbul", phone: null, directionsUrl: null, provinceName: "İstanbul", districtName: "Kadıköy" });
    await b.put("/directory/listing").send(on(34, kadikoy.code)).expect(200);

    const prov = (await pub("/public/directory/provinces").expect(200)).body;
    expect(prov.provinces).toEqual([{ code: 34, name: "İstanbul", slug: "istanbul", count: 2 }]);
    const dist = (await pub("/public/directory/provinces/istanbul").expect(200)).body;
    expect(dist.districts).toEqual([{ code: kadikoy.code, name: "Kadıköy", slug: "kadikoy", count: 2 }]);
    const list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.total).toBe(2);
    const sa = list.salons.find((s: { slug: string }) => s.slug === A.tenant.slug);
    const sb = list.salons.find((s: { slug: string }) => s.slug === B.tenant.slug);
    expect(sa).toEqual({ slug: A.tenant.slug, name: "Rehber A", logoUrl: null, address: "Moda Cad. 1, Kadıköy / İstanbul", phone: null, directionsUrl: null });
    expect(sb).toEqual({ slug: B.tenant.slug, name: "Rehber B", logoUrl: null, address: null, phone: null, directionsUrl: null });
    // Yanıtta yalnızca açık alanlar: kimlik, e-posta, durum vb. yok
    expect(JSON.stringify(list)).not.toMatch(/tenantId|"id"|email|status|02169999999|Gizli Sok/);
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "salon.listing_enabled" } })).toBe(1);
  });

  it("bilinmeyen il/ilçe 404, geçersiz adres 400", async () => {
    await pub("/public/directory/provinces/atlantis").expect(404);
    await pub("/public/directory/provinces/istanbul/cankaya").expect(404);
    await pub("/public/directory/provinces/ISTANBUL").expect(400);
  });

  it("online randevusu kapalı, askıdaki ve deneme süresi biten salon görünmez (kayıt silinmez)", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { onlineBookingEnabled: false } });
    let list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.salons.map((s: { slug: string }) => s.slug)).toEqual([A.tenant.slug]);
    const view = (await b.get("/directory/listing").expect(200)).body;
    expect(view.visible).toBe(false);
    expect(view.issues.join(" ")).toMatch(/Online randevu kapalı/);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { onlineBookingEnabled: true, status: "SUSPENDED" } });
    list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.total).toBe(1);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "ACTIVE" } });

    await c.put("/directory/listing").send(on(34, besiktas.code)).expect(200);
    expect((await pub("/public/directory/provinces/istanbul").expect(200)).body.districts.map((d: { slug: string }) => d.slug).sort()).toEqual(["besiktas", "kadikoy"]);
    await su.tenant.update({ where: { id: C.tenant.id }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
    expect((await pub("/public/directory/provinces/istanbul").expect(200)).body.districts.map((d: { slug: string }) => d.slug)).toEqual(["kadikoy"]);
    expect(await su.salonListing.findUnique({ where: { tenantId: C.tenant.id } })).toMatchObject({ enabled: true });
  });

  it("işletme kapatınca listeden düşer", async () => {
    await b.put("/directory/listing").send({ ...on(34, kadikoy.code), enabled: false }).expect(200);
    const list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.salons.map((s: { slug: string }) => s.slug)).toEqual([A.tenant.slug]);
    expect(await su.auditLog.count({ where: { tenantId: B.tenant.id, action: "salon.listing_disabled" } })).toBe(1);
  });

  it("SaaS sahibi listeden çıkarır; işletme yeniden açamaz; geri alınca döner", async () => {
    await a.get("/platform/directory").expect(403);
    const all = (await admin.get("/platform/directory").expect(200)).body;
    expect(all.listings.map((l: { tenant: { slug: string } }) => l.tenant.slug)).toContain(A.tenant.slug);
    await admin.post(`/platform/directory/${A.tenant.id}/block`).send({ reason: "x" }).expect(400);
    await admin.post(`/platform/directory/${A.tenant.id}/block`).send({ reason: "Uygunsuz ad" }).expect(201);
    expect((await pub("/public/directory/provinces").expect(200)).body.provinces).toEqual([]);
    const view = (await a.get("/directory/listing").expect(200)).body;
    expect(view.listing).toMatchObject({ blocked: true, blockedReason: "Uygunsuz ad" });
    await a.put("/directory/listing").send(on(6, cankaya.code)).expect(409);
    // Kapatmak serbest
    await a.put("/directory/listing").send({ ...on(34, kadikoy.code), enabled: false }).expect(200);
    await a.put("/directory/listing").send(on(34, kadikoy.code)).expect(409);
    await admin.post(`/platform/directory/${A.tenant.id}/unblock`).send({ reason: "Ad düzeltildi" }).expect(201);
    await a.put("/directory/listing").send(on(34, kadikoy.code)).expect(200);
    expect((await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body.total).toBe(1);
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: { in: ["platform.salon_listing_blocked", "platform.salon_listing_unblocked"] } } })).toBe(2);
  });

  it("veritabanı: kiracı başka salonun satırını görmez, engel alanını yazamaz, kapalı kayıt il ister", async () => {
    const prisma = app.get(PrismaService);
    const rows = await prisma.withTenant({ tenantId: B.tenant.id, userId: B.user.id }, (tx) => tx.salonListing.findMany());
    expect(rows.map((r) => r.tenantId)).toEqual([B.tenant.id]);
    await expect(
      prisma.withTenant({ tenantId: B.tenant.id, userId: B.user.id }, (tx) => tx.salonListing.update({ where: { tenantId: B.tenant.id }, data: { blockedAt: null } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.withTenant({ tenantId: B.tenant.id, userId: B.user.id }, (tx) => tx.salonListing.delete({ where: { tenantId: B.tenant.id } })),
    ).rejects.toThrow(/permission denied/);
    await expect(su.salonListing.update({ where: { tenantId: B.tenant.id }, data: { enabled: true, provinceCode: null } })).rejects.toThrow(/salon_listing_location/);
  });

  it("logo varsa rehberde salonun marka adresiyle gelir", async () => {
    const asset = await su.tenantAsset.create({
      data: { tenantId: A.tenant.id, kind: "LOGO", mime: "image/png", bytes: Buffer.from([1]), width: 1, height: 1, sha256: "x" },
    });
    await su.tenantPwaSettings.upsert({ where: { tenantId: A.tenant.id }, create: { tenantId: A.tenant.id, logoAssetId: asset.id }, update: { logoAssetId: asset.id } });
    const list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.salons[0].logoUrl).toBe(`/r/${A.tenant.slug}/marka/${asset.id}`);
  });
  it("mahalle: işletme kendi rolüyle kaydeder; salon sayfası ve rehberde tam adres; yol tarifi yalnız açılınca", async () => {
    await a.patch("/settings").send({ neighborhood: "  Caferağa Mahallesi " }).expect(200);
    expect((await a.get("/settings").expect(200)).body.neighborhood).toBe("Caferağa Mahallesi");
    await a.patch("/settings").send({ neighborhood: "x".repeat(81) }).expect(400);
    const full = "Moda Cad. 1, Caferağa Mahallesi, Kadıköy / İstanbul";

    let salon = (await pub(`/public/salons/${A.tenant.slug}`).expect(200)).body.salon;
    expect(salon).toMatchObject({ address: full, directionsUrl: null });
    let view = (await a.get("/directory/listing").expect(200)).body;
    expect(view).toMatchObject({ salonAddress: full, salonStreet: "Moda Cad. 1", salonNeighborhood: "Caferağa Mahallesi" });

    // Eski panel showDirections göndermese de kayıt çalışır (kapalı sayılır)
    await a.put("/directory/listing").send(on(34, kadikoy.code, { showAddress: true })).expect(200);
    await a.put("/directory/listing").send({ ...on(34, kadikoy.code, { showAddress: true }), showDirections: true }).expect(200);
    salon = (await pub(`/public/salons/${A.tenant.slug}`).expect(200)).body.salon;
    expect(salon.directionsUrl).toBe(directionsUrl(full));
    let list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.salons[0]).toMatchObject({ address: full, directionsUrl: directionsUrl(full) });

    // Rehberde adres gizliyse yol tarifi de verilmez; salon sayfasında (adres zaten açık) verilir
    await a.put("/directory/listing").send({ ...on(34, kadikoy.code), showDirections: true }).expect(200);
    list = (await pub("/public/directory/provinces/istanbul/kadikoy").expect(200)).body;
    expect(list.salons[0]).toMatchObject({ address: null, directionsUrl: null });
    expect(JSON.stringify(list)).not.toMatch(/Caferağa|Moda Cad/);
    expect((await pub(`/public/salons/${A.tenant.slug}`).expect(200)).body.salon.directionsUrl).toBe(directionsUrl(full));
    view = (await a.get("/directory/listing").expect(200)).body;
    expect(view.listing.showDirections).toBe(true);
    const audit = await su.auditLog.findFirst({ where: { tenantId: A.tenant.id, action: "salon.listing_updated" }, orderBy: { createdAt: "desc" } });
    expect(audit?.metadata).toMatchObject({ after: { showDirections: true } });

    // Mahalle silinebilir; başka işletmenin mahallesini yazamaz (RLS)
    await a.patch("/settings").send({ neighborhood: "" }).expect(200);
    expect((await a.get("/settings").expect(200)).body.neighborhood).toBeNull();
    const prisma = app.get(PrismaService);
    const n = await prisma.withTenant({ tenantId: B.tenant.id, userId: B.user.id }, (tx) => tx.tenant.updateMany({ where: { id: A.tenant.id }, data: { neighborhood: "Sızma" } }));
    expect(n.count).toBe(0);
  });
});
