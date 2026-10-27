import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { API_URL } from "@/lib/server-api";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

/** Kayıt durumunu API'den okur. API'ye ulaşılamazsa kayıt kapalı sayılır. */
async function registrationOpen() {
  try {
    const res = await fetch(`${API_URL}/auth/registration`, { cache: "no-store" });
    if (!res.ok) return false;
    return (await res.json()).enabled === true;
  } catch {
    return false;
  }
}

export default async function RegisterPage() {
  const open = await registrationOpen();
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/"><Logo /></Link>
        {open ? (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Salonunuzu 2 dakikada açın</h1>
            <p className="mb-6 mt-1 text-sm text-neutral-500">14 gün boyunca ücretsiz. Kredi kartı gerekmez.</p>
            <Suspense>
              <RegisterForm />
            </Suspense>
          </>
        ) : (
          <>
            <h1 className="mt-8 font-display text-3xl font-semibold">Yeni kayıtlar yakında açılacak</h1>
            <p className="mt-2 text-sm text-neutral-500" data-testid="registration-closed">
              ProGüzellik şu anda yeni işletme kaydı almıyor. Hesabınız varsa giriş yapabilirsiniz.
            </p>
          </>
        )}
        <p className="mt-6 text-center text-sm text-neutral-500">Zaten hesabınız var mı? <Link href="/giris" className="font-medium text-brand-700">Giriş yapın</Link></p>
      </div>
    </div>
  );
}
