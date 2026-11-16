import Link from "next/link";
import { notFound } from "next/navigation";
import { directory } from "@/lib/directory";
import { Crumbs, EmptyDirectory, SalonCard } from "../../directory-ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ il: string; ilce: string }>; searchParams: Promise<{ sayfa?: string; mahalle?: string }> };

export default async function SalonsPage({ params, searchParams }: Props) {
  const { il, ilce } = await params;
  const sp = await searchParams;
  const raw = Number(sp.sayfa ?? "1");
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 1;
  const data = await directory.salons(il, ilce, page, sp.mahalle || undefined);
  if (!data) notFound();
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const root = `/salonlar/${data.province.slug}/${data.district.slug}`;
  const base = data.neighborhood ? `${root}?mahalle=${data.neighborhood.slug}&` : `${root}?`;
  const chip = (on: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${on ? "border-brand-700 bg-brand-700 text-white" : "border-sand-200 bg-white text-neutral-700 hover:border-brand-300"}`;
  return (
    <>
      <Crumbs items={[{ href: "/salonlar", label: "Şehirler" }, { href: `/salonlar/${data.province.slug}`, label: data.province.name }, { label: data.district.name }]} />
      <h1 className="text-2xl font-semibold">{data.neighborhood ? data.neighborhood.name : data.district.name} salonları</h1>
      <p className="mb-4 mt-1 text-sm text-neutral-600">{data.total} salon</p>
      {data.neighborhoods.length > 0 && (
        <nav aria-label="Mahalleye göre" className="mb-5">
          <p className="mb-2 text-sm font-medium text-neutral-700">Mahalle</p>
          <ul className="flex flex-wrap gap-2">
            <li><Link href={root} className={chip(!data.neighborhood)} aria-current={!data.neighborhood ? "page" : undefined}>Tümü</Link></li>
            {data.neighborhoods.map((n) => (
              <li key={n.slug}>
                <Link href={`${root}?mahalle=${n.slug}`} className={chip(data.neighborhood?.slug === n.slug)} aria-current={data.neighborhood?.slug === n.slug ? "page" : undefined}>
                  {n.name.replace(/ Mahallesi/, "")} <span className="ml-1 opacity-70">{n.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {data.salons.length ? (
        <ul className="space-y-3">{data.salons.map((s) => <SalonCard key={s.slug} s={s} />)}</ul>
      ) : (
        <EmptyDirectory text={`${data.district.name} için henüz listelenen salon yok.`} />
      )}
      {pages > 1 && (
        <nav aria-label="Sayfalar" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link className="min-h-11 content-center underline" href={`${base}sayfa=${page - 1}`}>Önceki</Link> : <span />}
          <span className="text-neutral-500">Sayfa {page} / {pages}</span>
          {page < pages ? <Link className="min-h-11 content-center underline" href={`${base}sayfa=${page + 1}`}>Sonraki</Link> : <span />}
        </nav>
      )}
    </>
  );
}
