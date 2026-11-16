import { notFound } from "next/navigation";
import { directory } from "@/lib/directory";
import { Crumbs, EmptyDirectory, UnitList } from "../directory-ui";

export const dynamic = "force-dynamic";

export default async function DistrictsPage({ params }: { params: Promise<{ il: string }> }) {
  const { il } = await params;
  const data = await directory.districts(il);
  if (!data) notFound();
  return (
    <>
      <Crumbs items={[{ href: "/salonlar", label: "Şehirler" }, { label: data.province.name }]} />
      <h1 className="text-2xl font-semibold">{data.province.name}</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-600">İlçenizi seçin.</p>
      {data.districts.length ? (
        <UnitList items={data.districts} hrefOf={(u) => `/salonlar/${data.province.slug}/${u.slug}`} />
      ) : (
        <EmptyDirectory text={`${data.province.name} için henüz listelenen salon yok.`} />
      )}
    </>
  );
}
