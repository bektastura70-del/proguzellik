import { Injectable } from "@nestjs/common";

export interface EInvoiceDocument {
  invoiceId: string;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  lines: { description: string; quantity: string; unitPrice: string; netAmount: string; vatAmount: string; grossAmount: string }[];
  vatRate: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  currency: string;
}

export type EInvoiceResult = { ok: true; officialNumber: string; providerRef: string } | { ok: false; code: string; message: string };

/**
 * Yetkili e-Fatura/e-Arşiv entegratörü soyutlaması (GİB özel entegratörleri için uyarlanır).
 * Gerçek entegrasyon bilgileri olmadan hiçbir sağlayıcı "kesildi" sonucu döndürmez.
 */
export abstract class EInvoiceProvider {
  abstract readonly name: string;
  abstract get configured(): boolean;
  abstract issue(doc: EInvoiceDocument): Promise<EInvoiceResult>;
}

/** Entegratör yapılandırılmamış: resmî belge kesilmez, taslak ve kayıt işlevleri çalışır. */
@Injectable()
export class DisabledEInvoiceProvider extends EInvoiceProvider {
  readonly name = "none";
  get configured() {
    return false;
  }
  async issue(): Promise<EInvoiceResult> {
    return { ok: false, code: "EINVOICE_NOT_CONFIGURED", message: "e-Fatura/e-Arşiv entegratörü yapılandırılmadı; resmî fatura kesilmedi. Taslağı kullanın veya başka sistemde kesilen faturayı kaydedin." };
  }
}

export const einvoiceProviderFor = (env: { EINVOICE_PROVIDER: "none" }): EInvoiceProvider => {
  switch (env.EINVOICE_PROVIDER) {
    default:
      return new DisabledEInvoiceProvider();
  }
};
