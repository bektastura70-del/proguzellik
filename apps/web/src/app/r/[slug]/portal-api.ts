"use client";

/** Müşteri portalı istemcisi: yalnızca bu salonun vekiline (/r/{slug}/api) gider; çerez yolu salonla sınırlıdır. */
export class PortalError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function papi<T = unknown>(slug: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`/r/${slug}/api/${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: { message?: unknown; errors?: { message: string }[]; code?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.errors) && data.errors.length
      ? data.errors.map((e) => e.message).join(", ")
      : typeof data?.message === "string" ? data.message : "Beklenmeyen bir hata oluştu. Bağlantınızı kontrol edip tekrar deneyin.";
    throw new PortalError(res.status, msg, data?.code);
  }
  return data as T;
}

export type AppInfo = {
  slug: string;
  name: string;
  shortName: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  features: { installable: boolean; portal: boolean; packages: boolean; push: boolean };
  rules: { cancelMinHours: number; rescheduleMinHours: number; allowCancel: boolean; allowReschedule: boolean } | null;
  vapidPublicKey: string | null;
};

export type Salon = {
  salon: { name: string; slug: string; phone: string | null; address: string | null };
  services: { id: string; name: string; description: string | null; durationMin: number; price: string; category: { name: string } | null }[];
  staff: { id: string; displayName: string; title: string | null; serviceIds: string[] }[];
};
export type Slot = { staffId: string; staffName: string; startsAt: string; endsAt: string };
export type MyAppointment = {
  id: string; startsAt: string; endsAt: string; status: string; price: string; serviceId: string; staffId: string;
  service: string; staff: string; canCancel: boolean; canReschedule: boolean;
};
export type MyPackage = {
  id: string; name: string; service: string; totalSessions: number; usedSessions: number; remainingSessions: number;
  plannedSessions: number; status: string; purchasedAt: string; expiresAt: string | null;
};
