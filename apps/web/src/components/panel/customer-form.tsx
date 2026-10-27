"use client";

import { useState } from "react";
import type { Customer } from "@/components/panel/types";
import { Alert, Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";

export function CustomerForm({ initial, onClose, onSaved }: { initial?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => (f.get(k) as string)?.trim() || undefined;
    const body = {
      firstName: s("firstName"), lastName: s("lastName"), phone: s("phone"), email: s("email"), birthDate: s("birthDate"), gender: s("gender"),
      notes: s("notes"), tags: s("tags")?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
      ...(initial?.kvkkConsentAt ? {} : { kvkkConsent: f.get("kvkk") === "on" }), marketingConsent: f.get("marketing") === "on",
    };
    try {
      const c = await api<Customer>(initial ? `/customers/${initial.id}` : "/customers", { method: initial ? "PATCH" : "POST", body });
      toast(initial ? "Müşteri güncellendi" : "Müşteri eklendi");
      onSaved(c);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Dialog open onClose={onClose} title={initial ? "Müşteriyi düzenle" : "Yeni müşteri"}>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ad"><Input name="firstName" required defaultValue={initial?.firstName} /></Field>
          <Field label="Soyad"><Input name="lastName" required defaultValue={initial?.lastName} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefon"><Input name="phone" type="tel" defaultValue={initial?.phone ?? ""} /></Field>
          <Field label="E-posta"><Input name="email" type="email" defaultValue={initial?.email ?? ""} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Doğum tarihi"><Input name="birthDate" type="date" defaultValue={initial?.birthDate?.slice(0, 10) ?? ""} /></Field>
          <Field label="Cinsiyet">
            <Select name="gender" defaultValue="">
              <option value="">Belirtilmedi</option><option value="KADIN">Kadın</option><option value="ERKEK">Erkek</option><option value="DIGER">Diğer</option>
            </Select>
          </Field>
        </div>
        <Field label="Etiketler" hint="Virgülle ayırın: VIP, Hassas cilt"><Input name="tags" defaultValue={initial?.tags.join(", ")} /></Field>
        <Field label="Notlar"><Textarea name="notes" defaultValue={initial?.notes ?? ""} /></Field>
        {!initial?.kvkkConsentAt && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="kvkk" className="accent-brand-600" /> KVKK aydınlatma metni müşteriye sunuldu ve onaylandı</label>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketing" defaultChecked={initial?.marketingConsent} className="accent-brand-600" /> Ticari ileti (kampanya) izni var</label>
        <Button className="w-full">Kaydet</Button>
      </form>
    </Dialog>
  );
}
