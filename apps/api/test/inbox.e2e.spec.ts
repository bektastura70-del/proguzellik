import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { MockMetaGateway } from "../src/messaging/meta.gateway";
import { parseInstagram, parseWhatsApp } from "../src/messaging/webhooks.controller";
import { igText, signedPost, waText } from "./meta-helpers";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const SECRET_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PHONE_A = "3065403522429";
const PHONE_B = "3165403522429";
const IG_A = "17841400000777";

describe("Gelen kutusu: Meta webhook'ları, personel yanıtı, 24 saat kuralı", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let rcp: ReturnType<typeof api>;
  let st: ReturnType<typeof api>;
  let waA: string;
  let waB: string;
  let igA: string;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let outbox: MockMetaGateway["outbox"];

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Gelen Kutusu Salon", email: "ia@test.local" });
    const B = await createTenantWithUser(su, { name: "Başka Salon", email: "ib@test.local" });
    app = await createApp();
    outbox = app.get(MockMetaGateway).outbox;
    a = api(app, await login(app, "ia@test.local"), A.tenant.id);
    b = api(app, await login(app, "ib@test.local"), B.tenant.id);
    await addMember(app, a, { email: "ir@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    await addMember(app, a, { email: "is@test.local", fullName: "Uzman", role: "STAFF" });
    rcp = api(app, await login(app, "ir@test.local"), A.tenant.id);
    st = api(app, await login(app, "is@test.local"), A.tenant.id);
    s = await setupSalon(a);
    await a.patch(`/customers/${s.customer.id}`).send({ marketingConsent: true }).expect(200);
    waA = (await a.put("/channels/whatsapp").send({ externalId: PHONE_A, businessAccountId: "1000000001", accessToken: "EAAinboxTOKENaaaaaaaaaaaaaaaaaaaaaa", appSecret: SECRET_A }).expect(200)).body.id;
    await a.post("/channels/whatsapp/verify").expect(200);
    igA = (await a.put("/channels/instagram").send({ externalId: IG_A, accessToken: "IGinboxTOKENaaaaaaaaaaaaaaaaaaaaaa", appSecret: SECRET_A }).expect(200)).body.id;
    await a.post("/channels/instagram/verify").expect(200);
    waB = (await b.put("/channels/whatsapp").send({ externalId: PHONE_B, businessAccountId: "1000000002", accessToken: "EAAinboxTOKENbbbbbbbbbbbbbbbbbbbbbb", appSecret: SECRET_B }).expect(200)).body.id;
    await b.post("/channels/whatsapp/verify").expect(200);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("imzasız veya yanlış imzalı istek reddedilir", async () => {
    const body = waText(PHONE_A, "905550000001", "wamid.X1", "Merhaba");
    await request(app.getHttpServer()).post(`/webhooks/meta/${waA}`).send(body).expect(403);
    await signedPost(app, waA, body, SECRET_B).expect(403);
    expect(await su.conversationMessage.count()).toBe(0);
  });

  let convId: string;
  it("WhatsApp metin mesajı kaydedilir ve telefonla müşteriye bağlanır", async () => {
    const r = await signedPost(app, waA, waText(PHONE_A, "905550000001", "wamid.A1", "Merhaba, lazer fiyatı nedir?"), SECRET_A).expect(200);
    expect(r.body).toMatchObject({ received: true, stored: 1 });
    const conv = await su.conversation.findFirstOrThrow({ where: { tenantId: A.tenant.id, channel: "WHATSAPP" } });
    convId = conv.id;
    expect(conv).toMatchObject({ externalUserId: "905550000001", displayName: "Ayşe Test", customerId: s.customer.id, unread: 1, mode: "AI" });
    expect((await su.channelConnection.findUniqueOrThrow({ where: { id: waA } })).lastWebhookAt).not.toBeNull();
  });

  it("Meta aynı olayı tekrar gönderirse ikinci kez kaydedilmez", async () => {
    const r = await signedPost(app, waA, waText(PHONE_A, "905550000001", "wamid.A1", "Merhaba, lazer fiyatı nedir?"), SECRET_A).expect(200);
    expect(r.body.stored).toBe(0);
    expect(await su.conversationMessage.count({ where: { conversationId: convId } })).toBe(1);
  });

  it("başka numaraya ait olay bu bağlantıya yazılmaz; işletmeler birbirinin konuşmasını göremez", async () => {
    const r = await signedPost(app, waB, waText(PHONE_A, "905550000001", "wamid.A2", "Sızma denemesi"), SECRET_B).expect(200);
    expect(r.body.stored).toBe(0);
    expect((await b.get("/conversations").expect(200)).body).toHaveLength(0);
    await b.get(`/conversations/${convId}`).expect(404);
    await b.post(`/conversations/${convId}/messages`).send({ text: "x" }).expect(404);
  });

  it("gelen kutusu listesi ve okununca okunmamış sayısı sıfırlanır; uzman rolü erişemez", async () => {
    await st.get("/conversations").expect(403);
    const list = (await rcp.get("/conversations").expect(200)).body;
    expect(list[0]).toMatchObject({ id: convId, unread: 1, windowOpen: true, customer: { firstName: "Ayşe" } });
    expect(list[0].state).toBeUndefined();
    const conv = (await rcp.get(`/conversations/${convId}`).expect(200)).body;
    expect(conv.messages).toHaveLength(1);
    expect((await su.conversation.findUniqueOrThrow({ where: { id: convId } })).unread).toBe(0);
  });

  it("menü rozeti: personelin yanıtını bekleyen (HUMAN, okunmamış) konuşma sayısı; yalnız kendi işletmesi; okununca düşer", async () => {
    const before = await su.conversation.findUniqueOrThrow({ where: { id: convId } });
    await su.conversation.update({ where: { id: convId }, data: { mode: "HUMAN", unread: 2 } });
    expect((await rcp.get("/conversations/summary").expect(200)).body).toEqual({ unread: 1, needsStaff: 1 });
    expect((await b.get("/conversations/summary").expect(200)).body).toEqual({ unread: 0, needsStaff: 0 });
    await st.get("/conversations/summary").expect(403);
    // Yapay zekâ konuşmadayken okunmamış mesaj personele bekleyen iş sayılmaz
    await su.conversation.update({ where: { id: convId }, data: { mode: "AI" } });
    expect((await rcp.get("/conversations/summary").expect(200)).body).toEqual({ unread: 1, needsStaff: 0 });
    await su.conversation.update({ where: { id: convId }, data: { mode: "HUMAN" } });
    await rcp.get(`/conversations/${convId}`).expect(200);
    expect((await rcp.get("/conversations/summary").expect(200)).body).toEqual({ unread: 0, needsStaff: 0 });
    await su.conversation.update({ where: { id: convId }, data: { mode: before.mode, unread: before.unread } });
  });

  it("personel yanıtı müşteriye gider (test modunda işaretli) ve yapay zekâ susar", async () => {
    const r = await rcp.post(`/conversations/${convId}/messages`).send({ text: "Merhaba Ayşe Hanım, lazer 1000 TL." }).expect(201);
    expect(r.body).toMatchObject({ author: "STAFF", status: "SENT", simulated: true });
    expect(outbox.at(-1)).toMatchObject({ kind: "wa_text", from: PHONE_A, to: "905550000001", text: "Merhaba Ayşe Hanım, lazer 1000 TL." });
    expect((await su.conversation.findUniqueOrThrow({ where: { id: convId } })).mode).toBe("HUMAN");
    await rcp.patch(`/conversations/${convId}/mode`).send({ mode: "AI" }).expect(200);
  });

  it("teslim durumu webhook'u giden mesajı günceller", async () => {
    const msg = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: convId, author: "STAFF" } });
    const body = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_A }, statuses: [{ id: msg.providerMessageId, status: "read", timestamp: "1", recipient_id: "905550000001" }] } }] }] };
    const r = await signedPost(app, waA, body, SECRET_A).expect(200);
    expect(r.body.updated).toBe(1);
    expect((await su.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("READ");
  });

  it("bir işletme kendi imzalı webhook'uyla başka işletmenin mesaj durumunu değiştiremez", async () => {
    const msg = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: convId, author: "STAFF" } });
    await su.conversationMessage.update({ where: { id: msg.id }, data: { status: "SENT" } });
    const body = { object: "whatsapp_business_account", entry: [{ id: "2", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_B }, statuses: [{ id: msg.providerMessageId, status: "failed", timestamp: "1", recipient_id: "905550000001" }] } }] }] };
    const r = await signedPost(app, waB, body, SECRET_B).expect(200);
    expect(r.body.updated).toBe(0);
    expect((await su.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("SENT");
  });

  it("24 saat penceresi kapanınca serbest mesaj gönderilmez", async () => {
    await su.conversation.update({ where: { id: convId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    const r = await rcp.post(`/conversations/${convId}/messages`).send({ text: "Geç yanıt" }).expect(409);
    expect(r.body.code).toBe("WINDOW_CLOSED");
    expect((await rcp.get("/conversations").expect(200)).body[0].windowOpen).toBe(false);
  });

  it("müşteri RET yazınca ticari ileti izni geri çekilir", async () => {
    await signedPost(app, waA, waText(PHONE_A, "905550000001", "wamid.A3", "RET"), SECRET_A).expect(200);
    expect((await su.customer.findUniqueOrThrow({ where: { id: s.customer.id } })).marketingConsent).toBe(false);
    const audit = await su.auditLog.findFirst({ where: { action: "customer.marketing_opt_out" } });
    expect(audit?.entityId).toBe(s.customer.id);
  });

  it("metin dışı mesajlar açıklamayla kaydedilir", async () => {
    const body = waText(PHONE_A, "905559999999", "wamid.IMG", "");
    const m = body.entry[0].changes[0].value.messages[0] as Record<string, unknown>;
    m.type = "image";
    delete m.text;
    await signedPost(app, waA, body, SECRET_A).expect(200);
    const msg = await su.conversationMessage.findFirstOrThrow({ where: { providerMessageId: "wamid.IMG" } });
    expect(msg.text).toMatch(/^\[Fotoğraf gönderildi/);
  });

  it("Instagram mesajı kaydedilir; işletmenin kendi yankı mesajı alınmaz; yanıt Instagram'dan gider", async () => {
    await signedPost(app, igA, igText(IG_A, "IGSID123", "mid.1", "Selam, cumartesi açık mısınız?"), SECRET_A).expect(200);
    const echo = await signedPost(app, igA, igText(IG_A, "IGSID123", "mid.2", "yankı", true), SECRET_A).expect(200);
    expect(echo.body.stored).toBe(0);
    const conv = await su.conversation.findFirstOrThrow({ where: { channel: "INSTAGRAM" } });
    expect(conv.customerId).toBeNull();
    await a.post(`/conversations/${conv.id}/messages`).send({ text: "Evet, 09:00-18:00 açığız." }).expect(201);
    expect(outbox.at(-1)).toMatchObject({ kind: "ig_text", from: IG_A, to: "IGSID123" });
  });

  it("randevu şablonu gönderilince müşterinin konuşmasına eklenir", async () => {
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(6, "15:00") }).expect(201)).body;
    const n = await waitFor(() => su.notification.findFirstOrThrow({ where: { appointmentId: appt.id, template: "randevu_onay" } }), (x) => x.status === "SENT");
    const m = await waitFor(() => su.conversationMessage.findFirst({ where: { providerMessageId: n.providerMessageId } }), (x) => !!x);
    expect(m).toMatchObject({ conversationId: convId, author: "SYSTEM", direction: "OUT" });
    expect(m!.text).toMatch(/randevunuz oluşturuldu/);
  });
});

describe("Meta gövde ayrıştırıcıları", () => {
  it("WhatsApp: yalnızca bu numaraya ait mesajlar; düğme yanıtları metin sayılır", () => {
    const body = waText("111", "905551112233", "wamid.1", "Merhaba");
    expect(parseWhatsApp(body, "222").messages).toHaveLength(0);
    const r = parseWhatsApp(body, "111");
    expect(r.messages[0]).toMatchObject({ externalUserId: "905551112233", name: "Ayşe Test", providerMessageId: "wamid.1", text: "Merhaba", isText: true });
    const btn = waText("111", "905551112233", "wamid.2", "");
    (btn.entry[0].changes[0].value.messages[0] as Record<string, unknown>).type = "button";
    (btn.entry[0].changes[0].value.messages[0] as Record<string, unknown>).button = { text: "Evet" };
    expect(parseWhatsApp(btn, "111").messages[0]).toMatchObject({ text: "Evet", isText: true });
    expect(parseWhatsApp({ object: "page" }, "111").messages).toHaveLength(0);
  });

  it("Instagram: başka hesabın girdisi ve yankılar alınmaz", () => {
    expect(parseInstagram(igText("999", "S1", "m1", "x"), "111").messages).toHaveLength(0);
    expect(parseInstagram(igText("111", "S1", "m1", "x", true), "111").messages).toHaveLength(0);
    expect(parseInstagram(igText("111", "S1", "m1", "Selam"), "111").messages[0]).toMatchObject({ externalUserId: "S1", text: "Selam", isText: true });
  });
});
