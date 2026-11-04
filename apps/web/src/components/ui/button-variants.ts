import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/** Sunucu bileşenlerinde de kullanılabilir ("use client" içermez). */
const base = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        secondary: "bg-sand-100 text-ink hover:bg-sand-200",
        outline: "border border-sand-300 bg-white hover:bg-sand-100",
        ghost: "hover:bg-sand-100",
        danger: "bg-red-600 text-white hover:bg-red-700",
        link: "text-brand-700 underline-offset-4 hover:underline",
      },
      size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", lg: "h-12 px-6 text-base", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);


/**
 * Ek sınıflar (className) temel sınıflarla çakışırsa sonradan verilen kazanır.
 * Örn. "hidden sm:inline-flex" temel "inline-flex"i ezer; aksi hâlde Tailwind 4'te "inline-flex" kazanıyordu.
 */
export function buttonVariants({ className, ...variants }: VariantProps<typeof base> & { className?: string } = {}) {
  return twMerge(base(variants), className);
}
