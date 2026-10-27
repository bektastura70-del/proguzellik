import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface ChargeRequest {
  tenantId: string;
  amount: string;
  currency: "TRY";
  description: string;
  /** Ödeme sağlayıcısının kart/ödeme yöntemi belirteci. Kart verisi API'ye hiç gelmez. */
  paymentToken: string;
  /** Aynı anahtarla tekrar denemede ikinci tahsilat yapılmaz. */
  idempotencyKey: string;
}

export interface ChargeResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

/** Ödeme sağlayıcı soyutlaması (iyzico, PayTR, Stripe vb. için uyarlanabilir). */
export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Test/geliştirme sağlayıcısı: GERÇEK ÖDEME ALMAZ.
 *  - "tok_fail"   : her zaman reddedilir
 *  - "tok_expired": yenilemede reddedilir (kartın süresi dolmuş gibi)
 *  - "tok_error"  : sağlayıcı hatası (ağ/zaman aşımı) simüle eder
 * Aynı idempotencyKey ile ikinci çağrı ilk sonucu döner.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = "mock";
  private readonly logger = new Logger("MockPaymentProvider");
  private readonly seen = new Map<string, ChargeResult>();
  readonly charges: ChargeRequest[] = [];

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const prev = this.seen.get(req.idempotencyKey);
    if (prev) return prev;
    if (req.paymentToken === "tok_error") throw new Error("Test: ödeme sağlayıcısına ulaşılamadı");
    let result: ChargeResult;
    if (req.paymentToken === "tok_fail" || req.paymentToken === "tok_expired") {
      result = { ok: false, error: req.paymentToken === "tok_fail" ? "Kart reddedildi (test)" : "Kartın süresi dolmuş (test)" };
    } else {
      result = { ok: true, providerRef: `mock_${randomUUID()}` };
      this.charges.push(req);
      this.logger.log(`[TEST] ${req.amount} ${req.currency} tahsil edildi sayıldı: ${req.description}`);
    }
    this.seen.set(req.idempotencyKey, result);
    return result;
  }
}
