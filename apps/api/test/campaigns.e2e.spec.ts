import { INestApplication } from "@nestjs/common";
import { Job } from "bullmq";
import { CampaignsService, marketingEnabled } from "../src/campaigns/campaigns.service";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { PrismaService } from "../src/prisma/prisma.service";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

const WA = { externalId: "2065403522429", businessAccountId: "2022901293403", accessToken: "EAAkampanyaTOKENabcdefghijklmnop9876", appSecret: "fedcba9876543210fedcba9876543210" };

describe("Kampanyalar ve ticari ileti gönderimi", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let r: ReturnType<typeof api>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Kampanya Salon", email: "ca@test.local" });
    const B = await createTenantWithUser(su, { name: "Öteki Salon", email: "cb@test.local" });
    app = await createApp();
    a = api(app, await login(app, "ca@test.local"), A.tenant.id);
    b = api(app, await login(app, "cb@test.local"), B.tenant.id);
    await addMember(app, a, { email: "cr@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    r = api(app, await login(app, "cr@test.local"), A.tenant.id);
    await a.post("/customers").send({ firstName: "İzinli", lastName: "Bir", phone: "05551000001", marketingConsent: true }).expect(201);
    await a.post("/customers").send({ firstName: "İzinli", lastName: "İki", phone: "05551000002", marketingConsent: true }).expect(201);
    await a.post("/customers").send({ firstName: "İzinsiz", lastName: "Üç", phone: "05551000003", marketingConsent: false }).expect(201);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let campId: string;
  it("kampanya oluşturulur; resepsiyon görür ama oluşturamaz; başka işletme erişemez", async () => {
    await r.post("/campaigns").send({ title: "Kasım indirimi", description: "Tüm lazer seanslarında %20 indirim." }).expect(403);
    campId = (await a.post("/campaigns").send({ title: "Kasım indirimi", description: "Tüm lazer seanslarında %20 indirim.", endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString() }).expect(201)).body.id;
    expect((await r.get("/campaigns").expect(200)).body).toHaveLength(1);
    expect((await b.get("/campaigns").expect(200)).body).toHaveLength(0);
    await b.patch(`/campaigns/${campId}`).send({ title: "Ele geçirildi" }).expect(404);
    await a.post("/campaigns").send({ title: "Hatalı", description: "Bitiş başlangıçtan önce olamaz.", startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }).expect(400);
  });

  it("yapay zekânın göreceği liste yalnızca tarihi geçerli ve aktif kampanyalardır", async () => {
    await a.post("/campaigns").send({ title: "Geçmiş kampanya", description: "Ekim ayı kampanyası bitti.", endsAt: new Date(Date.now() - 86_400_000).toISOString() }).expect(201);
    await a.post("/campaigns").send({ title: "Gelecek kampanya", description: "Aralıkta başlayacak kampanya.", startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(201);
    await a.post("/campaigns").send({ title: "Pasif kampanya", description: "Kapalı kampanya metni.", isActive: false }).expect(201);
    const active = await app.get(PrismaService).withTenant({ tenantId: A.tenant.id, userId: "" }, (tx) => CampaignsService.active(tx));
    expect(active.map((c) => c.title)).toEqual(["Kasım indirimi"]);
  });

  it("hedef kitle yalnızca ticari ileti izni olan müşterilerdir", async () => {
    const res = await a.get(`/campaigns/${campId}/audience`).expect(200);
    expect(res.body).toMatchObject({ eligible: 2, withoutConsent: 1, enabled: true });
  });

  it("gönderim açık onay, İYS onayı ve doğrulanmış WhatsApp bağlantısı ister", async () => {
    await a.post(`/campaigns/${campId}/broadcast`).send({ confirm: true }).expect(400);
    await r.post(`/campaigns/${campId}/broadcast`).send({ confirm: true, iysConfirmed: true }).expect(403);
    await a.post(`/campaigns/${campId}/broadcast`).send({ confirm: true, iysConfirmed: true }).expect(409);
  });

  it("yalnızca izinli müşterilere bir kez kuyruğa alınır", async () => {
    await a.put("/channels/whatsapp").send(WA).expect(200);
    await a.post("/channels/whatsapp/verify").expect(200);
    const res = await a.post(`/campaigns/${campId}/broadcast`).send({ confirm: true, iysConfirmed: true }).expect(200);
    expect(res.body).toEqual({ queued: 2, alreadySent: 0 });
    const ns = await su.notification.findMany({ where: { campaignId: campId } });
    expect(ns.map((n) => n.recipient).sort()).toEqual(["05551000001", "05551000002"]);
    expect(ns.every((n) => n.kind === "MARKETING" && n.template === "kampanya_duyuru")).toBe(true);
    const again = await a.post(`/campaigns/${campId}/broadcast`).send({ confirm: true, iysConfirmed: true }).expect(200);
    expect(again.body).toEqual({ queued: 0, alreadySent: 2 });
  });

  it("izin gönderimden önce geri çekilirse mesaj gönderilmez", async () => {
    const c2 = (await a.post("/campaigns").send({ title: "Hafta sonu", description: "Cumartesi cilt bakımında hediye maske." }).expect(201)).body.id;
    const cust = await su.customer.findFirstOrThrow({ where: { phone: "05551000001" } });
    const n = await su.notification.create({
      data: { tenantId: A.tenant.id, recipient: "05551000001", template: "kampanya_duyuru", kind: "MARKETING", payload: { params: ["İzinli", "Salon", "x"] }, customerId: cust.id, campaignId: c2, scheduledFor: new Date(Date.now() + 3_600_000) },
    });
    await su.customer.update({ where: { id: cust.id }, data: { marketingConsent: false } });
    const res = await app.get(NotificationQueue).process({ data: { notificationId: n.id }, attemptsMade: 0 } as Job<{ notificationId: string }>);
    expect(res).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).error).toBe("Ticari ileti izni yok");
  });

  it("canlıda İYS entegrasyonu olmadan toplu gönderim kapalıdır", () => {
    expect(marketingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(marketingEnabled({ NODE_ENV: "production", MARKETING_MESSAGES: "1" })).toBe(true);
    expect(marketingEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});
