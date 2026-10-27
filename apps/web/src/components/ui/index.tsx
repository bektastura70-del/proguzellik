"use client";

import { type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

export { buttonVariants };

/* ----------------------------- Button ----------------------------- */
export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/* ----------------------------- Form ------------------------------- */
const field = "w-full rounded-xl border border-sand-300 bg-white px-3 text-sm placeholder:text-neutral-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(field, "h-10", className)} {...p} />;
});

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-20 py-2", className)} {...p} />;
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-10 pr-8", className)} {...p} />;
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-neutral-700", className)} {...p} />;
}

/** Etiketi alt bileşene (input/select/textarea) erişilebilir şekilde bağlar. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  const auto = React.useId();
  const hintId = `${auto}-hint`;
  let id = auto;
  let child = children;
  if (React.isValidElement<{ id?: string; "aria-describedby"?: string }>(children)) {
    id = children.props.id ?? auto;
    child = React.cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) });
  }
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {child}
      {hint && <p id={hintId} className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/* ----------------------------- Card ------------------------------- */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(35,26,31,0.04)]", className)} {...p} />;
}
export function CardHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sand-100 px-5 py-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}

/* ----------------------------- Badge ------------------------------ */
const badgeTones = {
  neutral: "bg-sand-100 text-neutral-700",
  brand: "bg-brand-100 text-brand-800",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
};
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", badgeTones[tone], className)} {...p} />;
}
export const statusTone = (s: string): keyof typeof badgeTones =>
  ({ COMPLETED: "green", CONFIRMED: "blue", BOOKED: "amber", CANCELLED: "neutral", NO_SHOW: "red", ACTIVE: "green", TRIAL: "brand", PAST_DUE: "amber", SUSPENDED: "red", SENT: "blue", DELIVERED: "green", READ: "green", FAILED: "red", QUEUED: "amber", EXPIRED: "neutral" })[s] as keyof typeof badgeTones ?? "neutral";

/* ----------------------------- Dialog ----------------------------- */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-sand-100 bg-white px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-sand-100" aria-label="Kapat">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------- Table ------------------------------ */
export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string }) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">{children}</tbody>
      </table>
      {!hasRows && <p className="px-4 py-10 text-center text-sm text-neutral-500">{empty ?? "Kayıt yok"}</p>}
    </div>
  );
}
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;

/* ----------------------------- Misc ------------------------------- */
export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-sm text-neutral-500">
        <span>{label}</span>
        {icon && <span className="text-brand-500">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </Card>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "green" | "brand"; children: React.ReactNode }) {
  const t = { red: "border-red-200 bg-red-50 text-red-800", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-800", brand: "border-brand-200 bg-brand-50 text-brand-900" }[tone];
  return <div className={cn("rounded-xl border px-4 py-3 text-sm", t)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600", className)} aria-label="Yükleniyor" />;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-white/60 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-neutral-500">{children}</div>}
    </div>
  );
}

/* ----------------------------- Toast ------------------------------ */
type ToastMsg = { id: number; text: string; tone: "green" | "red" };
const ToastCtx = React.createContext<(text: string, tone?: "green" | "red") => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastMsg[]>([]);
  const push = React.useCallback((text: string, tone: "green" | "red" = "green") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto rounded-xl px-4 py-3 text-sm text-white shadow-lg", t.tone === "green" ? "bg-ink" : "bg-red-600")}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
