"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Tarayıcıdan API çağrısı (Next vekili üzerinden, çerezle kimlik doğrulama). */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; tenant?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.tenant) headers["X-Tenant-Id"] = init.tenant;
  const res = await fetch(`/api/p${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.errors) && data.errors.length
      ? data.errors.map((e: { message: string }) => e.message).join(", ")
      : Array.isArray(data?.message) ? data.message.join(", ") : (data?.message ?? "Beklenmeyen bir hata oluştu");
    if (typeof window !== "undefined") {
      if (res.status === 401 && !path.startsWith("/auth/")) window.location.href = "/giris?sure=doldu";
      if (res.status === 403 && data?.code === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/parola-degistir";
    }
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e as ApiError);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
