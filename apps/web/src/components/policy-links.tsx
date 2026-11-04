import Link from "next/link";

/** Kayıt, deneme ve davet ekranlarında hukuki metinlere bağlantı satırı. */
export function PolicyLinks({ className = "" }: { className?: string }) {
  const a = "text-brand-700 underline";
  return (
    <p className={`text-xs text-neutral-500 ${className}`} data-testid="policy-links">
      İlgili metinler:{" "}
      <Link href="/kvkk" target="_blank" className={a}>KVKK Aydınlatma Metni</Link>,{" "}
      <Link href="/gizlilik-politikasi" target="_blank" className={a}>Gizlilik Politikası</Link>,{" "}
      <Link href="/cerez-politikasi" target="_blank" className={a}>Çerez Politikası</Link> ve{" "}
      <Link href="/kullanim-kosullari" target="_blank" className={a}>Kullanım Koşulları</Link>.
    </p>
  );
}
