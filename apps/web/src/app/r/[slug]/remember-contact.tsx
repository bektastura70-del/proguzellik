"use client";

import { forgetContact, SavedContact } from "./customer-memory";

/**
 * "Bilgilerimi bu cihazda hatırla" kutusu. Kayıt yalnızca müşteri randevuyu onaylarken bu kutu işaretliyse yapılır.
 * Bilgiler önceden doldurulduysa "Bilgilerimi unut" hem cihazdaki kaydı siler hem formdaki alanları boşaltır.
 */
export function RememberContact({ contact, onForget, fields }: { contact: SavedContact | null; onForget: () => void; fields: string[] }) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-3 text-sm text-neutral-600">
        <input type="checkbox" name="remember" defaultChecked={!!contact} className="mt-1 size-4 accent-brand-600" data-testid="bilgileri-hatirla" />
        <span>Bilgilerimi bu cihazda hatırla (sonraki randevuda yeniden yazmayın; bilgiler yalnızca bu telefonda/tarayıcıda tutulur).</span>
      </label>
      {contact && (
        <p className="pl-7 text-xs text-neutral-500">
          Bilgileriniz bu cihazdan dolduruldu.{" "}
          <button
            type="button"
            className="underline"
            data-testid="bilgileri-unut"
            onClick={(e) => {
              forgetContact();
              const form = e.currentTarget.form;
              if (form) {
                for (const n of fields) {
                  const el = form.elements.namedItem(n);
                  if (el instanceof HTMLInputElement) el.value = "";
                }
                const r = form.elements.namedItem("remember");
                if (r instanceof HTMLInputElement) r.checked = false;
              }
              onForget();
            }}
          >
            Bilgilerimi unut
          </button>
        </p>
      )}
    </div>
  );
}

/** Formdan iletişim bilgilerini okur; "hatırla" işaretliyse kaydeder, değilse cihazdaki kaydı siler. */
export function contactFromForm(f: FormData): { remember: boolean; contact: SavedContact } {
  return {
    remember: f.get("remember") === "on",
    contact: {
      firstName: String(f.get("firstName") ?? ""),
      lastName: String(f.get("lastName") ?? ""),
      phone: String(f.get("phone") ?? ""),
      email: f.get("email") ? String(f.get("email")) : undefined,
    },
  };
}
