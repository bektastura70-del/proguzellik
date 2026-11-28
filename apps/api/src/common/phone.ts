/**
 * Telefon numarası biçimleri. Türkiye numaraları tek biçimde saklanır: 0XXXXXXXXXX (11 hane).
 * "0532 123 45 67", "+90 532 123 45 67", "90532…", "532…" aynı numaradır.
 * Yurt dışı / tanınmayan biçimler boşluk ve işaretleri atılmış hâliyle (ör. +4915112345678) kalır.
 */

/** Türkiye numarasıysa 10 haneli ulusal kısmı (5321234567), değilse null. */
export function trNational(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0090") && d.length === 14) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("90")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0") && !plus) d = d.slice(1);
  else if (d.length !== 10 || plus) return null;
  return /^[2-5]\d{9}$/.test(d) ? d : null;
}

/** Saklama biçimi: Türkiye numarası → 0XXXXXXXXXX; diğerleri boşluk/parantez/tire atılmış hâli. */
export function canonicalPhone(raw: string): string {
  const ten = trNational(raw);
  if (ten) return `0${ten}`;
  return raw.trim().replace(/[\s().-]/g, "");
}

/**
 * Aynı numaranın veritabanında görülebilecek tüm yazımları (eski kayıtlar tek biçime çevrilmedi).
 * Arama `phone IN (...)` ile yapılır.
 */
export function phoneVariants(raw: string): string[] {
  const ten = trNational(raw);
  const stripped = raw.trim().replace(/[\s().-]/g, "");
  if (!ten) return [...new Set([stripped, canonicalPhone(raw)])];
  return [...new Set([`0${ten}`, `+90${ten}`, `90${ten}`, ten, `0090${ten}`, stripped])];
}
