import { TenantPwaSettings } from "@prisma/client";
import { loadEnv, pwaEnabled } from "../config/env";
import { Tx } from "../prisma/prisma.service";

export const PWA_FLAGS = [
  "businessPwaEnabled",
  "customerPwaEnabled",
  "customerBookingEnabled",
  "webPushEnabled",
  "customerSessionTrackingEnabled",
] as const;
export type PwaFlag = (typeof PWA_FLAGS)[number];

/** Talimattaki adlar (business_pwa_enabled …) ↔ veritabanı alanları */
export const FLAG_KEYS: Record<PwaFlag, string> = {
  businessPwaEnabled: "business_pwa_enabled",
  customerPwaEnabled: "customer_pwa_enabled",
  customerBookingEnabled: "customer_booking_enabled",
  webPushEnabled: "web_push_enabled",
  customerSessionTrackingEnabled: "customer_session_tracking_enabled",
};

export const DEFAULT_PWA: Omit<TenantPwaSettings, "tenantId" | "updatedAt"> = {
  businessPwaEnabled: false,
  customerPwaEnabled: false,
  customerBookingEnabled: false,
  webPushEnabled: false,
  customerSessionTrackingEnabled: false,
  flagsUpdatedById: null,
  flagsUpdatedAt: null,
  cancelMinHours: 2,
  rescheduleMinHours: 2,
  allowCustomerCancel: true,
  allowCustomerReschedule: true,
  appName: null,
  shortName: null,
  description: null,
  primaryColor: null,
  secondaryColor: null,
  logoAssetId: null,
  iconAssetId: null,
};

export type EffectivePwa = Omit<TenantPwaSettings, "tenantId" | "updatedAt"> & { tenantId: string };

/**
 * İşletmenin etkin PWA ayarları. Ortam ana anahtarı (PWA_ENABLED) kapalıysa tüm bayraklar kapalı sayılır.
 * Müşteri portalı alt özellikleri, portal (customerBookingEnabled) açık değilse çalışmaz.
 */
export async function effectivePwa(db: Pick<Tx, "tenantPwaSettings">, tenantId: string): Promise<EffectivePwa> {
  const row = await db.tenantPwaSettings.findUnique({ where: { tenantId } });
  const s: EffectivePwa = { ...DEFAULT_PWA, ...(row ?? {}), tenantId };
  if (!pwaEnabled(loadEnv())) for (const f of PWA_FLAGS) s[f] = false;
  if (!s.customerBookingEnabled) s.customerSessionTrackingEnabled = false;
  return s;
}
