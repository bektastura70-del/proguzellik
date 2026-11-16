import { headers } from "next/headers";
import { API_URL } from "@/lib/server-api";

export type Unit = { code: number; name: string; slug: string; count?: number };
export type DirectorySalon = { slug: string; name: string; logoUrl: string | null; address: string | null; phone: string | null; directionsUrl?: string | null };
export type SalonPage = { province: Unit; district: Unit; salons: DirectorySalon[]; total: number; page: number; pageSize: number };

const UNIT_RE = /^[a-z0-9-]{1,40}$/;

/** İstemci IP'si (yalnızca güvenilir vekil arkasında) API'nin hız sınırı için iletilir; aksi hâlde tüm ziyaretçiler tek IP sayılırdı. */
async function ipHeaders(): Promise<Record<string, string>> {
  if (process.env.TRUST_PROXY !== "1") return {};
  const ip = (await headers()).get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return ip ? { "X-Forwarded-For": ip } : {};
}

/** Herkese açık salon rehberi. null: bulunamadı (404). Hata olursa fırlatır (sayfa hata ekranı gösterir). */
async function get<T>(path: string): Promise<T | null> {
  const r = await fetch(`${API_URL}/public/directory/${path}`, { headers: await ipHeaders(), cache: "no-store" });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`Rehber yüklenemedi (${r.status})`);
  return (await r.json()) as T;
}

export const directory = {
  provinces: () => get<{ provinces: Unit[] }>("provinces"),
  districts: (il: string) => (UNIT_RE.test(il) ? get<{ province: Unit; districts: Unit[] }>(`provinces/${il}`) : Promise.resolve(null)),
  salons: (il: string, ilce: string, page: number) =>
    UNIT_RE.test(il) && UNIT_RE.test(ilce) ? get<SalonPage>(`provinces/${il}/${ilce}?sayfa=${page}`) : Promise.resolve(null),
};
