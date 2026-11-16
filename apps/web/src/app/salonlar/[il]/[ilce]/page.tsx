import Link from "next/link";
import { notFound } from "next/navigation";
import { directory } from "@/lib/directory";
import { Crumbs, EmptyDirectory, SalonCard } from "../../directory-ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ il: string; ilce: string }>; searchParams: Promise<{ sayfa?: string }> };

export default async function SalonsPage({ params, searchParams }: Props) {
  const { il, ilce } = await params;
  const raw = Number((await searchParams).sayfa ?? "1");
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 1;
  const data = await directory.salons(il, ilce, page);
  if (!data) notFound();
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const base = `/salonlar/${data.province.slug}/${data.district.slug}`;
  return (
    <>
      <Crumbs items={[{ href: "/salonlar", label: "Şehirler" }, { href: `/salonlar/${data.province.slug}`, label: data.province.name }, { label: data.district.name }]} />
      <h1 className="text-2xl font-semibold">{data.district.name} salonları</h1>
      <p className="mb-5 mt-1 text-sm text-neutral-600">{data.total} salon</p>
      {data.salons.length ? (
        <ul className="space-y-3">{data.salons.map((s) => <SalonCard key={s.slug} s={s} />)}</ul>
      ) : (
        <EmptyDirectory text={`${data.district.name} için henüz listelenen salon yok.`} />
      )}
      {pages > 1 && (
        <nav aria-label="Sayfalar" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className="min-h-11 content-center underline" href={`${base}?sayfa=${page - 1}`}>Önceki</Link> : <span />}
          <span className="text-neutral-500">Sayfa {page} / {pages}</span>
          {page < pages ? <Link className="min-h-11 content-center underline" href={`${base}?sayfa=${page + 1}`}>Sonraki</Link> : <span />}
        </nav>
      )}
    </>
  );
}
