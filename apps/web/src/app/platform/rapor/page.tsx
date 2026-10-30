"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ReportTable } from "@/components/platform/finance-admin";
import { Alert, Button, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateTr } from "@/lib/format";

type Report = Parameters<typeof ReportTable>[0]["r"];

function ReportView() {
  const sp = useSearchParams();
  const year = Number(sp.get("yil")) || new Date().getFullYear();
  const gran = sp.get("donem") === "year" ? "year" : "month";
  const r = useApi<Report>(`/platform/finance/report?year=${year}&granularity=${gran}`);
  const company = useApi<{ company: { legalName: string | null } }>("/platform/company");
  if (r.error) return <div className="mx-auto max-w-md p-10"><Alert>{r.error.message}</Alert></div>;
  if (!r.data) return <div className="p-10"><Spinner /></div>;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 print:p-0">
      <div className="mb-6 flex justify-end print:hidden"><Button size="sm" variant="outline" onClick={() => window.print()}>Yazdır / PDF</Button></div>
      <h1 className="text-xl font-semibold">{company.data?.company.legalName ?? "ProGüzellik"} · {year} {gran === "month" ? "aylık" : "yıllık"} gelir raporu</h1>
      <p className="mb-6 text-sm text-neutral-500">Oluşturma: {dateTr(new Date(), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Tahakkuk, tahsilat ve iade ayrı gösterilir; ücretsiz tanımlamalar gelire dahil değildir.</p>
      <ReportTable r={r.data} />
    </div>
  );
}

export default function ReportPrintPage() {
  return <Suspense fallback={<Spinner />}><ReportView /></Suspense>;
}
