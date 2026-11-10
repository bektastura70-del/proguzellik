import { INestApplication } from "@nestjs/common";
import { toZoned } from "../src/common/time";
import { AnthropicChatAgent, ChatAgent, ChatInput, ChatOutput, DisabledChatAgent, MockChatAgent } from "../src/messaging/chat/chat-agent";
import { ChatTools, isAffirmative } from "../src/messaging/chat/chat-tools";
import { ConversationEngine, toTurns } from "../src/messaging/chat/conversation-engine";
import { InboxService } from "../src/messaging/inbox.service";
import { MockMetaGateway } from "../src/messaging/meta.gateway";
import { PrismaService } from "../src/prisma/prisma.service";
import { signedPost, waText } from "./meta-helpers";
import { api, createApp, createTenantWithUser, login, owner, resetDb, setupSalon } from "./helpers";

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Senaryolu ajan: sıradaki adım varsa onu, yoksa yerel test ajanını çalıştırır. Dış servise istek atmaz. */
class ScriptedAgent extends ChatAgent {
  readonly name = "mock" as const;
  steps: ((i: ChatInput) => Promise<ChatOutput>)[] = [];
  calls: ChatInput[] = [];
  private readonly fallback = new MockChatAgent();
  reply(input: ChatInput) {
    this.calls.push(input);
    const step = this.steps.shift();
    return step ? step(input) : this.fallback.reply(input);
  }
}

const SECRET = "cccccccccccccccccccccccccccccccc";
const PHONE_ID = "3265403522429";
const tomorrow = () => toZoned(new Date(Date.now() + 86_400_000), "Europe/Istanbul").date;

describe("Yapay zekâ sohbet motoru: yanıt, kampanya, randevu, personele devir", () => {
  const su = owner();
  const agent = new ScriptedAgent();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let conn: string;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let outbox: MockMetaGateway["outbox"];
  let n = 0;
  const inbound = (from: string, text: string) => signedPost(app, conn, waText(PHONE_ID, from, `wamid.C${++n}`, text, "Zeynep Deneme"), SECRET).expect(200);
  const aiMessages = (conversationId: string) => su.conversationMessage.findMany({ where: { conversationId, author: "AI" }, orderBy: { createdAt: "asc" } });
  const convOf = (from: string) => su.conversation.findFirstOrThrow({ where: { tenantId: A.tenant.id, externalUserId: from } });

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Sohbet Salon", email: "ca@test.local" });
    B = await createTenantWithUser(su, { name: "Diğer Salon", email: "cb@test.local" });
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
    app = await createApp((m) => m.overrideProvider(ChatAgent).useValue(agent));
    outbox = app.get(MockMetaGateway).outbox;
    a = api(app, await login(app, "ca@test.local"), A.tenant.id);
    s = await setupSalon(a);
    conn = (await a.put("/channels/whatsapp").send({ externalId: PHONE_ID, businessAccountId: "1000000003", accessToken: "EAAchatTOKENcccccccccccccccccccccc", appSecret: SECRET }).expect(200)).body.id;
    await a.post("/channels/whatsapp/verify").expect(200);
    await a.post("/campaigns").send({ title: "Kasım indirimi", description: "Tüm lazer seanslarında %20 indirim.", endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString() }).expect(201);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("yapay zekâ açılmadan gelen mesaja yanıt verilmez", async () => {
    await inbound("905550000001", "Kampanya var mı?");
    const c = await convOf("905550000001");
    const m = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id, direction: "IN" } });
    expect(await app.get(ConversationEngine).handle(A.tenant.id, c.id, m.id)).toBe("ai_off");
    expect(await aiMessages(c.id)).toHaveLength(0);
    await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true, aiDataConsent: true }).expect(200);
  });

  it("kampanya sorusuna yalnızca kayıtlı kampanyalarla yanıt verir (test modunda gönderilmez)", async () => {
    await inbound("905550000001", "Bu ay kampanya var mı?");
    const c = await convOf("905550000001");
    const ai = await waitFor(() => aiMessages(c.id), (r) => r.length > 0);
    expect(ai).toHaveLength(1);
    expect(ai[0].text).toContain("Kasım indirimi: Tüm lazer seanslarında %20 indirim.");
    expect(ai[0].status).toBe("SENT");
    expect(outbox.at(-1)).toMatchObject({ kind: "wa_text", to: "905550000001" });
    expect(agent.calls.at(-1)!.history.at(-1)).toEqual({ role: "user", text: "Bu ay kampanya var mı?" });
  });

  it("fiyat sorusunda hizmet listesindeki fiyatı kullanır", async () => {
    await inbound("905550000001", "Lazer epilasyon ne kadar?");
    const c = await convOf("905550000001");
    const ai = await waitFor(() => aiMessages(c.id), (r) => r.length > 1);
    expect(ai[1].text).toContain("Lazer Epilasyon: 1.000 TL (30 dk)");
  });

  it("anlamadığı mesajı personele devreder; sonrasında yapay zekâ susar", async () => {
    await inbound("905550000001", "Geçen hafta yaptırdığım işlemden sonra kızarıklık oldu");
    const c0 = await convOf("905550000001");
    const c = await waitFor(() => convOf("905550000001"), (v) => v.mode === "HUMAN");
    expect(c).toMatchObject({ mode: "HUMAN", handoffReason: "Test asistanı mesajı anlayamadı" });
    expect((await aiMessages(c0.id)).at(-1)!.text).toContain("ekibimize ilettim");
    await inbound("905550000001", "Kampanya var mı?");
    const last = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
    expect(await app.get(ConversationEngine).handle(A.tenant.id, c.id, last.id)).toBe("human");
    const before = (await aiMessages(c.id)).length;
    await new Promise((r) => setTimeout(r, 2500));
    expect((await aiMessages(c.id)).length).toBe(before);
  });

  it("aynı mesaja ikinci kez yanıt verilmez; eski mesajın işi yeni mesajı yanıtlamaz", async () => {
    await a.patch(`/conversations/${(await convOf("905550000001")).id}/mode`).send({ mode: "AI" }).expect(200);
    await inbound("905550000001", "Kampanya?");
    const c = await convOf("905550000001");
    const msgs = await su.conversationMessage.findMany({ where: { conversationId: c.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
    await waitFor(() => su.conversationMessage.count({ where: { conversationId: c.id, author: "AI", createdAt: { gte: msgs[0].createdAt } } }), (v) => v > 0);
    const e = app.get(ConversationEngine);
    expect(await e.handle(A.tenant.id, c.id, msgs[0].id)).toBe("answered");
    expect(await e.handle(A.tenant.id, c.id, msgs[1].id)).toBe("superseded");
  });

  it("randevu: özet + KVKK, müşteri açıkça onaylamadan oluşmaz; onaydan sonra WhatsApp kaynaklı randevu ve müşteri kaydı oluşur", async () => {
    const tools: Record<string, unknown>[] = [];
    let ozet = "";
    agent.steps.push(async (i) => {
      const hizmetler = (await i.runTool("hizmetler", {})).data as { hizmetId: string }[];
      const bos = (await i.runTool("bos_saatler", { hizmetId: hizmetler[0].hizmetId, tarih: tomorrow() })).data as { saatler: { baslangicIso: string; personelId: string }[] };
      const slot = bos.saatler[0];
      const prep = await i.runTool("randevu_hazirla", { hizmetId: hizmetler[0].hizmetId, baslangic: slot.baslangicIso, personelId: slot.personelId, ad: "Zeynep", soyad: "Deneme" });
      tools.push({ prep });
      ozet = (prep.data as { ozet: string }).ozet;
      // Model kuralı çiğneyip erken onaylamaya çalışsa bile sunucu reddeder.
      tools.push({ early: await i.runTool("randevu_onayla", {}) });
      return { text: `${ozet}\nOnaylıyor musunuz?`, tools: [] };
    });
    await inbound("905551112233", "Yarın lazer randevusu almak istiyorum, adım Zeynep Deneme");
    const c = await waitFor(() => su.conversation.findFirst({ where: { externalUserId: "905551112233" } }), (v) => !!v);
    await waitFor(() => aiMessages(c!.id), (r) => r.length > 0);
    expect(tools[0]).toMatchObject({ prep: { ok: true, data: { kvkkBaglantisi: expect.stringMatching(/\/kvkk$/) } } });
    expect(tools[1]).toMatchObject({ early: { ok: false, error: expect.stringContaining("açık onay") } });
    expect(ozet).toContain("Lazer Epilasyon");
    expect(ozet).toContain("05551112233");
    expect(await su.appointment.count({ where: { tenantId: A.tenant.id, source: "WHATSAPP" } })).toBe(0);

    // "Hayır" içeren yanıt onay sayılmaz.
    agent.steps.push(async (i) => {
      tools.push({ neg: await i.runTool("randevu_onayla", {}) });
      return { text: "Peki, başka bir saat ister misiniz?", tools: [] };
    });
    await inbound("905551112233", "Hayır, o saat olmaz");
    await waitFor(() => aiMessages(c!.id), (r) => r.length > 1);
    expect(tools[2]).toMatchObject({ neg: { ok: false } });

    agent.steps.push(async (i) => {
      tools.push({ ok: await i.runTool("randevu_onayla", {}) });
      return { text: "Randevunuz oluşturuldu.", tools: [] };
    });
    await inbound("905551112233", "Evet onaylıyorum");
    await waitFor(() => aiMessages(c!.id), (r) => r.length > 2);
    expect(tools[3]).toMatchObject({ ok: { ok: true, booked: expect.any(String) } });
    const appt = await su.appointment.findFirstOrThrow({ where: { tenantId: A.tenant.id, source: "WHATSAPP" }, include: { customer: true } });
    expect(appt.serviceId).toBe(s.service.id);
    expect(appt.customer).toMatchObject({ firstName: "Zeynep", lastName: "Deneme", phone: "05551112233", source: "WHATSAPP", marketingConsent: false });
    expect(appt.customer.kvkkConsentAt).not.toBeNull();
    const after = await su.conversation.findUniqueOrThrow({ where: { id: c!.id } });
    expect(after.customerId).toBe(appt.customerId);
    expect(after.state).toBeNull();
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "booking.chat_created", entityId: appt.id } })).toBe(1);
    // Model geçmişi: müşteri ve yapay zekâ mesajları sırayla gider.
    expect(agent.calls.at(-1)!.history.map((h) => h.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });

  it("Instagram: müşterinin yazdığı numara kayıtlı bir müşteriye aitse o kayda bağlanmaz, personele devredilir", async () => {
    const tools = app.get(ChatTools);
    const conv = await su.conversation.create({ data: { tenantId: A.tenant.id, connectionId: conn, channel: "INSTAGRAM", externalUserId: "ig-1784000000001" } });
    const ctx = { tenantId: A.tenant.id, conversationId: conv.id, channel: "INSTAGRAM" as const, externalUserId: "ig-1784000000001", customerId: null };
    const bos = (await tools.run(ctx, "bos_saatler", { hizmetId: s.service.id, tarih: tomorrow() })).data as { saatler: { baslangicIso: string; personelId: string }[] };
    const book = async (telefon: string, slot: { baslangicIso: string; personelId: string }) => {
      expect(await tools.run(ctx, "randevu_hazirla", { hizmetId: s.service.id, baslangic: slot.baslangicIso, personelId: slot.personelId, ad: "Başka", soyad: "Kişi", telefon })).toMatchObject({ ok: true });
      await su.conversationMessage.create({ data: { tenantId: A.tenant.id, conversationId: conv.id, direction: "IN", author: "CUSTOMER", text: "Evet onaylıyorum" } });
      return tools.run(ctx, "randevu_onayla", {});
    };
    const before = await su.appointment.count({ where: { tenantId: A.tenant.id } });
    // 05551112233 bir önceki testte WhatsApp'tan kayıt oldu; Instagram'dan yazan biri bu numarayı yazarak o kayda ulaşamaz.
    const r = await book("05551112233", bos.saatler[1]);
    expect(r).toMatchObject({ ok: false, handoff: expect.stringContaining("kayıtlı bir müşteriye ait") });
    expect(await su.appointment.count({ where: { tenantId: A.tenant.id } })).toBe(before);
    expect((await su.conversation.findUniqueOrThrow({ where: { id: conv.id } })).customerId).toBeNull();
    // Kayıtlı olmayan numarayla yeni müşteri ve Instagram kaynaklı randevu oluşur.
    const ok = await book("05559998877", bos.saatler[2]);
    expect(ok).toMatchObject({ ok: true, booked: expect.any(String) });
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: ok.booked! }, include: { customer: true } });
    expect(appt.customer).toMatchObject({ phone: "05559998877", source: "INSTAGRAM" });
  });

  it("araçlar yalnızca kendi işletmesinin verisini görür", async () => {
    const tools = app.get(ChatTools);
    const c = await convOf("905550000001");
    const ctxB = { tenantId: B.tenant.id, conversationId: c.id, channel: "WHATSAPP" as const, externalUserId: "905550000001", customerId: null };
    expect((await tools.run(ctxB, "hizmetler", {})).data).toEqual([]);
    expect((await tools.run(ctxB, "kampanyalar", {})).data).toEqual([]);
    const slots = await tools.run(ctxB, "bos_saatler", { hizmetId: s.service.id, tarih: tomorrow() });
    expect((slots.data as { saatler?: unknown[] } | undefined)?.saatler ?? []).toHaveLength(0);
    expect(await tools.run(ctxB, "randevu_onayla", {})).toMatchObject({ ok: false });
    expect((await tools.run(ctxB, "bos_saatler", { hizmetId: "x", tarih: "yarın" })).error).toContain("Geçersiz girdi");
  });

  it("Akıllı paketi olmayan işletmede yapay zekâ yanıt vermez", async () => {
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "PROFESSIONAL" } });
    await inbound("905550000001", "Kampanya var mı acaba?");
    const c = await convOf("905550000001");
    const m = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
    expect(await app.get(ConversationEngine).handle(A.tenant.id, c.id, m.id)).toBe("ai_off");
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
  });

  it("canlıda gerçek yapay zekâ kapalıysa konuşma personele düşer, yanıt uydurulmaz", async () => {
    const c = await convOf("905550000001");
    await su.conversation.update({ where: { id: c.id }, data: { mode: "AI" } });
    await su.conversationMessage.create({ data: { tenantId: A.tenant.id, conversationId: c.id, direction: "IN", author: "CUSTOMER", text: "Merhaba", status: "DELIVERED" } });
    const m = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
    const before = (await aiMessages(c.id)).length;
    const engine = new ConversationEngine(app.get(PrismaService), app.get(InboxService), app.get(ChatTools), new DisabledChatAgent());
    expect(await engine.handle(A.tenant.id, c.id, m.id)).toBe("handoff");
    expect(await convOf("905550000001")).toMatchObject({ mode: "HUMAN", handoffReason: "Yapay zekâ yanıtları bu sunucuda kapalı" });
    expect((await aiMessages(c.id)).length).toBe(before);
  });

  it("yapay zekâ hata verirse konuşma personele devredilir", async () => {
    const c = await convOf("905550000001");
    await su.conversation.update({ where: { id: c.id }, data: { mode: "AI" } });
    agent.steps.push(async () => {
      throw new Error("bağlantı hatası");
    });
    const m = await su.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id, direction: "IN" }, orderBy: { createdAt: "desc" } });
    expect(await app.get(ConversationEngine).handle(A.tenant.id, c.id, m.id)).toBe("error");
    expect((await convOf("905550000001")).mode).toBe("HUMAN");
  });
});

describe("Sohbet yardımcıları", () => {
  it("onay ifadeleri", () => {
    for (const t of ["Evet", "evet onaylıyorum", "Tamam, olur", "Onaylıyorum"]) expect(isAffirmative(t)).toBe(true);
    for (const t of ["Hayır", "tamam değil", "vazgeçtim", "uygun olmaz", "Onaylamıyorum", "Bir sorum var"]) expect(isAffirmative(t)).toBe(false);
  });

  it("konuşma geçmişi: model sırası müşteriyle başlar, personel ve sistem mesajları etiketlenir", () => {
    const turns = toTurns([
      { direction: "OUT", author: "SYSTEM", text: "Randevunuz yarın 10:00" },
      { direction: "IN", author: "CUSTOMER", text: "Saati değiştirebilir miyiz?" },
      { direction: "OUT", author: "STAFF", text: "Tabii" },
      { direction: "IN", author: "CUSTOMER", text: "Teşekkürler" },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "(Önceki mesajlar: [Salonun otomatik bildirimi] Randevunuz yarın 10:00)\nSaati değiştirebilir miyiz?" },
      { role: "assistant", text: "[Salon personeli] Tabii" },
      { role: "user", text: "Teşekkürler" },
    ]);
  });
});

describe("AnthropicChatAgent (sahte istemciyle; gerçek API çağrılmaz)", () => {
  const base = { salonName: "Deneme", now: "31 Ekim 2026", today: "2026-10-31", channel: "WHATSAPP" as const, history: [{ role: "user" as const, text: "Kampanya var mı?" }] };
  const fake = (responses: unknown[]) => {
    const requests: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (body: Record<string, unknown>) => (requests.push(structuredClone(body)), responses.shift()) } } };
    return { client: client as unknown as ConstructorParameters<typeof AnthropicChatAgent>[0], requests };
  };

  it("araç çağrısını çalıştırır, sonucu modele geri verir ve son metni döner", async () => {
    const { client, requests } = fake([
      { stop_reason: "tool_use", content: [{ type: "text", text: "Bakıyorum." }, { type: "tool_use", id: "tu_1", name: "kampanyalar", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Kasım indirimi var." }] },
    ]);
    const ran: string[] = [];
    const out = await new AnthropicChatAgent(client).reply({ ...base, runTool: async (n) => (ran.push(n), { ok: true, data: [{ baslik: "Kasım indirimi" }] }) });
    expect(out).toEqual({ text: "Kasım indirimi var.", handoff: undefined, tools: ["kampanyalar"] });
    expect(ran).toEqual(["kampanyalar"]);
    const second = requests[1].messages as { role: string; content: unknown }[];
    expect(second[1]).toMatchObject({ role: "assistant" });
    expect(second[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1" }] });
    expect(requests[0].output_config).toEqual({ effort: "low" });
    expect((requests[0].tools as { name: string }[]).map((t) => t.name)).toContain("randevu_onayla");
  });

  it("devir aracında handoff döner; reddetmede yanıt üretmeden personele devreder", async () => {
    const a1 = fake([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_2", name: "personele_devret", input: { neden: "Şikâyet" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Ekibimiz size dönecek." }] },
    ]);
    const out = await new AnthropicChatAgent(a1.client).reply({ ...base, runTool: async () => ({ ok: true, handoff: "Şikâyet" }) });
    expect(out).toMatchObject({ text: "Ekibimiz size dönecek.", handoff: "Şikâyet" });
    const a2 = fake([{ stop_reason: "refusal", content: [] }]);
    expect(await new AnthropicChatAgent(a2.client).reply({ ...base, runTool: async () => ({ ok: true }) })).toMatchObject({ text: null, handoff: expect.any(String) });
  });
});
