import { permanentRedirect } from "next/navigation";

/** Eski adres: Gizlilik Politikası /gizlilik-politikasi adresine taşındı. */
export default function LegacyGizlilik() {
  permanentRedirect("/gizlilik-politikasi");
}
