import { districtIn, provinceByCode } from "./admin-units";

const lower = (s: string) => s.toLocaleLowerCase("tr");

/**
 * Salonun tam adresi: açık adres (cadde/sokak/no) + mahalle + ilçe / il. Açık adreste zaten yazılı olan parça
 * tekrar eklenmez. Hiçbiri yoksa null. İl/ilçe salonun konum ayarından (SalonListing) gelir.
 */
export function fullAddress(
  street: string | null | undefined,
  neighborhood: string | null | undefined,
  loc?: { provinceCode: number | null; districtCode: number | null } | null,
): string | null {
  const parts: string[] = [];
  const s = street?.trim();
  if (s) parts.push(s);
  const has = (x: string) => (s ? lower(s).includes(lower(x)) : false);
  const n = neighborhood?.trim();
  if (n && !has(n)) parts.push(n);
  const p = provinceByCode(loc?.provinceCode);
  const d = p && loc?.districtCode != null ? districtIn(p.code, loc.districtCode) : undefined;
  if (p && !has(p.name)) parts.push(d ? `${d.name} / ${p.name}` : p.name);
  else if (d && !has(d.name)) parts.push(d.name);
  return parts.length ? parts.join(", ") : null;
}

/**
 * "Yol tarifi al": adres metniyle harita araması. Konum izni istenmez, koordinat saklanmaz ve sunucudan hiçbir
 * yere istek gitmez; bağlantıya dokunan müşterinin telefonu harita uygulamasını (ya da tarayıcıyı) açar.
 */
export function directionsUrl(address: string | null): string | null {
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}
