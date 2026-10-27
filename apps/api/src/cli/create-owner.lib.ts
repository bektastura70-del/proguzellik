import type { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { BCRYPT_ROUNDS, passwordSchema } from "../auth/password";

export const ownerInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Geçerli bir e-posta girin")
    .max(200)
    .refine((e) => !/@proguzellik\.(local|test)$/.test(e), "Demo/test e-posta adresleri kullanılamaz"),
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı").max(120),
  password: passwordSchema,
});

export type OwnerInput = z.input<typeof ownerInputSchema>;

export type OwnerResult =
  | { status: "created"; userId: string; email: string }
  | { status: "exists"; userId: string; email: string };

export class OwnerSetupError extends Error {}

/**
 * İlk SaaS (platform) sahibini oluşturur. Demo verisi oluşturmaz.
 * Tekrar çalıştırmaya dayanıklıdır:
 *  - Aynı e-postayla platform sahibi zaten varsa hiçbir şeyi değiştirmez ("exists").
 *  - E-posta sıradan bir kullanıcıya aitse yetki yükseltmez, hata verir.
 *  - Başka bir platform sahibi varsa `allowAdditional` olmadan ikinci hesap açmaz.
 * Eşzamanlı çalıştırmalar advisory lock ile sıraya girer.
 */
export async function createPlatformOwner(
  db: PrismaClient,
  raw: OwnerInput,
  opts: { allowAdditional?: boolean } = {},
): Promise<OwnerResult> {
  const parsed = ownerInputSchema.safeParse(raw);
  if (!parsed.success) throw new OwnerSetupError(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('proguzellik:create-owner'))`;

    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.isPlatformAdmin) return { status: "exists", userId: existing.id, email: existing.email } as const;
      throw new OwnerSetupError("Bu e-posta sıradan bir kullanıcıya ait; yetki yükseltilmedi. Farklı bir e-posta kullanın.");
    }

    const admins = await tx.user.count({ where: { isPlatformAdmin: true } });
    if (admins > 0 && !opts.allowAdditional) {
      throw new OwnerSetupError(
        `Zaten ${admins} platform sahibi var; yeni hesap açılmadı. Bilerek ek hesap açmak için --additional kullanın.`,
      );
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        isPlatformAdmin: true,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: { action: "platform.owner_created", actorId: user.id, entity: "User", entityId: user.id, metadata: { via: "cli" } },
    });
    return { status: "created", userId: user.id, email: user.email } as const;
  });
}
