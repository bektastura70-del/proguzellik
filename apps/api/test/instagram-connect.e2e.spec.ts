import { META_APP } from "./meta-app-env";
import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";
import { openSecret } from "../src/messaging/channels.service";
import { MockMetaGateway } from "../src/messaging/meta.gateway";
import { igText } from "./meta-helpers";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

const IG_A = "17841400000000111";
const IG_B = "17841400000000222";

function appPost(app: INestApplication, body: unknown, secret = META_APP.appSecret) {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return request(app.getHttpServer()).post("/webhooks/meta").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw);
}

describe("Instagram'ı bağla (Unified Login) ve ortak webhook", () => {
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
    A = await createTenantWithUser(su, { name: "IG Salon", email: "iga@test.local" });
    B = await createTenantWithUser(su, { name: "IG Diğer", email: "igb@test.local" });
    app = await createApp();
    meta = app.get(MockMetaGateway);
    meta.igAccounts.set("kod-a", [{ id: IG_A, username: "salon_a" }]);
    meta.igAccounts.set("kod-b", [{ id: IG_B, username: "salon_b" }]);
    meta.igAccounts.set("kod-ikisi", [{ id: IG_A, username: "salon_a" }, { id: IG_B, username: "salon_b" }]);
    meta.igAccounts.set("kod-gasp", [{ id: IG_A, username: "salon_a" }]);
    a = api(app, await login(app, "iga@test.local"), A.tenant.id);
    b = api(app, await login(app, "igb@test.local"), B.tenant.id);
    await addMember(app, a, { email: "igm@test.local", fullName: "Yönetici", role: "MANAGER" });
    m = api(app, await login(app, "igm@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("panel düğme için yalnızca herkese açık kimlikleri alır (uygulama sırrı yok)", async () => {
    const r = await a.get("/channels").expect(200);
    expect(r.body.instagramConnect).toEqual({ appId: META_APP.appId, configId: META_APP.igConfigId, graphVersion: expect.any(String) });
    expect(JSON.stringify(r.body)).not.toContain(META_APP.appSecret);
  });

  it("yalnızca işletme sahibi bağlar; hesap paylaşılmadıysa veya birden fazlaysa bağlanmaz", async () => {
    await m.post("/channels/instagram/connect").send({ code: "kod-a-yonetici" }).expect(403);
    const none = await a.post("/channels/instagram/connect").send({ code: "kod-hesapsiz-1" }).expect(422);
    expect(none.body.message).toContain("paylaşılmadı");
    const two = await a.post("/channels/instagram/connect").send({ code: "kod-ikisi-12345" }).expect(422);
    expect(two.body.message).toContain("birden fazla");
    await a.post("/channels/instagram/connect").send({ code: "gecersiz-kod-12" }).expect(422);
    // Tarayıcıdan gelen hesap kimliği dikkate alınmaz: hesap yalnızca Meta'dan okunur.
    await a.post("/channels/instagram/connect").send({ code: "kod-hesapsiz-2", igId: IG_A }).expect(422);
    expect(await su.channelConnection.count({ where: { tenantId: A.tenant.id } })).toBe(0);
    expect(meta.igSubscribed.size).toBe(0);
  });

  it("bağlanınca hesap webhook'a abone edilir; anahtar şifreli saklanır ve yanıtta yok", async () => {
    const r = await a.post("/channels/instagram/connect").send({ code: "kod-a-dogru-123" }).expect(200);
    expect(r.body).toMatchObject({ channel: "INSTAGRAM", status: "CONNECTED", managed: true, externalId: IG_A, displayName: expect.stringContaining("@"), simulated: true });
    expect(r.body.webhookUrl).toMatch(/\/api\/webhooks\/meta$/);
    expect(meta.igSubscribed.has(IG_A)).toBe(true);
    const row = await su.channelConnection.findFirstOrThrow({ where: { tenantId: A.tenant.id, channel: "INSTAGRAM" } });
    expect(row.appSecretEnc).toBe("");
    expect(row.accessTokenEnc).not.toContain("kod-a-dogru-123");
    expect(openSecret(row.accessTokenEnc)).toContain("kod-a-dogru-123");
    expect(JSON.stringify(r.body)).not.toContain("EAAmock");
    const audit = await su.auditLog.findMany({ where: { tenantId: A.tenant.id, action: "channel.instagram_connect" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("EAAmock");
  });

  it("aynı Instagram hesabı başka işletmeye bağlanamaz ve Meta'da hiçbir şey değiştirilmez", async () => {
    meta.igSubscribed.clear();
    await b.post("/channels/instagram/connect").send({ code: "kod-gasp-12345" }).expect(409);
    expect(meta.igSubscribed.size).toBe(0);
    expect(await su.channelConnection.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    meta.igSubscribed.add(IG_A);
  });

  it("bağlı hesap varken başka bir hesap bağlanamaz (önce kapatılmalı)", async () => {
    await a.post("/channels/instagram/connect").send({ code: "kod-b-baska-1" }).expect(409);
    expect(meta.igSubscribed.has(IG_B)).toBe(false);
  });

  it("ortak webhook: imza zorunlu", async () => {
    await appPost(app, igText(IG_A, "9001", "mid.IG0", "Merhaba"), "0".repeat(32)).expect(403);
    await request(app.getHttpServer()).post("/webhooks/meta").set("Content-Type", "application/json").send(JSON.stringify(igText(IG_A, "9001", "mid.IG0", "Merhaba"))).expect(403);
  });

  it("ortak webhook Instagram mesajını hesap kimliğine göre doğru salona yönlendirir; yankı ve bilinmeyen hesap yok sayılır", async () => {
    const r = await appPost(app, igText(IG_A, "9002", "mid.IG1", "Yarın boş saat var mı?")).expect(200);
    expect(r.body).toMatchObject({ stored: 1 });
    const conv = await su.conversation.findFirstOrThrow({ where: { externalUserId: "9002" } });
    expect(conv).toMatchObject({ tenantId: A.tenant.id, channel: "INSTAGRAM" });
    expect((await appPost(app, igText(IG_A, "9002", "mid.IG2", "yanıt", true)).expect(200)).body).toMatchObject({ stored: 0 });
    expect((await appPost(app, igText("17841499999999999", "9003", "mid.IG3", "Selam")).expect(200)).body).toMatchObject({ stored: 0 });
    expect(await su.conversation.count({ where: { externalUserId: "9003" } })).toBe(0);
    // Aynı olay tekrar gelirse ikinci kez kaydedilmez.
    expect((await appPost(app, igText(IG_A, "9002", "mid.IG1", "Yarın boş saat var mı?")).expect(200)).body).toMatchObject({ stored: 0 });
  });

  it("Instagram konuşması telefon numarasıyla kayıtlı müşteriye otomatik bağlanmaz", async () => {
    await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Kayıtlı", lastName: "Müşteri", phone: "905551234567" } });
    await appPost(app, igText(IG_A, "905551234567", "mid.IG4", "Merhaba")).expect(200);
    const conv = await su.conversation.findFirstOrThrow({ where: { externalUserId: "905551234567" } });
    expect(conv.customerId).toBeNull();
  });

  it("hatalı kalmış başka kayıt varsa olay yalnızca bağlı (CONNECTED) salona gider", async () => {
    await su.channelConnection.create({ data: { tenantId: B.tenant.id, channel: "INSTAGRAM", status: "ERROR", managed: true, externalId: IG_A, accessTokenEnc: "", tokenLast4: "", appSecretEnc: "", verifyTokenEnc: "x" } });
    await appPost(app, igText(IG_A, "9005", "mid.IG5", "Selam")).expect(200);
    expect(await su.conversation.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    expect(await su.conversation.count({ where: { tenantId: A.tenant.id, externalUserId: "9005" } })).toBe(1);
    await su.channelConnection.deleteMany({ where: { tenantId: B.tenant.id } });
  });

  it("personel yanıtı ProGüzellik bağlantısı üzerinden gider", async () => {
    const conv = await su.conversation.findFirstOrThrow({ where: { externalUserId: "9002" } });
    const before = meta.outbox.length;
    await a.post(`/conversations/${conv.id}/messages`).send({ text: "Evet, saat 14:00 boş." }).expect((r) => expect([200, 201]).toContain(r.status));
    const sent = meta.outbox.slice(before);
    expect(sent).toEqual([expect.objectContaining({ kind: "ig_text", from: IG_A, to: "9002" })]);
  });

  it("bağlantıya özel adresten (elle kurulum yolu) olay gönderilemez", async () => {
    const row = await su.channelConnection.findFirstOrThrow({ where: { tenantId: A.tenant.id, channel: "INSTAGRAM" } });
    const raw = JSON.stringify(igText(IG_A, "9006", "mid.IG6", "Selam"));
    const sig = "sha256=" + createHmac("sha256", META_APP.appSecret).update(raw).digest("hex");
    await request(app.getHttpServer()).post(`/webhooks/meta/${row.id}`).set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw).expect(404);
  });

  it("bağlantı kapatılınca abonelik kaldırılır, anahtar silinir ve ortak webhook artık o salona yazmaz", async () => {
    await a.delete("/channels/instagram").expect(200);
    expect(meta.igSubscribed.has(IG_A)).toBe(false);
    const row = await su.channelConnection.findFirstOrThrow({ where: { tenantId: A.tenant.id, channel: "INSTAGRAM" } });
    expect(row).toMatchObject({ status: "DISABLED", accessTokenEnc: "" });
    expect((await appPost(app, igText(IG_A, "9007", "mid.IG7", "Selam")).expect(200)).body).toMatchObject({ stored: 0 });
  });

  it("kapatıldıktan sonra hesap başka işletmeye bağlanabilir", async () => {
    const r = await b.post("/channels/instagram/connect").send({ code: "kod-gasp-67890" }).expect(200);
    expect(r.body).toMatchObject({ status: "CONNECTED", externalId: IG_A });
    expect((await appPost(app, igText(IG_A, "9008", "mid.IG8", "Selam")).expect(200)).body).toMatchObject({ stored: 1 });
    expect(await su.conversation.count({ where: { tenantId: B.tenant.id, externalUserId: "9008" } })).toBe(1);
  });
});

describe("Gerçek Meta istemcisi Instagram (Unified Login) istekleri (sahte fetch; Meta'ya istek yapılmaz)", () => {
  it("hesap listesi, abonelik, doğrulama, gönderim ve abonelik kaldırma graph.facebook.com'a belgedeki biçimde gider", async () => {
    const { LiveMetaGateway } = await import("../src/messaging/meta.gateway");
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = url.includes("assigned_instagram_accounts")
        ? { data: [{ id: IG_A, username: "salon_a" }] }
        : url.includes("/messages")
          ? { recipient_id: "9002", message_id: "mid.out1" }
          : url.includes("fields=id,username")
            ? { id: IG_A, username: "salon_a" }
            : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const g = new LiveMetaGateway(fake);
    const tok = "EAAsystemusertoken";
    expect(await g.instagramAccounts(tok)).toEqual([{ id: IG_A, username: "salon_a" }]);
    await g.subscribeInstagram(IG_A, tok);
    expect(await g.verifyInstagram({ igId: IG_A, accessToken: tok, managed: true })).toEqual({ displayName: "@salon_a" });
    expect(await g.sendInstagramText({ igId: IG_A, accessToken: tok, managed: true }, "9002", "Merhaba")).toEqual({ messageId: "mid.out1" });
    await g.unsubscribeInstagram(IG_A, tok);
    for (const c of calls) {
      expect(new URL(c.url).host).toBe("graph.facebook.com");
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${tok}`);
      expect(c.url).not.toContain(tok);
    }
    expect(new URL(calls[0].url).pathname).toMatch(/^\/v[\d.]+\/me\/assigned_instagram_accounts$/);
    expect(calls[1]).toMatchObject({ init: { method: "POST" } });
    expect(new URL(calls[1].url).pathname).toMatch(new RegExp(`/${IG_A}/subscribed_apps$`));
    expect(new URL(calls[1].url).searchParams.get("subscribed_fields")).toBe("messages");
    expect(new URL(calls[3].url).pathname).toMatch(new RegExp(`/${IG_A}/messages$`));
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ recipient: { id: "9002" }, message: { text: "Merhaba" } });
    expect(calls[4]).toMatchObject({ init: { method: "DELETE" } });
  });

  it("elle kurulan Instagram bağlantısı graph.instagram.com'u kullanmaya devam eder", async () => {
    const { LiveMetaGateway } = await import("../src/messaging/meta.gateway");
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ message_id: "mid.x" }), { status: 200 });
    }) as unknown as typeof fetch;
    await new LiveMetaGateway(fake).sendInstagramText({ igId: IG_B, accessToken: "IGQtoken" }, "9002", "Selam");
    expect(new URL(urls[0]).host).toBe("graph.instagram.com");
  });
});
