import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DisabledMetaGateway, LiveMetaGateway, MetaDisabledError, MockMetaGateway } from "../src/messaging/meta.gateway";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const TOKEN = "EAAtestTOKENabcdefghijklmnopqrstuvwxyz1234";
const SECRET = "0123456789abcdef0123456789abcdef";
const WA = { externalId: "1065403522429", businessAccountId: "1022901293403", accessToken: TOKEN, appSecret: SECRET };

describe("Kanal bağlantıları (işletmenin kendi WhatsApp/Instagram hesabı)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let m: ReturnType<typeof api>;
  let outbox: MockMetaGateway["outbox"];

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Kanal Salon", email: "ka@test.local" });
    B = await createTenantWithUser(su, { name: "Diğer Salon", email: "kb@test.local" });
    app = await createApp();
    outbox = app.get(MockMetaGateway).outbox;
    a = api(app, await login(app, "ka@test.local"), A.tenant.id);
    b = api(app, await login(app, "kb@test.local"), B.tenant.id);
    await addMember(app, a, { email: "km@test.local", fullName: "Yönetici", role: "MANAGER" });
    m = api(app, await login(app, "km@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let connId: string;
  it("yalnızca işletme sahibi bağlantı bilgisi girebilir; yöneticiler yalnızca görür", async () => {
    await m.put("/channels/whatsapp").send(WA).expect(403);
    const res = await a.put("/channels/whatsapp").send(WA).expect(200);
    connId = res.body.id;
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.tokenHint).toBe("••••1234");
    expect(res.body.webhookUrl).toMatch(new RegExp(`/api/webhooks/meta/${connId}$`));
    const list = await m.get("/channels").expect(200);
    expect(list.body.connections).toHaveLength(1);
    expect(list.body.metaMode).toBe("mock");
    await m.get("/channels/whatsapp/verify-token").expect(403);
  });

  it("erişim anahtarı, uygulama sırrı ve doğrulama belirteci yanıtlarda/denetim kaydında yok; veritabanında şifreli", async () => {
    const list = await a.get("/channels").expect(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
    const row = await su.channelConnection.findUniqueOrThrow({ where: { id: connId } });
    for (const f of [row.accessTokenEnc, row.appSecretEnc, row.verifyTokenEnc]) expect(f).toMatch(/^v1\./);
    expect(row.accessTokenEnc).not.toContain(TOKEN);
    const audits = await su.auditLog.findMany({ where: { tenantId: A.tenant.id, action: { startsWith: "channel." } } });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(TOKEN);
  });

  it("geçersiz bilgiler reddedilir (WABA kimliği zorunlu, uygulama sırrı biçimi)", async () => {
    await a.put("/channels/whatsapp").send({ ...WA, businessAccountId: undefined }).expect(400);
    await a.put("/channels/whatsapp").send({ ...WA, appSecret: "kisa" }).expect(400);
    await a.put("/channels/telegram").send(WA).expect(404);
  });

  it("Meta anahtarı reddederse durum HATA olur ve hata gösterilir", async () => {
    await a.put("/channels/whatsapp").send({ ...WA, accessToken: "EAAgecersizanahtar_______________" }).expect(200);
    const r = await a.post("/channels/whatsapp/verify").expect(422);
    expect(r.body.code).toBe("META_API_ERROR");
    const row = await su.channelConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(row.status).toBe("ERROR");
  });

  it("doğrulama başarılı olunca bağlanır (test modunda olduğu açıkça belirtilir)", async () => {
    await a.put("/channels/whatsapp").send({ ...WA }).expect(200);
    const r = await a.post("/channels/whatsapp/verify").expect(200);
    expect(r.body.status).toBe("CONNECTED");
    expect(r.body.simulated).toBe(true);
    expect(r.body.displayName).toContain("Test");
  });

  it("aynı numara başka işletmeye bağlanamaz; işletmeler birbirinin bağlantısını görmez", async () => {
    expect((await b.get("/channels").expect(200)).body.connections).toHaveLength(0);
    await b.put("/channels/whatsapp").send(WA).expect(200);
    await b.post("/channels/whatsapp/verify").expect(409);
    await b.delete("/channels/whatsapp").expect(200);
  });

  it("webhook doğrulaması bağlantıya özel belirteçle yapılır", async () => {
    const { verifyToken } = (await a.get("/channels/whatsapp/verify-token").expect(200)).body;
    const http = request(app.getHttpServer());
    await http.get(`/webhooks/meta/${connId}`).query({ "hub.mode": "subscribe", "hub.verify_token": "yanlis", "hub.challenge": "x" }).expect(403);
    await http.get(`/webhooks/meta/00000000-0000-0000-0000-000000000000`).query({ "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": "x" }).expect(404);
    const ok = await http.get(`/webhooks/meta/${connId}`).query({ "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": "1158201444" }).expect(200);
    expect(ok.text).toBe("1158201444");
    expect((await su.channelConnection.findUniqueOrThrow({ where: { id: connId } })).webhookVerifiedAt).not.toBeNull();
  });

  it("şablon durumu listelenir; test modunda Meta'ya sorulmadığı belirtilir", async () => {
    const r = await m.get("/channels/whatsapp/templates").expect(200);
    expect(r.body.simulated).toBe(true);
    expect(r.body.templates.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(["randevu_onay", "randevu_hatirlatma", "paket_hatirlatma", "kampanya_duyuru"]),
    );
    expect(r.body.templates.every((t: { status: string }) => t.status === "MISSING")).toBe(true);
  });

  it("deneme mesajı açık onay ister; test modunda gönderilmediği döner", async () => {
    await a.post("/channels/whatsapp/test-message").send({ to: "05551112233" }).expect(400);
    await m.post("/channels/whatsapp/test-message").send({ to: "05551112233", confirm: true }).expect(403);
    const r = await a.post("/channels/whatsapp/test-message").send({ to: "05551112233", confirm: true }).expect(200);
    expect(r.body).toMatchObject({ sent: false, simulated: true });
    expect(outbox.at(-1)).toMatchObject({ kind: "wa_template", template: "hello_world", from: WA.externalId });
  });

  it("randevu bildirimleri işletmenin kendi numarasından gider", async () => {
    const s = await setupSalon(a);
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(4, "11:00") }).expect(201)).body;
    const n = await waitFor(
      () => su.notification.findFirstOrThrow({ where: { appointmentId: appt.id, template: "randevu_onay" } }),
      (x) => x.status !== "QUEUED",
    );
    expect(n.status).toBe("SENT");
    const sent = outbox.find((o) => o.messageId === n.providerMessageId)!;
    expect(sent).toMatchObject({ kind: "wa_template", from: WA.externalId, template: "randevu_onay" });
  });

  it("yapay zekâ yanıtları Akıllı paket ve veri aktarım onayı ister", async () => {
    await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true, aiDataConsent: true }).expect(403);
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
    await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true }).expect(400);
    const r = await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true, aiDataConsent: true }).expect(200);
    expect(r.body.aiAutoReply).toBe(true);
    expect(r.body.aiDataConsentAt).not.toBeNull();
    const off = await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true, aiDataConsent: false }).expect(200);
    expect(off.body).toMatchObject({ aiAutoReply: false, aiDataConsentAt: null });
  });

  it("WhatsApp özelliği olmayan pakette kanal sayfası kapalı", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { planCode: "STARTER" } });
    await b.get("/channels").expect(403);
  });

  it("instagram bağlantısı: WABA gerekmez, doğrulama hesap adını getirir", async () => {
    await a.put("/channels/instagram").send({ externalId: "17841400000001", accessToken: TOKEN, appSecret: SECRET }).expect(200);
    const r = await a.post("/channels/instagram/verify").expect(200);
    expect(r.body.displayName).toMatch(/^@test_hesap_/);
  });

  it("bağlantı kapatılınca sırlar silinir ve webhook kabul edilmez", async () => {
    const r = await a.delete("/channels/instagram").expect(200);
    expect(r.body.status).toBe("DISABLED");
    const row = await su.channelConnection.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([row.accessTokenEnc, row.appSecretEnc]).toEqual(["", ""]);
    await request(app.getHttpServer()).get(`/webhooks/meta/${r.body.id}`).query({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" }).expect(404);
  });
});

describe("Meta istemcileri (ağ çağrısı yapılmadan)", () => {
  it("canlıda kapalı istemci hiçbir istek yapmaz", async () => {
    const g = new DisabledMetaGateway();
    await expect(g.sendWhatsAppText({ phoneNumberId: "1", accessToken: "x" }, "905551112233", "x")).rejects.toBeInstanceOf(MetaDisabledError);
  });

  it("gerçek istemci Graph API isteklerini belgelere uygun kurar", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes("graph.instagram.com") ? { message_id: "mid.1" } : { messages: [{ id: "wamid.1" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const g = new LiveMetaGateway(fake);
    await g.sendWhatsAppTemplate({ phoneNumberId: "123", accessToken: "tok" }, "0555 111 22 33", "randevu_onay", ["Ayşe", "Salon"]);
    await g.sendWhatsAppText({ phoneNumberId: "123", accessToken: "tok" }, "05551112233", "Merhaba");
    await g.sendInstagramText({ igId: "1784", accessToken: "tok" }, "IGSID9", "Merhaba");
    expect(calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/123\/messages$/);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "905551112233",
      type: "template",
      template: { name: "randevu_onay", language: { code: "tr" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ayşe" }, { type: "text", text: "Salon" }] }] },
    });
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ type: "text", text: { body: "Merhaba" } });
    expect(calls[2].url).toMatch(/^https:\/\/graph\.instagram\.com\/v\d+\.\d\/1784\/messages$/);
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ recipient: { id: "IGSID9" }, message: { text: "Merhaba" } });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("Meta hata yanıtı anahtar içermeden hataya çevrilir", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token.", code: 190 } }), { status: 401 })) as unknown as typeof fetch;
    const g = new LiveMetaGateway(fake);
    await expect(g.verifyWhatsApp({ phoneNumberId: "1", accessToken: "SECRET_TOKEN" })).rejects.toThrow(/Invalid OAuth/);
    await expect(g.verifyWhatsApp({ phoneNumberId: "1", accessToken: "SECRET_TOKEN" })).rejects.not.toThrow(/SECRET_TOKEN/);
  });
});
