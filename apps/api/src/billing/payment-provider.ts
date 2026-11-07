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
  /**
   * Bu sağlayıcının "başarılı" sonucu abonelik açmaya/yenilemeye yeter mi?
   * Yalnızca gerçek, doğrulanmış tahsilat yapan sağlayıcılar canlıda true döner.
   */
  abstract get acceptsPayments(): boolean;
  abstract charge(req: ChargeRequest): Promise<ChargeResult>;
}

/** Çalışma anında canlı ortam mı? (önbelleğe alınmış env yerine süreç değişkeni okunur) */
const isProductionRuntime = () => process.env.NODE_ENV === "production";

/**
 * Online ödeme kapalı: canlıda gerçek sağlayıcı entegre edilmeden kullanılır.
 * Hiçbir tahsilatı başarılı saymaz; abonelik yalnızca SaaS sahibinin manuel işlemiyle açılır.
 */
@Injectable()
export class DisabledPaymentProvider extends PaymentProvider {
  readonly name = "disabled";
  get acceptsPayments() {
    return false;
  }
  async charge(): Promise<ChargeResult> {
    return { ok: false, error: "Online ödeme henüz aktif değil" };
  }
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

  /** Test sağlayıcısı canlıda asla geçerli tahsilat sayılmaz. */
  get acceptsPayments() {
    return !isProductionRuntime();
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    // İkinci savunma hattı: yanlış yapılandırmada bile canlıda test belirteci "ödendi" olamaz.
    if (isProductionRuntime()) return { ok: false, error: "Test ödeme sağlayıcısı canlı ortamda kullanılamaz" };
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

/**
 * iyzico Abonelik: tahsilatı iyzico yapar (ödeme formu + aylık/yıllık otomatik çekim, bildirimle haber verir).
 * Bu sınıf yalnız "ödeme açık mı" bilgisini taşır; belirteçle tahsilat (charge) desteklenmez.
 * Bu sürümde yalnız sandbox; canlıda (NODE_ENV=production) her zaman kapalı.
 */
export class IyzicoPaymentProvider extends PaymentProvider {
  readonly name = "iyzico";
  constructor(private readonly configured: () => boolean) {
    super();
  }
  get acceptsPayments() {
    return !isProductionRuntime() && this.configured();
  }
  async charge(): Promise<ChargeResult> {
    return { ok: false, error: "iyzico aboneliğinde tahsilatı iyzico yapar; belirteçle ödeme desteklenmez" };
  }
}

/** Ortama göre sağlayıcı seçimi: canlıda test sağlayıcısı yerine "ödeme kapalı" kullanılır. */
export function paymentProviderFor(env: { NODE_ENV: string; PAYMENT_MODE: string }, iyzicoConfigured: () => boolean = () => false): PaymentProvider {
  // Canlıda online ödeme ayrı onay verilene kadar kapalıdır (iyzico dahil).
  if (env.NODE_ENV === "production") return new DisabledPaymentProvider();
  if (env.PAYMENT_MODE === "mock") return new MockPaymentProvider();
  if (env.PAYMENT_MODE === "iyzico") return new IyzicoPaymentProvider(iyzicoConfigured);
  return new DisabledPaymentProvider();
}
