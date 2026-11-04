"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { disablePush } from "@/lib/web-push-client";

export interface Membership {
  role: "OWNER" | "MANAGER" | "RECEPTION" | "STAFF";
  tenant: { id: string; name: string; slug: string; status: string; trialEndsAt: string | null; planCode: string; plan: { name: string; features: string[] } };
}
export interface Me {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  emailVerified?: boolean;
  mfaEnabled?: boolean;
  memberships: Membership[];
}

export interface PwaFlags {
  businessPwaEnabled: boolean;
  customerPwaEnabled: boolean;
  customerBookingEnabled: boolean;
  webPushEnabled: boolean;
  customerSessionTrackingEnabled: boolean;
  pushAvailable: boolean;
  vapidPublicKey: string | null;
}

interface Session {
  me: Me | null;
  /** İşletmenin PWA bayrakları (yüklenene kadar null; hata olursa hepsi kapalı sayılır) */
  pwa: PwaFlags | null;
  current: Membership | null;
  tenantId: string | null;
  switchTenant: (id: string) => void;
  can: (...roles: Membership["role"][]) => boolean;
  has: (feature: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

const readCookie = (name: string) =>
  typeof document === "undefined" ? null : (document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pwa, setPwa] = useState<PwaFlags | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<Me>("/auth/me");
    setMe(data);
    const saved = readCookie("pg_tenant");
    const valid = data.memberships.find((m) => m.tenant.id === saved) ?? data.memberships[0];
    if (valid) {
      setTenantId(valid.tenant.id);
      document.cookie = `pg_tenant=${valid.tenant.id}; path=/; samesite=lax; max-age=28800`;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!tenantId) return;
    api<PwaFlags>("/pwa/flags", { tenant: tenantId })
      .then(setPwa)
      .catch(() => setPwa({ businessPwaEnabled: false, customerPwaEnabled: false, customerBookingEnabled: false, webPushEnabled: false, customerSessionTrackingEnabled: false, pushAvailable: false, vapidPublicKey: null }));
  }, [tenantId]);

  const value = useMemo<Session>(() => {
    const current = me?.memberships.find((m) => m.tenant.id === tenantId) ?? null;
    return {
      me,
      pwa,
      current,
      tenantId,
      switchTenant: (id) => {
        document.cookie = `pg_tenant=${id}; path=/; samesite=lax; max-age=28800`;
        setTenantId(id);
        window.location.href = "/panel";
      },
      can: (...roles) => !!current && roles.includes(current.role),
      has: (f) => !!current?.tenant.plan.features.includes(f),
      refresh,
      logout: async () => {
        // Paylaşılan cihazda sonraki kişiye bu kullanıcının bildirimleri gitmesin.
        await disablePush("/", (endpoint) => api("/pwa/push/subscriptions", { method: "DELETE", body: { endpoint } })).catch(() => undefined);
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/giris";
      },
    };
  }, [me, tenantId, refresh, pwa]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider eksik");
  return s;
}
