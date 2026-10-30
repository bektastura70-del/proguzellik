import { z } from "zod";

/** Paket kodu: büyük harf, rakam, alt çizgi (veritabanı CHECK kısıtıyla aynı). */
export const planCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Geçersiz paket kodu");

/** Paket özellik anahtarları (kiracı uygulamasında yetki kapısı). */
export const PLAN_FEATURES = ["CRM", "APPOINTMENTS", "ONLINE_BOOKING", "FINANCE", "PACKAGES", "STOCK", "REPORTS", "WHATSAPP", "AI_ASSISTANT"] as const;

/**
 * Her pakette bulunan temel özellikler. Uygulamada ayrıca kapatılmadıkları için
 * paket tanımında da çıkarılamazlar (paket kartında olmayan bir özellik açık görünmesin).
 */
export const PLAN_CORE_FEATURES = ["CRM", "APPOINTMENTS", "FINANCE", "PACKAGES"] as const;
