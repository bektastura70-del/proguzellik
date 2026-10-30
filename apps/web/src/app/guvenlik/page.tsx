"use client";

import { KeyRound, LaptopMinimal, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Spinner, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr } from "@/lib/format";

type Me = { email: string; fullName: string; isPlatformAdmin: boolean; mfaEnabled: boolean; emailVerified: boolean; recoveryCodesLeft: number; memberships: unknown[] };
type Sess = { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; mfaVerified: boolean; current: boolean };

function device(ua: string | null) {
  if (!ua) return "Bilinmeyen cihaz";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Cihaz";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Tarayıcı";
  return `${br} · ${os}`;
}

function SecurityInner() {
  const toast = useToast();
  const params = useSearchParams();
  const me = useApi<Me>("/auth/me");
  const sessions = useApi<Sess[]>("/auth/sessions");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"setup" | "disable" | "regen" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  if (!me.data) return <Spinner />;
  const m = me.data;
  const home = m.isPlatformAdmin ? "/platform" : "/panel";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Logo />
        <Link href={home} className="text-sm text-brand-700">← Panele dön</Link>
      </header>
      <h1 className="font-display text-3xl font-semibold">Hesap güvenliği</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">{m.fullName} · {m.email}</p>
      {params.get("zorunlu") && !m.mfaEnabled && (
        <div className="mb-6"><Alert tone="amber">Bu hesap veya işletme için <b>iki adımlı doğrulama zorunlu</b>. Devam etmek için aşağıdan etkinleştirin.</Alert></div>
      )}
      {!m.emailVerified && (
        <div className="mb-6">
          <Alert tone="amber">
            E-posta adresiniz doğrulanmadı.{" "}
            <button className="font-medium underline" onClick={async () => {
              try { await api("/auth/resend-verification", { method: "POST" }); toast("Doğrulama e-postası gönderildi"); } catch (e) { toast((e as Error).message, "red"); }
            }}>Doğrulama e-postasını tekrar gönder</button>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader title="İki adımlı doğrulama (2FA)" description="Giriş yaparken parolanıza ek olarak telefonunuzdaki kimlik doğrulama uygulamasından kod istenir." action={m.mfaEnabled ? <Badge tone="green">Açık</Badge> : <Badge tone="amber">Kapalı</Badge>} />
        <CardBody className="space-y-3 text-sm">
          {m.mfaEnabled ? (
            <>
              <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /> Hesabınız iki adımlı doğrulama ile korunuyor. Kalan kurtarma kodu: <b>{m.recoveryCodesLeft}</b></p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => { setErr(null); setDialog("regen"); }}><KeyRound /> Yeni kurtarma kodları</Button>
                {!m.isPlatformAdmin && <Button variant="ghost" className="text-red-600" onClick={() => { setErr(null); setDialog("disable"); }}><ShieldOff /> 2FA'yı kapat</Button>}
              </div>
            </>
          ) : (
            <>
              <p>Google Authenticator, Microsoft Authenticator, 1Password veya benzeri bir uygulama kullanabilirsiniz.</p>
              <Button onClick={() => { setErr(null); setSetup(null); setQr(null); setCodes(null); setDialog("setup"); }}><ShieldCheck /> 2FA'yı etkinleştir</Button>
            </>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Açık oturumlar"
          description="Tanımadığınız bir oturum görürseniz kapatın ve parolanızı değiştirin."
          action={<Button size="sm" variant="outline" onClick={async () => {
            try { const r = await api<{ revoked: number }>("/auth/logout-others", { method: "POST" }); toast(`${r.revoked} oturum kapatıldı`); sessions.reload(); } catch (e) { toast((e as Error).message, "red"); }
          }}>Diğer tüm oturumları kapat</Button>}
        />
        <ul className="divide-y divide-sand-100">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm" data-testid="session-row">
              <div className="flex items-center gap-3">
                <LaptopMinimal className="size-5 text-neutral-400" />
                <div>
                  <div className="font-medium">{device(s.userAgent)} {s.current && <Badge tone="brand">Bu cihaz</Badge>} {s.mfaVerified && <Badge tone="green">2FA</Badge>}</div>
                  <div className="text-xs text-neutral-500">Son etkinlik {dateTimeTr(s.lastSeenAt)} · Açılış {dateTimeTr(s.createdAt)}{s.ip ? ` · ${s.ip}` : ""}</div>
                </div>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={async () => {
                try { await api(`/auth/sessions/${s.id}`, { method: "DELETE" }); toast("Oturum kapatıldı"); sessions.reload(); } catch (e) { toast((e as Error).message, "red"); }
              }}>Kapat</Button>}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Parola" />
        <CardBody><Link className="text-sm text-brand-700" href="/parola-degistir">Parolamı değiştir</Link> <span className="text-xs text-neutral-500">(diğer cihazlardaki oturumlar kapatılır)</span></CardBody>
      </Card>

      {dialog === "setup" && (
        <Dialog open onClose={() => { setDialog(null); if (codes) me.reload(); }} title="İki adımlı doğrulamayı etkinleştir">
          {err && <div className="mb-3"><Alert>{err}</Alert></div>}
          {codes ? (
            <div className="space-y-3">
              <Alert tone="green">2FA etkinleştirildi. Bu kurtarma kodlarını şimdi güvenli bir yere kaydedin; tekrar gösterilmeyecek.</Alert>
              <ul className="grid grid-cols-2 gap-2 rounded-xl bg-sand-100 p-3 font-mono text-sm" data-testid="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast("Kodlar kopyalandı"))}>Kopyala</Button>
                <Button onClick={() => { setDialog(null); me.reload(); sessions.reload(); }}>Kaydettim</Button>
              </div>
            </div>
          ) : !setup ? (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try { setSetup(await api("/auth/mfa/setup", { method: "POST", body: { password: new FormData(e.currentTarget).get("password") } })); } catch (e) { setErr((e as Error).message); }
            }}>
              <Field label="Parolanızı doğrulayın"><Input name="password" type="password" required autoComplete="current-password" /></Field>
              <Button className="w-full">Devam</Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try {
                const r = await api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code: (new FormData(e.currentTarget).get("code") as string).replace(/\s/g, "") } });
                setCodes(r.recoveryCodes);
              } catch (e) { setErr((e as Error).message); }
            }}>
              <p className="text-sm text-neutral-600">1. Uygulamanızla QR kodu okutun veya anahtarı elle girin.</p>
              <div className="flex flex-col items-center gap-2">
                {qr ? <img src={qr} alt="2FA QR kodu" width={220} height={220} className="rounded-lg border border-sand-200" /> : <Spinner />}
                <code className="break-all rounded-lg bg-sand-100 px-3 py-1.5 text-xs" data-testid="mfa-secret">{setup.secret}</code>
              </div>
              <p className="text-sm text-neutral-600">2. Uygulamada görünen 6 haneli kodu girin.</p>
              <Field label="Doğrulama kodu"><Input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" /></Field>
              <Button className="w-full">Etkinleştir</Button>
            </form>
          )}
        </Dialog>
      )}

      {(dialog === "disable" || dialog === "regen") && (
        <Dialog open onClose={() => setDialog(null)} title={dialog === "disable" ? "2FA'yı kapat" : "Yeni kurtarma kodları"}>
          {codes && dialog === "regen" ? (
            <div className="space-y-3">
              <Alert tone="green">Eski kodlar geçersiz oldu. Yeni kodlarınızı kaydedin.</Alert>
              <ul className="grid grid-cols-2 gap-2 rounded-xl bg-sand-100 p-3 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              <Button onClick={() => { setDialog(null); setCodes(null); me.reload(); }}>Kaydettim</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setErr(null);
              try {
                const body = { password: f.get("password"), code: (f.get("code") as string).replace(/\s/g, "") };
                if (dialog === "disable") {
                  await api("/auth/mfa/disable", { method: "POST", body });
                  toast("2FA kapatıldı");
                  setDialog(null);
                  me.reload();
                } else {
                  setCodes((await api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body })).recoveryCodes);
                }
              } catch (e) { setErr((e as Error).message); }
            }}>
              {err && <Alert>{err}</Alert>}
              <Field label="Parola"><Input name="password" type="password" required autoComplete="current-password" /></Field>
              <Field label="Doğrulama kodu"><Input name="code" required inputMode="numeric" maxLength={7} /></Field>
              <Button variant={dialog === "disable" ? "danger" : "default"} className="w-full">{dialog === "disable" ? "2FA'yı kapat" : "Kodları yenile"}</Button>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SecurityInner />
    </Suspense>
  );
}
