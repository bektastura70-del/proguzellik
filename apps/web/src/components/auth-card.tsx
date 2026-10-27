import Link from "next/link";
import { Logo } from "@/components/logo";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/"><Logo /></Link>
        <h1 className="mt-8 font-display text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="mb-6 mt-1 text-sm text-neutral-500">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
