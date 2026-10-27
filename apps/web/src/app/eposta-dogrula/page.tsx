"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Alert, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"busy" | "ok" | "err">("busy");
  const [msg, setMsg] = useState("");
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) {
      setState("err");
      setMsg("Bağlantı eksik veya hatalı.");
      return;
    }
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("err");
        setMsg((e as Error).message);
      });
  }, [token]);
  if (state === "busy") return <Spinner />;
  if (state === "ok") return <Alert tone="green">E-posta adresiniz doğrulandı. <Link href="/panel" className="underline">Panele git</Link></Alert>;
  return <Alert>{msg} Panelden yeni doğrulama e-postası isteyebilirsiniz.</Alert>;
}

export default function VerifyEmailPage() {
  return (
    <AuthCard title="E-posta doğrulama">
      <Suspense><Verify /></Suspense>
    </AuthCard>
  );
}
