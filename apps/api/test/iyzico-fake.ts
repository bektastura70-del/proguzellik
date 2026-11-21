import { IyzicoClient, IyzicoError, IyzicoCustomer, IyzicoInterval, IyzicoPaymentFormInput, IyzicoPaymentFormResult, IyzicoSubscriptionDetail } from "../src/billing/iyzico/iyzico.client";

export const DAY = 86_400_000;

/** Sahte iyzico: gerçek ağ çağrısı yapılmaz. Siparişler (çekimler) test içinden eklenir. */
export class FakeIyzico extends IyzicoClient {
  products: { ref: string; name: string }[] = [];
  plans: { ref: string; productRef: string; name: string; price: string; interval: IyzicoInterval }[] = [];
  checkouts = new Map<string, { plan: string; customer: IyzicoCustomer; callbackUrl: string }>();
  subs = new Map<string, IyzicoSubscriptionDetail>();
  cancelled: string[] = [];
  /** Ödeme formunda çekilecek tutar (tutar uyuşmazlığı testi için değiştirilir) */
  chargeOverride: number | null = null;
  failNextCheckout = false;
  private n = 0;
  get environment() {
    return "sandbox" as const;
  }
  async findProduct(name: string) {
    const p = this.products.find((x) => x.name === name);
    return p ? { referenceCode: p.ref } : null;
  }
  /** Abonelik ürünü hesapta açık değilken iyzico'nun verdiği hata (canlıda 21.11.2026'da görüldü). */
  failProducts = false;
  async createProduct(name: string) {
    if (this.failProducts) throw new IyzicoError("Sistem hatası", "100001");
    if (this.products.some((p) => p.name === name)) throw new IyzicoError("Ürün zaten var.", "201001");
    const ref = `prod-${++this.n}`;
    this.products.push({ ref, name });
    return { referenceCode: ref };
  }
  async findPricingPlan(productRef: string, name: string) {
    const p = this.plans.find((x) => x.productRef === productRef && x.name === name);
    return p ? { referenceCode: p.ref, price: Number(p.price), interval: p.interval } : null;
  }
  async createPricingPlan(productRef: string, p: { name: string; price: string; interval: IyzicoInterval }) {
    if (this.plans.some((x) => x.productRef === productRef && x.name === p.name)) throw new IyzicoError("Ödeme planı zaten var.", "201051");
    const ref = `plan-${++this.n}`;
    this.plans.push({ ref, productRef, ...p });
    return { referenceCode: ref };
  }
  async initCheckout(p: { conversationId: string; callbackUrl: string; pricingPlanReferenceCode: string; customer: IyzicoCustomer }) {
    const token = `tok-${++this.n}-abcdefghij`;
    this.checkouts.set(token, { plan: p.pricingPlanReferenceCode, customer: p.customer, callbackUrl: p.callbackUrl });
    return { token, checkoutFormContent: `<script>/*iyzico ${token}*/</script>` };
  }
  /** Kullanıcının iyzico formunda ödemeyi tamamlaması */
  pay(token: string) {
    const c = this.checkouts.get(token)!;
    const plan = this.plans.find((p) => p.ref === c.plan)!;
    const ref = `sub-${token}`;
    const start = Date.now();
    const end = plan.interval === "MONTHLY" ? start + 30 * DAY : start + 365 * DAY;
    this.subs.set(ref, {
      referenceCode: ref,
      customerReferenceCode: `cus-${token}`,
      pricingPlanReferenceCode: plan.ref,
      subscriptionStatus: this.failNextCheckout ? "UNPAID" : "ACTIVE",
      orders: this.failNextCheckout ? [] : [{ referenceCode: `ord-${token}-1`, price: this.chargeOverride ?? Number(plan.price), startPeriod: start, endPeriod: end, orderStatus: "SUCCESS" }],
    });
    return ref;
  }
  addOrder(ref: string, o: { status: "SUCCESS" | "FAILED"; start: number; end: number; price?: number }) {
    const s = this.subs.get(ref)!;
    const plan = this.plans.find((p) => p.ref === s.pricingPlanReferenceCode)!;
    const id = `ord-${ref}-${s.orders.length + 1}`;
    s.orders.push({ referenceCode: id, price: o.price ?? Number(plan.price), startPeriod: o.start, endPeriod: o.end, orderStatus: o.status });
    return id;
  }
  async retrieveCheckout(token: string) {
    const ref = `sub-${token}`;
    const s = this.subs.get(ref);
    if (!s) return { referenceCode: ref, pricingPlanReferenceCode: this.checkouts.get(token)!.plan, subscriptionStatus: "PENDING" };
    return { referenceCode: ref, customerReferenceCode: s.customerReferenceCode, pricingPlanReferenceCode: s.pricingPlanReferenceCode, subscriptionStatus: s.subscriptionStatus };
  }
  async getSubscription(ref: string) {
    return structuredClone(this.subs.get(ref)!);
  }
  async cancelSubscription(ref: string) {
    this.cancelled.push(ref);
    const s = this.subs.get(ref);
    if (s) s.subscriptionStatus = "CANCELED";
  }
  /* ---------- Tek seferlik ödeme formu ---------- */
  forms = new Map<string, { input: IyzicoPaymentFormInput; result?: IyzicoPaymentFormResult }>();
  cancelledPayments: string[] = [];
  refunds: { paymentTransactionId: string; price: string }[] = [];
  async initPaymentForm(p: IyzicoPaymentFormInput) {
    const token = `pf-${++this.n}-abcdefghij`;
    this.forms.set(token, { input: p });
    return { token, checkoutFormContent: `<script>/*iyzico ${token}*/</script>` };
  }
  /** Kullanıcının formda ödemesi; over ile iyzico yanıtı değiştirilir (tutar uyuşmazlığı, inceleme vb.). */
  payForm(token: string, over: Partial<IyzicoPaymentFormResult> = {}) {
    const f = this.forms.get(token)!;
    const price = Number(f.input.price);
    f.result = {
      paymentStatus: "SUCCESS", fraudStatus: 1, paymentId: `pay-${token}`, conversationId: f.input.conversationId, basketId: f.input.basketId,
      price, paidPrice: price, currency: "TRY", installment: 1,
      itemTransactions: [{ itemId: f.input.item.id, paymentTransactionId: `ptx-${token}`, paidPrice: price, transactionStatus: 2 }],
      ...over,
    };
  }
  async retrievePaymentForm(token: string) {
    const f = this.forms.get(token);
    if (!f) throw new IyzicoError("Ödeme bulunamadı", "NOT_FOUND");
    return structuredClone(f.result ?? { paymentStatus: "INIT", conversationId: f.input.conversationId, basketId: f.input.basketId });
  }
  failCancel = false;
  async cancelPayment(p: { paymentId: string }) {
    if (this.failCancel) throw new IyzicoError("Ödeme iptal edilemez (gün sonu geçti)", "5093");
    this.cancelledPayments.push(p.paymentId);
  }
  async refundPayment(p: { paymentTransactionId: string; price: string }) {
    this.refunds.push({ paymentTransactionId: p.paymentTransactionId, price: p.price });
  }
}
