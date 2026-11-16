import { District, Province, PROVINCES } from "./tr-admin-units";

const collator = new Intl.Collator("tr", { sensitivity: "base" });

const byCode = new Map<number, Province>(PROVINCES.map((p) => [p.code, p]));
const bySlug = new Map<string, Province>(PROVINCES.map((p) => [p.slug, p]));
const byDistrictCode = new Map<number, { province: Province; district: District }>();
for (const p of PROVINCES) for (const d of p.districts) byDistrictCode.set(d.code, { province: p, district: d });

export const sortTr = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => collator.compare(a.name, b.name));

export function provinceByCode(code: number | null | undefined) {
  return code == null ? undefined : byCode.get(code);
}

export function provinceBySlug(slug: string) {
  return bySlug.get(slug);
}

/** İlçe kodu verilen ile ait değilse undefined. */
export function districtIn(provinceCode: number, districtCode: number) {
  const hit = byDistrictCode.get(districtCode);
  return hit && hit.province.code === provinceCode ? hit.district : undefined;
}

export function districtByCode(code: number) {
  return byDistrictCode.get(code);
}

export function districtBySlug(province: Province, slug: string) {
  return province.districts.find((d) => d.slug === slug);
}

/** Panel seçim kutuları için tüm il/ilçe listesi (Türkçe sıralı). */
export function allUnits() {
  return sortTr(PROVINCES).map((p) => ({ code: p.code, name: p.name, slug: p.slug, districts: sortTr(p.districts) }));
}
