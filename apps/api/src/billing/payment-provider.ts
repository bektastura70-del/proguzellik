import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface ChargeRequest {
  tenantId: string;
  amount: string;
  currency: "TRY";
  description: string;
  /** Ödeme sağlayıcısının kart/ödeme yöntemi belirteci. Kart verisi API'ye hiç gelmez. */
  paymentToken: string;
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
 * "tok_fail" belirteci başarısız ödeme simüle eder.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = "mock";
  private readonly logger = new Logger("MockPaymentProvider");

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (req.paymentToken === "tok_fail") return { ok: false, error: "Kart reddedildi (test)" };
    const ref = `mock_${randomUUID()}`;
    this.logger.log(`[TEST] ${req.amount} ${req.currency} tahsil edildi sayıldı: ${req.description} (${ref})`);
    return { ok: true, providerRef: ref };
  }
}
