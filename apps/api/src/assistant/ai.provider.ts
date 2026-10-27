import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { loadEnv } from "../config/env";

export interface BusinessSnapshot {
  salonName: string;
  period: string;
  metrics: Record<string, unknown>;
}

export abstract class AiProvider {
  abstract readonly name: string;
  abstract answer(question: string, snapshot: BusinessSnapshot): Promise<string>;
}

export const SYSTEM_PROMPT = `Sen ProGüzellik'in güzellik salonu işletme asistanısın. İşletme sahibine Türkçe, kısa ve uygulanabilir öneriler verirsin.
Yalnızca sana verilen işletme verilerine dayan; veride olmayan rakamları uydurma, emin olmadığında bunu söyle.
Yanıtın en fazla birkaç kısa paragraf veya madde olsun ve en önemli bulguyla başlasın.
Tıbbi veya hukuki tavsiye verme; bu tür sorularda bir uzmana yönlendir.`;

/** Kural tabanlı yerel asistan: dış servise veri göndermez, testlerde ve anahtar yokken kullanılır. */
@Injectable()
export class MockAiProvider extends AiProvider {
  readonly name = "mock";

  async answer(question: string, s: BusinessSnapshot): Promise<string> {
    const m = s.metrics as {
      appointments: { total: number; completionRate: number; noShowRate: number };
      finance: { income: string; net: string };
      topServices: { name: string; count: number }[];
      staffPerformance: { name: string; count: number; revenue: string }[];
      lowStock: { name: string }[];
      newCustomers: number;
    };
    const lines = [
      `${s.salonName} için ${s.period} özeti: ${m.appointments.total} randevu, tamamlanma oranı %${m.appointments.completionRate}, net kasa ${m.finance.net} TL.`,
    ];
    if (m.appointments.noShowRate >= 10) {
      lines.push(`• Gelmeme oranı %${m.appointments.noShowRate}. WhatsApp hatırlatmalarının açık olduğundan emin olun ve kapora almayı düşünün.`);
    }
    if (m.topServices[0]) lines.push(`• En çok tercih edilen hizmet: ${m.topServices[0].name} (${m.topServices[0].count} randevu). Paket olarak sunmak satışları artırabilir.`);
    if (m.staffPerformance[0]) lines.push(`• En yoğun personel: ${m.staffPerformance[0].name} (${m.staffPerformance[0].count} randevu).`);
    if (m.lowStock.length) lines.push(`• Kritik stok: ${m.lowStock.map((p) => p.name).join(", ")}. Sipariş verin.`);
    if (m.newCustomers === 0) lines.push("• Bu dönemde yeni müşteri yok; online rezervasyon bağlantınızı sosyal medyada paylaşın.");
    lines.push(`(Sorunuz: "${question.slice(0, 200)}" — bu yanıt yerel kural tabanlı asistan tarafından üretildi.)`);
    return lines.join("\n");
  }
}

/**
 * Claude API sağlayıcısı. Yalnızca toplu işletme metrikleri gönderilir;
 * müşteri adı, telefonu gibi kişisel veriler modele gönderilmez (KVKK).
 */
@Injectable()
export class AnthropicAiProvider extends AiProvider {
  readonly name = "anthropic";
  private readonly client: Pick<Anthropic, "beta">;

  constructor(client?: Pick<Anthropic, "beta">) {
    super();
    this.client = client ?? new Anthropic();
  }

  async answer(question: string, s: BusinessSnapshot): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: loadEnv().AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `İşletme verileri (${s.period}, JSON):\n${JSON.stringify({ salon: s.salonName, ...s.metrics })}\n\nSoru: ${question}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return "Bu soruya yanıt veremiyorum. Lütfen sorunuzu işletme verileriyle ilgili olacak şekilde yeniden yazın.";
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || "Yanıt üretilemedi.";
  }
}
