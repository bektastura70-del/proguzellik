import { z } from "zod";

/** bcrypt maliyeti (API ve CLI ortak). */
export const BCRYPT_ROUNDS = 12;

export const passwordSchema = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı")
  .max(200)
  .regex(/[A-Za-zÇĞİÖŞÜçğıöşü]/, "Parola harf içermeli")
  .regex(/[0-9]/, "Parola rakam içermeli");
