import { loadEnv } from "../../config/env";

/** Müşteri mesajlarının aktarıldığı gerçek sağlayıcı (ortamdan). Mock/kapalıda null. */
export function consentProvider(): "anthropic" | "openai" | null {
  const m = loadEnv().AI_MODE;
  return m === "anthropic" || m === "openai" ? m : null;
}

/** Kanal onayı geçerli mi? Gerçek sağlayıcıda onay o sağlayıcıya verilmiş olmalı (sağlayıcı değişince yeniden onay gerekir). */
export function consentValid(c: { aiDataConsentAt: Date | null; aiDataConsentProvider: string | null }, provider: string | null = consentProvider()) {
  if (!c.aiDataConsentAt) return false;
  if (provider === "anthropic" || provider === "openai") return c.aiDataConsentProvider === provider;
  return true;
}
