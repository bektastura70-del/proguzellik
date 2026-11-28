import { z } from "zod";
import { canonicalPhone } from "./phone";

/** Türkiye numaraları tek biçimde (0XXXXXXXXXX) saklanır; +90 / 0 / boşluk farkı mükerrer kayıt oluşturmaz. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{10,15}$/, "Geçersiz telefon numarası"))
  .transform(canonicalPhone);

export const moneySchema = z.coerce.number().min(0).max(10_000_000).multipleOf(0.01);
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
