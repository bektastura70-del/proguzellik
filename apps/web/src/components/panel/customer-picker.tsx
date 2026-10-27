"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import type { Customer } from "./types";

/** Müşteri arama + hızlı ekleme. */
export function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (value || q.trim().length < 2) return setList([]);
    const t = setTimeout(() => {
      api<{ items: Customer[] }>(`/customers?search=${encodeURIComponent(q)}&pageSize=8`).then((r) => setList(r.items)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-sand-300 bg-sand-50 px-3 py-2 text-sm">
        <span><b>{value.firstName} {value.lastName}</b> {value.phone && <span className="text-neutral-500">· {value.phone}</span>}</span>
        <button type="button" className="text-brand-700" onClick={() => onChange(null)}>Değiştir</button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-xl border border-sand-200 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Input id="nc-first" placeholder="Ad" />
          <Input id="nc-last" placeholder="Soyad" />
        </div>
        <Input id="nc-phone" placeholder="Telefon (05xx…)" type="tel" />
        <label className="flex items-center gap-2 text-xs text-neutral-600"><input id="nc-kvkk" type="checkbox" className="accent-brand-600" /> Müşteri KVKK aydınlatma metnini onayladı</label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const g = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
              try {
                const c = await api<Customer>("/customers", {
                  method: "POST",
                  body: { firstName: g("nc-first"), lastName: g("nc-last"), phone: g("nc-phone") || undefined, kvkkConsent: (document.getElementById("nc-kvkk") as HTMLInputElement).checked },
                });
                onChange(c);
                setCreating(false);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Kaydet
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Vazgeç</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Input placeholder="Ad, soyad veya telefonla ara…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-sand-200 bg-white text-sm shadow-sm">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange(c)} className="w-full px-3 py-2 text-left hover:bg-sand-50">
                {c.firstName} {c.lastName} <span className="text-neutral-500">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setCreating(true)} className="mt-2 text-sm text-brand-700">+ Yeni müşteri</button>
    </div>
  );
}
