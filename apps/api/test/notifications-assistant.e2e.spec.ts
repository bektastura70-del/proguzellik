import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";
import { AnthropicAiProvider, MockAiProvider } from "../src/assistant/ai.provider";
import { DisabledMetaGateway } from "../src/messaging/meta.gateway";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { PrismaService } from "../src/prisma/prisma.service";
import { CloudWhatsAppProvider, DisabledWhatsAppProvider, MockWhatsAppProvider } from "../src/notifications/whatsapp.provider";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("WhatsApp bildirim altyapısı (BullMQ + test sağlayıcısı) ve yapay zekâ asistanı", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let outbox: MockWhatsAppProvider["outbox"];

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Işıltı Güzellik", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    await su.tenant.update({ where: { id: B.tenant.id }, data: { planCode: "STARTER" } });
    app = await createApp();
    outbox = app.get(MockWhatsAppProvider).outbox;
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    s = await setupSalon(a);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let apptId: string;
  it("randevu oluşunca onay gönderilir, 24 saat öncesine hatırlatma planlanır", async () => {
    apptId = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(201)).body.id;
    const notes = await su.notification.findMany({ where: { appointmentId: apptId }, orderBy: { scheduledFor: "asc" } });
    expect(notes.map((n) => n.template)).toEqual(["randevu_onay", "randevu_hatirlatma"]);
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: apptId } });
    expect(notes[1].scheduledFor.getTime()).toBe(appt.startsAt.getTime() - 24 * 3_600_000);

    const sent = await waitFor(() => su.notification.findUniqueOrThrow({ where: { id: notes[0].id } }), (n) => n.status === "SENT");
    expect(sent.status).toBe("SENT");
    expect(sent.providerMessageId).toMatch(/^wamid\.mock\./);
    const msg = outbox.find((m) => m.messageId === sent.providerMessageId)!;
    expect(msg.to).toBe("05550000001");
    expect(msg.text).toMatch(/^Merhaba Ayşe, Işıltı Güzellik randevunuz oluşturuldu: Lazer Epilasyon – .+ 10:00/);
  });

  it("iptalde bekleyen hatırlatma atlanır ve iptal mesajı gönderilir", async () => {
    await a.post(`/appointments/${apptId}/status`).send({ status: "CANCELLED" }).expect(201);
    const reminder = await su.notification.findFirstOrThrow({ where: { appointmentId: apptId, template: "randevu_hatirlatma" } });
    expect(reminder.status).toBe("SKIPPED");
    const cancel = await waitFor(
      () => su.notification.findFirstOrThrow({ where: { appointmentId: apptId, template: "randevu_iptal" } }),
      (n) => n.status === "SENT",
    );
    expect(cancel.status).toBe("SENT");
  });

  it("işçi, iptal edilmiş randevunun hatırlatmasını göndermez", async () => {
    const q = app.get(NotificationQueue);
    const n = await su.notification.create({
      data: { tenantId: A.tenant.id, recipient: "05550000001", template: "randevu_hatirlatma", payload: { params: ["a", "b", "c", "d", "e"] }, appointmentId: apptId },
    });
    expect(await q.process({ data: { notificationId: n.id }, attemptsMade: 0 } as never)).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SKIPPED");
  });

  it("gönderim hatası kaydedilir; son denemede FAILED olur", async () => {
    const q = app.get(NotificationQueue);
    const n = await su.notification.create({
      data: { tenantId: A.tenant.id, recipient: "+900000000000", template: "randevu_onay", payload: { params: ["a", "b", "c", "d", "e"] } },
    });
    await expect(q.process({ data: { notificationId: n.id }, attemptsMade: 0 } as never)).rejects.toThrow(/geçersiz numara/);
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("QUEUED");
    await expect(q.process({ data: { notificationId: n.id }, attemptsMade: 4 } as never)).rejects.toThrow();
    const after = await su.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after).toMatchObject({ status: "FAILED", attempts: 2 });
  });

  it("canlıda WhatsApp bağlı değilse mesaj 'gönderildi' sayılmaz; atlandı olarak işaretlenir", async () => {
    const q = new NotificationQueue(app.get(PrismaService), new DisabledWhatsAppProvider(), new DisabledMetaGateway());
    const n = await su.notification.create({
      data: { tenantId: A.tenant.id, recipient: "05550000002", template: "randevu_onay", payload: { params: ["a", "b", "c", "d", "e"] } },
    });
    const before = outbox.length;
    expect(await q.process({ data: { notificationId: n.id }, attemptsMade: 0 } as never)).toBe("not_configured");
    const after = await su.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after).toMatchObject({ status: "SKIPPED", providerMessageId: null, sentAt: null });
    expect(after.error).toMatch(/bağlı değil/);
    expect(outbox.length).toBe(before);
  });

  it("Başlangıç paketinde (WhatsApp yok) bildirim oluşmaz", async () => {
    const sb = await setupSalon(b);
    await b.post("/appointments").send({ customerId: sb.customer.id, staffId: sb.staff.id, serviceId: sb.service.id, startsAt: futureAt(5, "10:00") }).expect(201);
    expect(await su.notification.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    await b.get("/notifications").expect(403);
  });

  it("işletme yalnızca kendi bildirimlerini listeler", async () => {
    const r = await a.get("/notifications").expect(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((n: any) => n.tenantId === A.tenant.id)).toBe(true);
  });

  it("webhook doğrulaması ve imzalı durum güncellemesi", async () => {
    const http = request(app.getHttpServer());
    await http.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=123").expect(403);
    const ok = await request(app.getHttpServer()).get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42").expect(200);
    expect(ok.text).toBe("42");

    const sent = await su.notification.findFirstOrThrow({ where: { tenantId: A.tenant.id, status: "SENT" } });
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: sent.providerMessageId, status: "read" }] } }] }] });
    await request(app.getHttpServer()).post("/webhooks/whatsapp").set("Content-Type", "application/json").set("X-Hub-Signature-256", "sha256=bad").send(body).expect(403);
    const sig = "sha256=" + createHmac("sha256", "test-app-secret").update(body).digest("hex");
    const r = await request(app.getHttpServer()).post("/webhooks/whatsapp").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(body).expect(200);
    expect(r.body.updated).toBe(1);
    expect((await su.notification.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("READ");
  });

  it("Cloud API sağlayıcısı doğru istek gövdesini oluşturur (ağ çağrısı yapılmadan)", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    const { loadEnv } = await import("../src/config/env");
    Object.assign(loadEnv(), { WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_ACCESS_TOKEN: "test-token" });
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new CloudWhatsAppProvider(fake);
    const r = await p.sendTemplate({ to: "0555 111 22 33", template: "randevu_onay", params: ["Ayşe", "Salon"] });
    expect(r.messageId).toBe("wamid.X");
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/123456/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const sentBody = JSON.parse(calls[0].init.body as string);
    expect(sentBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "905551112233",
      type: "template",
      template: { name: "randevu_onay", language: { code: "tr" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ayşe" }, { type: "text", text: "Salon" }] }] },
    });
    const failing = new CloudWhatsAppProvider((async () => new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 401 })) as unknown as typeof fetch);
    await expect(failing.sendTemplate({ to: "05551112233", template: "randevu_onay", params: [] })).rejects.toThrow(/401.*Invalid token/);
    Object.assign(loadEnv(), { WHATSAPP_PHONE_NUMBER_ID: undefined, WHATSAPP_ACCESS_TOKEN: undefined });
  });

  it("yapay zekâ asistanı yalnızca Akıllı pakette çalışır", async () => {
    await a.post("/assistant/ask").send({ question: "Bu ay nasıl gidiyoruz?" }).expect(403);
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
    const r = await a.post("/assistant/ask").send({ question: "Bu ay nasıl gidiyoruz?" }).expect(200);
    expect(r.body.provider).toBe("mock");
    expect(r.body.answer).toMatch(/Işıltı Güzellik için son 30 gün özeti/);
  });

  it("asistana gönderilen veri müşteri kişisel verisi içermez", async () => {
    const { AssistantService } = await import("../src/assistant/assistant.service");
    const svc = app.get(AssistantService);
    const snap = await svc.snapshot({ tenantId: A.tenant.id, userId: A.user.id, role: "OWNER", plan: "SMART", features: [] });
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/Ayşe|0555|05550000001|@test\.local/);
  });

  it("Claude sağlayıcısı: model, yedek model ve ret durumu (sahte istemciyle)", async () => {
    const captured: any[] = [];
    let stop = "end_turn";
    const fakeClient = {
      beta: {
        messages: {
          create: async (params: any) => {
            captured.push(params);
            return { stop_reason: stop, content: [{ type: "text", text: "Öneri: hatırlatmaları açın." }] };
          },
        },
      },
    } as any;
    const p = new AnthropicAiProvider(fakeClient);
    const snap = { salonName: "Test", period: "son 30 gün", metrics: { a: 1 } };
    expect(await p.answer("Nasıl gidiyoruz?", snap)).toBe("Öneri: hatırlatmaları açın.");
    expect(captured[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "medium" } });
    expect(captured[0].temperature).toBeUndefined();
    expect(captured[0].messages[0].content).toContain('"salon":"Test"');
    stop = "refusal";
    expect(await p.answer("x", snap)).toMatch(/yanıt veremiyorum/);
    expect(new MockAiProvider().name).toBe("mock");
  });
});
