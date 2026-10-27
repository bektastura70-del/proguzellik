"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

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

interface Session {
  me: Me | null;
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

  const value = useMemo<Session>(() => {
    const current = me?.memberships.find((m) => m.tenant.id === tenantId) ?? null;
    return {
      me,
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
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/giris";
      },
    };
  }, [me, tenantId, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider eksik");
  return s;
}
