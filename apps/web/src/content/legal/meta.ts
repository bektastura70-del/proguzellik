// Hukuki metinlerin künyesi. Kaynak: Bektaş Tura'nın 04.11.2026 tarihli belgesi (başlık bölümü).
// Adres ve vergi bilgisi kodda tutulmaz; SaaS sahibi panelindeki "Şirket ayarları"ndan gelir.
export const LEGAL_PROVIDER = "BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ";
export const LEGAL_BRAND = "Pro Güzellik";
export const LEGAL_WEBSITE = "https://proguzellik.com";
export const LEGAL_EMAIL = "info@proguzellik.com";
/**
 * Yürürlük tarihi (YYYY-AA-GG). Metinler yayına alınırken SaaS sahibi belirler; boşken künyede gösterilmez.
 * Değiştirildiğinde api/src/auth/auth.service.ts içindeki KVKK_NOTICE_VERSION / TERMS_VERSION da güncellenmelidir.
 */
export const LEGAL_EFFECTIVE_DATE: string | null = null;
