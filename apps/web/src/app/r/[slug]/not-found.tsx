import Link from "next/link";
import { Logo } from "@/components/logo";

export default function SalonNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <Link href="/" aria-label="ProGüzellik ana sayfa"><Logo /></Link>
      <p className="mt-6 text-neutral-600">Bu işletme şu an online randevu almıyor.</p>
    </main>
  );
}
