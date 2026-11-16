import { Navigation } from "lucide-react";

const MAPS = "https://www.google.com/maps/search/?api=1&query=";

/**
 * "Yol tarifi al": salonun adresini müşterinin telefonundaki harita uygulamasında (yoksa tarayıcıda) açar.
 * Konum izni istenmez; uygulamanın içinden dokunulduğunda bağlantı uygulama dışında açılır.
 * Yalnızca API'nin ürettiği harita arama bağlantısı kabul edilir.
 */
export function DirectionsLink({ url, className }: { url: string | null | undefined; className?: string }) {
  if (!url || !url.startsWith(MAPS)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className ?? "inline-flex min-h-11 items-center gap-1 font-medium underline-offset-2 hover:underline"}>
      <Navigation className="size-4 shrink-0" aria-hidden />
      Yol tarifi al
    </a>
  );
}
