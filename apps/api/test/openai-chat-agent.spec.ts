import { chatAgentFactory, ChatInput, OpenAiChatAgent, OpenAiFetch } from "../src/messaging/chat/chat-agent";
import { loadEnv } from "../src/config/env";

process.env.OPENAI_API_KEY = "sk-test-0000000000000000000000";
process.env.OPENAI_MODEL = "test-model";

const base: Omit<ChatInput, "runTool"> = { salonName: "Deneme", now: "31 Ekim 2026", today: "2026-10-31", channel: "WHATSAPP", history: [{ role: "user", text: "Kampanya var mı?" }] };

/** Sahte OpenAI: istekleri kaydeder, sıradaki yanıtı döner. Dış servise istek atılmaz. */
function fake(responses: { status?: number; body: unknown }[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const doFetch: OpenAiFetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses.shift()!;
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  };
  return { agent: new OpenAiChatAgent(doFetch), requests };
}
const say = (text: string, extra: Record<string, unknown> = {}) => ({ body: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], ...extra } });
const call = (name: string, args: string, id = "call_1") => ({
  body: { status: "completed", output: [{ type: "reasoning", id: "rs_1", encrypted_content: "xyz" }, { type: "function_call", id: `fc_${id}`, call_id: id, name, arguments: args }] },
});

describe("OpenAiChatAgent (sahte istemciyle; gerçek API çağrılmaz)", () => {
  it("araç çağrısını çalıştırır, sonucu ve akıl yürütme öğesini modele geri verir, son metni döner", async () => {
    const { agent, requests } = fake([call("kampanyalar", "{}"), say("Kasım indirimi var.")]);
    const ran: string[] = [];
    const out = await agent.reply({ ...base, runTool: async (n) => (ran.push(n), { ok: true, data: [{ baslik: "Kasım indirimi" }] }) });
    expect(out).toEqual({ text: "Kasım indirimi var.", handoff: undefined, tools: ["kampanyalar"] });
    expect(ran).toEqual(["kampanyalar"]);
    expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
    expect(requests[0].headers.Authorization).toBe("Bearer sk-test-0000000000000000000000");
    expect(requests[0].body).toMatchObject({ model: "test-model", store: false, reasoning: { effort: "low" } });
    expect((requests[0].body.instructions as string)).toContain("Salon: Deneme");
    expect((requests[0].body.tools as { name: string; type: string }[]).map((t) => t.name)).toContain("randevu_onayla");
    expect((requests[0].body.tools as { type: string }[])[0].type).toBe("function");
    const second = requests[1].body.input as { type?: string; role?: string; call_id?: string; output?: string }[];
    expect(second[0]).toMatchObject({ role: "user", content: "Kampanya var mı?" });
    expect(second.map((x) => x.type)).toEqual([undefined, "reasoning", "function_call", "function_call_output"]);
    expect(second.at(-1)).toMatchObject({ call_id: "call_1" });
    expect(JSON.parse(second.at(-1)!.output!)).toEqual([{ baslik: "Kasım indirimi" }]);
  });

  it("devir aracında handoff döner", async () => {
    const { agent } = fake([call("personele_devret", '{"neden":"Şikâyet"}'), say("Ekibimiz size dönecek.")]);
    const out = await agent.reply({ ...base, runTool: async () => ({ ok: true, handoff: "Şikâyet" }) });
    expect(out).toMatchObject({ text: "Ekibimiz size dönecek.", handoff: "Şikâyet", tools: ["personele_devret"] });
  });

  it("geçersiz araç girdisini çalıştırmaz, modele hata döner", async () => {
    const { agent, requests } = fake([call("hizmetler", "{bozuk json"), say("Tamam.")]);
    let ran = 0;
    const out = await agent.reply({ ...base, runTool: async () => (ran++, { ok: true }) });
    expect(ran).toBe(0);
    expect(out.text).toBe("Tamam.");
    const last = (requests[1].body.input as { type?: string; output: string }[]).at(-1)!;
    expect(last.type).toBe("function_call_output");
    expect(JSON.parse(last.output)).toHaveProperty("hata");
  });

  it("reddetme, içerik filtresi ve token sınırında yanıt üretmeden personele devreder", async () => {
    for (const r of [
      { body: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Yapamam" }] }] } },
      { body: { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] } },
      { body: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] } },
    ]) {
      const { agent } = fake([r]);
      expect(await agent.reply({ ...base, runTool: async () => ({ ok: true }) })).toMatchObject({ text: null, handoff: expect.any(String) });
    }
  });

  it("HTTP hatasında fırlatır ve hata metni müşteri içeriği taşımaz", async () => {
    const { agent } = fake([{ status: 429, body: { error: { code: "rate_limit_exceeded", message: "müşteri mesajı burada olabilir" } } }]);
    const err = await agent.reply({ ...base, runTool: async () => ({ ok: true }) }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("OpenAI 429 rate_limit_exceeded");
  });

  it("araç döngüsü sınırında sonsuza gitmez", async () => {
    const { agent, requests } = fake(Array.from({ length: 8 }, (_, i) => call("hizmetler", "{}", `c${i}`)));
    const out = await agent.reply({ ...base, runTool: async () => ({ ok: true, data: [] }) });
    expect(out).toMatchObject({ text: null, handoff: expect.any(String) });
    expect(requests).toHaveLength(8);
  });

  it("anahtar ya da model yoksa istek atmadan devreder; fabrika AI_MODE=openai'da bu ajanı seçer", async () => {
    const env = loadEnv() as { AI_MODE: string; OPENAI_API_KEY?: string };
    const saved = { mode: env.AI_MODE, key: env.OPENAI_API_KEY };
    env.AI_MODE = "openai";
    expect(chatAgentFactory().name).toBe("openai");
    env.OPENAI_API_KEY = undefined;
    const { agent, requests } = fake([]);
    expect(await agent.reply({ ...base, runTool: async () => ({ ok: true }) })).toMatchObject({ text: null, handoff: "Yapay zekâ ayarları eksik" });
    expect(requests).toHaveLength(0);
    env.AI_MODE = saved.mode;
    env.OPENAI_API_KEY = saved.key;
  });
});
