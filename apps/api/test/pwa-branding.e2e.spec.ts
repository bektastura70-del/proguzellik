import { INestApplication } from "@nestjs/common";
import { deflateSync } from "node:zlib";
import request from "supertest";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";
import { enablePwa } from "./portal-helpers";
import { inspectImage } from "../src/pwa/image-inspect";

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Gerçek, çözülebilir düz renk PNG (isteğe bağlı konum içeren metin parçasıyla). */
export function makePng(w: number, h: number, withText = false) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(withText ? [chunk("tEXt", Buffer.from("GPS\u000041.0082,28.9784"))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function makeJpeg(w: number, h: number) {
  const seg = (m: number, data: Buffer) => {
    const l = Buffer.alloc(2);
    l.writeUInt16BE(data.length + 2);
    return Buffer.concat([Buffer.from([0xff, m]), l, data]);
  };
  const sof = Buffer.alloc(6);
  sof[0] = 8;
  sof.writeUInt16BE(h, 1);
  sof.writeUInt16BE(w, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")),
    seg(0xe1, Buffer.from("Exif\0\0GPS-SECRET-LOCATION", "binary")),
    seg(0xc0, sof),
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]),
  ]);
}

describe("Salon markalı PWA: marka ayarları ve görsel yükleme (Modül 4)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Marka A", email: "mka@test.local" });
    B = await createTenantWithUser(su, { name: "Marka B", email: "mkb@test.local" });
    app = await createApp();
    a = api(app, await login(app, "mka@test.local"), A.tenant.id);
    b = api(app, await login(app, "mkb@test.local"), B.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("görsel denetimi: tür içerikten belirlenir, üst veri silinir, SVG/HTML reddedilir", () => {
    const p = inspectImage(makePng(200, 200, true));
    expect(p).toMatchObject({ mime: "image/png", width: 200, height: 200 });
    expect(p.bytes.includes(Buffer.from("41.0082"))).toBe(false);
    const j = inspectImage(makeJpeg(300, 120));
    expect(j).toMatchObject({ mime: "image/jpeg", width: 300, height: 120 });
    expect(j.bytes.includes(Buffer.from("GPS-SECRET"))).toBe(false);
    expect(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toThrow(/PNG, JPEG/);
    expect(() => inspectImage(makePng(200, 200).subarray(0, 40))).toThrow(/bozuk/);
  });

  it("sahip marka ve kuralları kaydeder; geçersiz renk ve özellik bayrağı kabul edilmez", async () => {
    const r = await a.patch("/pwa/branding").send({ appName: "Marka A Güzellik", shortName: "Marka A", primaryColor: "#1f5f5b", secondaryColor: "#e0a458", cancelMinHours: 24, allowCustomerReschedule: false }).expect(200);
    expect(r.body.branding).toMatchObject({ appName: "Marka A Güzellik", shortName: "Marka A", primaryColor: "#1f5f5b" });
    expect(r.body.rules).toMatchObject({ cancelMinHours: 24, allowCustomerReschedule: false });
    await a.patch("/pwa/branding").send({ primaryColor: "red;background:url(x)" }).expect(400);
    await a.patch("/pwa/branding").send({ shortName: "Çok uzun kısa ad burada" }).expect(400);
    // Bayrak alanı şemada yok: yok sayılır, bayrak değişmez
    await a.patch("/pwa/branding").send({ customerPwaEnabled: true }).expect(200);
    expect((await su.tenantPwaSettings.findUniqueOrThrow({ where: { tenantId: A.tenant.id } })).customerPwaEnabled).toBe(false);
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "pwa.branding_updated" } })).toBeGreaterThan(0);
  });

  it("kiracı rolü veritabanında bayrak sütununu değiştiremez (sütun yetkisi)", async () => {
    const { PrismaService } = await import("../src/prisma/prisma.service");
    const prisma = app.get(PrismaService);
    await expect(
      prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { customerPwaEnabled: true } })),
    ).rejects.toThrow(/permission denied/);
  });

  it("personel ve resepsiyon marka ayarlarını göremez/değiştiremez", async () => {
    await addMember(app, a, { email: "mk.staff@test.local", fullName: "Mk Personel", role: "STAFF" });
    await addMember(app, a, { email: "mk.rec@test.local", fullName: "Mk Resepsiyon", role: "RECEPTION" });
    const st = api(app, await login(app, "mk.staff@test.local"), A.tenant.id);
    const rec = api(app, await login(app, "mk.rec@test.local"), A.tenant.id);
    await st.get("/pwa/branding").expect(403);
    await rec.patch("/pwa/branding").send({ appName: "x" }).expect(403);
    await rec.post("/pwa/branding/icon").set("Content-Type", "image/png").send(makePng(192, 192)).expect(403);
  });

  it("simge yükleme: kare PNG ≥192 kabul; kare olmayan, küçük, SVG ve büyük dosya reddedilir", async () => {
    await a.post("/pwa/branding/icon").set("Content-Type", "image/png").send(makePng(300, 200)).expect(400);
    await a.post("/pwa/branding/icon").set("Content-Type", "image/png").send(makePng(64, 64)).expect(400);
    await a.post("/pwa/branding/icon").set("Content-Type", "image/svg+xml").send(Buffer.from("<svg/>")).expect(400);
    // Tür başlığı PNG ama içerik HTML: içerikten reddedilir
    await a.post("/pwa/branding/icon").set("Content-Type", "image/png").send(Buffer.from("<html><script>alert(1)</script></html>")).expect(400);
    await a.post("/pwa/branding/logo").set("Content-Type", "image/png").send(Buffer.alloc(600 * 1024, 1)).expect(413);
    const r = await a.post("/pwa/branding/icon").set("Content-Type", "image/png").send(makePng(512, 512, true)).expect(201);
    expect(r.body).toMatchObject({ kind: "ICON", mime: "image/png", width: 512, height: 512 });
    const second = await a.post("/pwa/branding/icon").set("Content-Type", "image/png").send(makePng(256, 256)).expect(201);
    // Eski simge silinir
    expect(await su.tenantAsset.count({ where: { tenantId: A.tenant.id, kind: "ICON" } })).toBe(1);
    expect((await su.tenantPwaSettings.findUniqueOrThrow({ where: { tenantId: A.tenant.id } })).iconAssetId).toBe(second.body.id);
  });

  it("herkese açık görsel: bayrak kapalıyken 404; açıkken güvenli başlıklarla döner; başka salonun adresinden 404", async () => {
    const logo = (await a.post("/pwa/branding/logo").set("Content-Type", "image/jpeg").send(makeJpeg(400, 120)).expect(201)).body;
    const url = `/public/salons/${A.tenant.slug}/assets/${logo.id}`;
    await request(app.getHttpServer()).get(url).expect(404);
    await enablePwa(su, A.tenant.id, { customerSessionTrackingEnabled: false });
    await enablePwa(su, B.tenant.id);
    const r = await request(app.getHttpServer()).get(url).expect(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("sandbox");
    expect(Buffer.from(r.body).includes(Buffer.from("GPS-SECRET"))).toBe(false);
    await request(app.getHttpServer()).get(`/public/salons/${B.tenant.slug}/assets/${logo.id}`).expect(404);
    // B kiracısı A'nın görselini kendi ayarına bağlayamaz/göremez
    expect((await b.get("/pwa/branding").expect(200)).body.branding.logo).toBeNull();
  });

  it("uygulama bilgisi (manifest kaynağı) marka alanlarını döner ve hassas veri içermez", async () => {
    const r = await request(app.getHttpServer()).get(`/public/salons/${A.tenant.slug}/app`).expect(200);
    expect(r.body).toMatchObject({ name: "Marka A Güzellik", shortName: "Marka A", primaryColor: "#1f5f5b", features: { installable: true, portal: true } });
    expect(r.body.iconUrl).toMatch(new RegExp(`^/r/${A.tenant.slug}/marka/`));
    expect(JSON.stringify(r.body)).not.toMatch(/@|phone|email|tenantId/);
  });

  it("görsel kaldırılınca ayardan da düşer", async () => {
    await a.delete("/pwa/branding/logo").expect(200);
    expect((await su.tenantPwaSettings.findUniqueOrThrow({ where: { tenantId: A.tenant.id } })).logoAssetId).toBeNull();
    expect(await su.tenantAsset.count({ where: { tenantId: A.tenant.id, kind: "LOGO" } })).toBe(0);
  });
});
