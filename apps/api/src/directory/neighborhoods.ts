import { NEIGHBORHOODS } from "./tr-neighborhoods";

const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

export interface Neighborhood {
  slug: string;
  /** Adreste ve listede görünen ad: "Kirişçi Mahallesi", beldedeyse "Atatürk Mahallesi (Akçaşehir)" */
  name: string;
}

const cache = new Map<number, Neighborhood[]>();

/** İlçenin resmî mahalle listesi (İçişleri Bakanlığı), Türkçe sıralı. Bilinmeyen ilçe: boş liste. */
export function neighborhoodsOf(districtCode: number | null | undefined): Neighborhood[] {
  if (districtCode == null) return [];
  let list = cache.get(districtCode);
  if (!list) {
    list = (NEIGHBORHOODS[districtCode] ?? [])
      .map(([slug, name, belde]) => ({ slug, name: `${name} Mahallesi${belde ? ` (${belde})` : ""}` }))
      .sort((a, b) => collator.compare(a.name, b.name));
    cache.set(districtCode, list);
  }
  return list;
}

/** Mahalle kodu bu ilçeye ait değilse undefined. */
export function neighborhoodIn(districtCode: number | null | undefined, slug: string | null | undefined) {
  return slug ? neighborhoodsOf(districtCode).find((n) => n.slug === slug) : undefined;
}
