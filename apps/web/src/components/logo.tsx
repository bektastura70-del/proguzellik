import { cn } from "@/lib/utils";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-xl font-semibold", light ? "text-white" : "text-ink", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="10" fill="#933c63" />
        <path d="M10 22c0-6 3-11 6-11s6 5 6 11" fill="none" stroke="#f6e7ee" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16" cy="9" r="2.4" fill="#f6e7ee" />
      </svg>
      <span>
        Pro<span className={light ? "text-brand-200" : "text-brand-600"}>Güzellik</span>
      </span>
    </span>
  );
}
