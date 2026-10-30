import { API_URL } from "@/lib/server-api";

export type SitePlan = { code: string; name: string; maxStaff: number; monthlyPrice: string; yearlyPrice: string; features: string[]; sortOrder: number };
export type SiteInfo = { company: { legalName: string | null; address: string | null; phone: string | null; email: string }; vat: { rate: string; included: boolean } | null };

/** Paketler veritabanından gelir (SaaS sahibi panelinden yönetilir); burada fiyat yazılmaz. */
export async function getPlans(): Promise<SitePlan[]> {
  try {
    const r = await fetch(`${API_URL}/plans`, { cache: "no-store" });
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

export async function getSiteInfo(): Promise<SiteInfo> {
  try {
    const r = await fetch(`${API_URL}/public/site`, { cache: "no-store" });
    if (r.ok) return r.json();
  } catch {
    /* API'ye ulaşılamazsa yalnızca kurumsal e-posta gösterilir */
  }
  return { company: { legalName: null, address: null, phone: null, email: "info@proguzellik.com" }, vat: null };
}

export const SITE_URL = (process.env.SITE_URL ?? "https://proguzellik.com").replace(/\/$/, "");

/** Paket özellik kodlarının Türkçe karşılıkları */
export const FEATURE_TR: Record<string, string> = {
  CRM: "Müşteri kartı ve geçmişi",
  APPOINTMENTS: "Randevu takvimi",
  ONLINE_BOOKING: "Online rezervasyon sayfası",
  FINANCE: "Kasa, tahsilat ve primler",
  PACKAGES: "Paket ve seans takibi",
  STOCK: "Stok ve sarf malzemeleri",
  REPORTS: "Gelişmiş raporlar",
  WHATSAPP: "WhatsApp hatırlatmaları",
  AI_ASSISTANT: "İşletme asistanı",
};
