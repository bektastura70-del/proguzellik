"use client";

import Link from "next/link";
import { PolicyLinks } from "@/components/policy-links";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

type Preview = { salon: string; email: string; fullName: string; role?: string; existingAccount: boolean };
const INVITE_ROLE_TR: Record<string, string> = { MANAGER: "yönetici", RECEPTION: "resepsiyon görevlisi", STAFF: "personel" };

function InviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [token] = useState(() => params.get("token") ?? "");
  const [info, setInfo] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(token ? null : "Davet bağlantısı eksik veya hatalı.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Belirteç adres çubuğundan ve geçmişten kaldırılır (paylaşılan ekran, tarayıcı geçmişi).
    if (token) window.history.replaceState(null, "", "/davet");
    if (!token) return;
    api<Preview>("/auth/invite/preview", { method: "POST", body: { token } }).then(setInfo, (e) => setErr((e as Error).message));
  }, [token]);

  if (err && !info) return <Alert>{err}</Alert>;
  if (!info) return <Spinner />;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setErr(null);
        if (!info.existingAccount && f.get("p1") !== f.get("p2")) return setErr("Parolalar eşleşmiyor");
        setBusy(true);
        const res = await fetch("/api/auth/accept-invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: f.get("p1"), kvkkAccepted: f.get("kvkk") === "on" }) });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setErr(data.errors?.map((x: { message: string }) => x.message).join(", ") ?? data.message ?? "Davet kabul edilemedi");
        router.push(data.loginRequired ? "/giris?davet=1" : "/panel?hosgeldin=1");
      }}
    >
      <p className="text-sm text-neutral-600">
        {info.role && info.role !== "OWNER" ? (
          <><strong>{info.salon}</strong> işletmesine {INVITE_ROLE_TR[info.role] ?? "ekip üyesi"} olarak davet edildiniz.</>
        ) : (
          <><strong>{info.salon}</strong> işletmesinin yöneticisi olarak davet edildiniz.</>
        )}{" "}Hesap: <strong>{info.email}</strong>
      </p>
      {err && <Alert>{err}</Alert>}
      {info.existingAccount ? (
        <>
          <Alert tone="brand">Bu e-postayla zaten bir hesabınız var. Daveti kabul etmek için mevcut parolanızı girin.</Alert>
          <Field label="Mevcut parolanız"><Input name="p1" type="password" required autoComplete="current-password" /></Field>
        </>
      ) : (
        <>
          <Field label="Parola" hint="En az 10 karakter, harf ve rakam içermeli"><Input name="p1" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <Field label="Parola (tekrar)"><Input name="p2" type="password" required autoComplete="new-password" /></Field>
        </>
      )}
      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" name="kvkk" required className="mt-1 size-4 accent-brand-600" />
        <span>
          <Link href="/kvkk" target="_blank" className="text-brand-700 underline">KVKK Aydınlatma Metni</Link>&apos;ni okudum, kişisel verilerimin hizmetin sunulması amacıyla işlenmesini kabul ediyorum.
        </span>
      </label>
      <PolicyLinks />
      <Button className="w-full" size="lg" disabled={busy}>{busy ? "Kaydediliyor…" : "Daveti kabul et"}</Button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <AuthCard title="ProGüzellik daveti">
      <Suspense><InviteForm /></Suspense>
    </AuthCard>
  );
}
