"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/panel/session";
import type { Customer } from "@/components/panel/types";
import { CustomerForm } from "@/components/panel/customer-form";
import { Badge, Button, Card, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";

export default function CustomersPage() {
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useApi<{ items: Customer[]; total: number; pageSize: number }>(`/customers?page=${page}&pageSize=25${q ? `&search=${encodeURIComponent(q)}` : ""}`);

  return (
    <>
      <PageHeader title="Müşteriler" description={list.data ? `${list.data.total} kayıt` : undefined} action={can("OWNER", "MANAGER", "RECEPTION") && <Button onClick={() => setAdding(true)}><Plus /> Müşteri</Button>} />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(search); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input className="pl-9" placeholder="Ad, telefon veya e-posta" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline">Ara</Button>
      </form>
      <Card>
        {list.loading && !list.data ? <div className="p-6"><Spinner /></div> : (
          <Table head={["Müşteri", "Telefon", "Etiketler", "Kayıt"]} empty="Müşteri bulunamadı">
            {list.data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-sand-50">
                <Td><Link href={`/panel/musteriler/${c.id}`} className="font-medium hover:underline">{c.firstName} {c.lastName}</Link></Td>
                <Td className="text-neutral-600">{c.phone ?? "—"}</Td>
                <Td><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}</div></Td>
                <Td className="text-neutral-500">{dateTr(c.createdAt, { day: "numeric", month: "short", year: "numeric" })}</Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between border-t border-sand-100 px-4 py-3 text-sm">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Önceki</Button>
            <span>Sayfa {page} / {Math.ceil(list.data.total / list.data.pageSize)}</span>
            <Button size="sm" variant="outline" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>Sonraki</Button>
          </div>
        )}
      </Card>
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
    </>
  );
}

