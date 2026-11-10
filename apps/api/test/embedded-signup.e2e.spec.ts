import { META_APP } from "./meta-app-env";
import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";
import { openSecret } from "../src/messaging/channels.service";
import { MockMetaGateway } from "../src/messaging/meta.gateway";
import { waText } from "./meta-helpers";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

const WABA_A = "1916012116028454";
const PHONE_A = "1426466143873502";
const WABA_B = "1916012116029999";
const PHONE_B = "1426466143879999";

function appPost(app: INestApplication, body: unknown, secret = META_APP.appSecret) {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return request(app.getHttpServer()).post("/webhooks/meta").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw);
}

describe("WhatsApp'ı bağla (Embedded Signup) ve ortak webhook", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let m: ReturnType<typeof api>;
  let meta: MockMetaGateway;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "ES Salon", email: "esa@test.local" });
    B = await createTenantWithUser(su, { name: "ES Diğer", email: "esb@test.local" });
    app = await createApp();
    meta = app.get(MockMetaGateway);
    meta.phones.set(WABA_A, [PHONE_A]);
    meta.phones.set(WABA_B, [PHONE_B]);
    a = api(app, await login(app, "esa@test.local"), A.tenant.id);
    b = api(app, await login(app, "esb@test.local"), B.tenant.id);
    await addMember(app, a, { email: "esm@test.local", fullName: "Yönetici", role: "MANAGER" });
    m = api(app, await login(app, "esm@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("panel düğme için yalnızca herkese açık kimlikleri alır (uygulama sırrı yok)", async () => {
    const r = await a.get("/channels").expect(200);
    expect(r.body.embeddedSignup).toEqual({ appId: META_APP.appId, configId: META_APP.configId, graphVersion: expect.any(String) });
    expect(JSON.stringify(r.body)).not.toContain(META_APP.appSecret);
  });

  it("yalnızca işletme sahibi bağlar; numara o hesaba ait değilse bağlanmaz", async () => {
    await m.post("/channels/whatsapp/embedded-signup").send({ code: "kod-yonetici-123", phoneNumberId: PHONE_A, wabaId: WABA_A }).expect(403);
    const wrong = await a.post("/channels/whatsapp/embedded-signup").send({ code: "kod-yanlis-1234", phoneNumberId: PHONE_B, wabaId: WABA_A }).expect(422);
    expect(wrong.body.message).toContain("bulunamadı");
    await a.post("/channels/whatsapp/embedded-signup").send({ code: "gecersiz-kod-12", phoneNumberId: PHONE_A, wabaId: WABA_A }).expect(422);
    expect(await su.channelConnection.count({ where: { tenantId: A.tenant.id } })).toBe(0);
  });

  it("bağlanınca abonelik ve numara kaydı yapılır; anahtar ve PIN şifreli saklanır", async () => {
    const r = await a.post("/channels/whatsapp/embedded-signup").send({ code: "kod-dogru-12345", phoneNumberId: PHONE_A, wabaId: WABA_A }).expect(200);
    expect(r.body).toMatchObject({ status: "CONNECTED", managed: true, externalId: PHONE_A, businessAccountId: WABA_A, simulated: true });
    expect(r.body.webhookUrl).toMatch(/\/api\/webhooks\/meta$/);
    expect(meta.subscribed.has(WABA_A)).toBe(true);
    const pin = meta.registered.get(PHONE_A)!;
    expect(pin).toMatch(/^\d{6}$/);
    const row = await su.channelConnection.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    expect(row.appSecretEnc).toBe("");
    expect(row.pinEnc).not.toContain(pin);
    expect(openSecret(row.pinEnc!)).toBe(pin);
    expect(openSecret(row.accessTokenEnc)).toContain("kod-dogru-12345");
    expect(JSON.stringify(r.body)).not.toContain(pin);
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "channel.embedded_signup" } })).toBe(1);
  });

  it("aynı numara başka işletmeye bağlanamaz ve Meta'da hiçbir şey değiştirilmez", async () => {
    meta.phones.set(WABA_B, [PHONE_B, PHONE_A]);
    const before = meta.registered.get(PHONE_A);
    await b.post("/channels/whatsapp/embedded-signup").send({ code: "kod-baska-12345", phoneNumberId: PHONE_A, wabaId: WABA_B }).expect(409);
    expect(meta.registered.get(PHONE_A)).toBe(before);
    meta.phones.set(WABA_B, [PHONE_B]);
  });

  it("ortak webhook: doğrulama belirteci ve imza zorunlu", async () => {
    await request(app.getHttpServer()).get("/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "yanlis", "hub.challenge": "x" }).expect(403);
    const ok = await request(app.getHttpServer()).get("/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": META_APP.verifyToken, "hub.challenge": "abc123" }).expect(200);
    expect(ok.text).toBe("abc123");
    await appPost(app, waText(PHONE_A, "905551110001", "wamid.ES1", "Merhaba"), "0".repeat(32)).expect(403);
    await request(app.getHttpServer()).post("/webhooks/meta").set("Content-Type", "application/json").send(JSON.stringify(waText(PHONE_A, "905551110001", "wamid.ES1", "Merhaba"))).expect(403);
  });

  it("ortak webhook mesajı numaraya göre doğru salona yönlendirir; bilinmeyen numara yok sayılır", async () => {
    const r = await appPost(app, waText(PHONE_A, "905551110001", "wamid.ES2", "Yarın randevu var mı?")).expect(200);
    expect(r.body).toMatchObject({ stored: 1 });
    const conv = await su.conversation.findFirstOrThrow({ where: { externalUserId: "905551110001" } });
    expect(conv.tenantId).toBe(A.tenant.id);
    const unknown = await appPost(app, waText("999999999999", "905551110002", "wamid.ES3", "Selam")).expect(200);
    expect(unknown.body).toMatchObject({ stored: 0 });
    expect(await su.conversation.count({ where: { externalUserId: "905551110002" } })).toBe(0);
  });

  it("aynı numaranın hatalı kalmış başka kaydı varsa mesaj yalnızca bağlı (CONNECTED) salona gider", async () => {
    // B'nin aynı numarayla yarım kalmış (ERROR) bir denemesi olsun.
    await su.channelConnection.create({ data: { tenantId: B.tenant.id, channel: "WHATSAPP", status: "ERROR", managed: true, externalId: PHONE_A, businessAccountId: WABA_A, accessTokenEnc: "", tokenLast4: "", appSecretEnc: "", verifyTokenEnc: "x" } });
    for (let i = 0; i < 3; i++) await appPost(app, waText(PHONE_A, `90555111020${i}`, `wamid.ESX${i}`, "Selam")).expect(200);
    expect(await su.conversation.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    expect(await su.conversation.count({ where: { tenantId: A.tenant.id, externalUserId: { startsWith: "90555111020" } } })).toBe(3);
    await su.channelConnection.deleteMany({ where: { tenantId: B.tenant.id } });
  });

  it("ProGüzellik uygulamasıyla bağlı numaraya bağlantıya özel adresten olay gönderilemez", async () => {
    const row = await su.channelConnection.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    await appPost(app, waText(PHONE_A, "905551110003", "wamid.ES4", "Selam")).expect(200);
    const raw = JSON.stringify(waText(PHONE_A, "905551110004", "wamid.ES5", "Selam"));
    const sig = "sha256=" + createHmac("sha256", META_APP.appSecret).update(raw).digest("hex");
    await request(app.getHttpServer()).post(`/webhooks/meta/${row.id}`).set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw).expect(404);
  });

  it("bağlantı kapatılınca abonelik kaldırılır ve ortak webhook artık o salona yazmaz", async () => {
    await a.delete("/channels/whatsapp").expect(200);
    expect(meta.subscribed.has(WABA_A)).toBe(false);
    const r = await appPost(app, waText(PHONE_A, "905551110005", "wamid.ES6", "Selam")).expect(200);
    expect(r.body).toMatchObject({ stored: 0 });
  });
});

describe("Gerçek Meta istemcisi Embedded Signup istekleri (sahte fetch; Meta'ya istek yapılmaz)", () => {
  it("kod değişimi, abonelik, numara kaydı ve abonelik kaldırma belgedeki biçimde gider", async () => {
    const { LiveMetaGateway } = await import("../src/messaging/meta.gateway");
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = url.includes("oauth/access_token") ? { access_token: "EAAbusinesstoken", token_type: "bearer" } : url.includes("phone_numbers") ? { data: [{ id: PHONE_A }] } : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const g = new LiveMetaGateway(fake);
    expect(await g.exchangeCode({ appId: META_APP.appId, appSecret: META_APP.appSecret }, "CODE123")).toEqual({ accessToken: "EAAbusinesstoken" });
    expect(await g.wabaPhoneNumbers(WABA_A, "EAAbusinesstoken")).toEqual([PHONE_A]);
    await g.subscribeApp(WABA_A, "EAAbusinesstoken");
    await g.registerPhone(PHONE_A, "EAAbusinesstoken", "123456");
    await g.unsubscribeApp(WABA_A, "EAAbusinesstoken");
    const u0 = new URL(calls[0].url);
    expect(u0.pathname).toMatch(/^\/v[\d.]+\/oauth\/access_token$/);
    expect(Object.fromEntries(u0.searchParams)).toEqual({ client_id: META_APP.appId, client_secret: META_APP.appSecret, code: "CODE123" });
    expect(calls[2]).toMatchObject({ url: expect.stringMatching(new RegExp(`/${WABA_A}/subscribed_apps$`)), init: { method: "POST" } });
    expect(calls[3].url).toMatch(new RegExp(`/${PHONE_A}/register$`));
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ messaging_product: "whatsapp", pin: "123456" });
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe("Bearer EAAbusinesstoken");
    expect(calls[4].init.method).toBe("DELETE");
  });
});
