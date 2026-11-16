import { directory } from "@/lib/directory";
import { EmptyDirectory, UnitList } from "./directory-ui";

export const dynamic = "force-dynamic";

export default async function ProvincesPage() {
  const data = await directory.provinces();
  const list = data?.provinces ?? [];
  return (
    <>
      <h1 className="text-2xl font-semibold">Salon bul</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-600">Şehrinizi seçin. Yalnızca listelenen salonu olan şehirler görünür.</p>
      {list.length ? <UnitList items={list} hrefOf={(u) => `/salonlar/${u.slug}`} /> : <EmptyDirectory text="Henüz rehberde listelenen salon yok." />}
    </>
  );
}
