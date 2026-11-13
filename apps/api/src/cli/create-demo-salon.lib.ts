import type { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { BCRYPT_ROUNDS } from "../auth/password";

/**
 * Mağaza incelemesi (App Store / Google Play) ve tanıtım için GERÇEK VERİ İÇERMEYEN demo salon.
 * Oluşturulanlar: işletme (uzun deneme süresiyle), işletme sahibi hesabı, örnek hizmetler, iki örnek personel ve çalışma saatleri,
 * müşteri portalı/online randevu bayrakları (yalnızca bu işletmede). Müşteri, randevu, ödeme kaydı oluşturulmaz.
 */
export const DEMO_DEFAULTS = {
  slug: "demo-salon",
  name: "Pro Güzellik Demo Salonu",
  ownerEmail: "demo-isletme@proguzellik.com",
  ownerName: "Demo İşletme Sahibi",
  trialDays: 730,
} as const;

const SERVICES = [
  { name: "Saç kesimi ve fön", durationMin: 45, price: 450, color: "#933c63" },
  { name: "Manikür", durationMin: 40, price: 350, color: "#b0678a" },
  { name: "Klasik cilt bakımı", durationMin: 60, price: 900, color: "#6b8f71" },
  { name: "Kaş tasarımı", durationMin: 20, price: 200, color: "#c08a4b" },
];
const STAFF = ["Ayşe (demo)", "Elif (demo)"];
/** Pazartesi–Cumartesi 10:00–19:00 (0 = Pazar) */
const HOURS = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 600, endMin: 1140 }));

export const demoInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/, "Adres yalnızca küçük harf, rakam ve tire içermeli"),
  name: z.string().trim().min(3).max(80),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerName: z.string().trim().min(2).max(120),
  trialDays: z.number().int().min(30).max(1095),
});
export type DemoInput = z.infer<typeof demoInputSchema>;

export class DemoSetupError extends Error {}

/** Okunabilir, tahmin edilemez parola: harf + rakam, karışabilecek karakterler yok (yaklaşık 95 bit). */
export function generatePassword(len = 18) {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  for (;;) {
    let p = "";
    for (let i = 0; i < len; i++) p += all[randomInt(all.length)];
    if (/[A-Za-z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

export type DemoResult =
  | { status: "created"; tenantId: string; slug: string; ownerEmail: string; password: string }
  | { status: "exists"; tenantId: string; slug: string; ownerEmail: string; password?: string };

/**
 * Tekrar çalıştırmaya dayanıklı: salon zaten varsa (aynı adres ve aynı sahip) hiçbir şey eklemez.
 * `resetPassword` verilirse yalnızca demo sahibinin parolası yenilenir, 2FA ve kilit kaldırılır (inceleme ekibi kilitlerse diye).
 * Adres veya e-posta başka bir işletmeye/kullanıcıya aitse hiçbir şey değiştirmez, hata verir.
 */
export async function createDemoSalon(
  dbs: { platform: PrismaClient; tenant: PrismaClient },
  raw: Partial<DemoInput> = {},
  opts: { resetPassword?: boolean } = {},
): Promise<DemoResult> {
  const result = await createAccounts(dbs.platform, raw, opts);
  await seedCatalog(dbs.tenant, result.tenantId);
  return result;
}

/**
 * Örnek hizmet, personel ve çalışma saatleri: işletme rolüyle (RLS altında) yazılır.
 * Salonda hiç hizmet yoksa eklenir; varsa dokunulmaz (yarıda kalan bir çalıştırma tekrarla tamamlanır).
 */
async function seedCatalog(db: PrismaClient, tenantId: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '', true)`;
    if ((await tx.service.count({ where: { tenantId } })) > 0) return;
    const services = [];
    for (const s of SERVICES) services.push(await tx.service.create({ data: { tenantId, ...s } }));
    for (const displayName of STAFF) {
      const st = await tx.staffMember.create({ data: { tenantId, displayName, title: "Güzellik uzmanı" } });
      await tx.staffService.createMany({ data: services.map((s) => ({ tenantId, staffId: st.id, serviceId: s.id })) });
      await tx.workingHour.createMany({ data: HOURS.map((h) => ({ tenantId, staffId: st.id, ...h })) });
    }
  });
}

/** İşletme, sahip hesabı, üyelik ve portal bayrakları: platform rolüyle. */
async function createAccounts(db: PrismaClient, raw: Partial<DemoInput>, opts: { resetPassword?: boolean }): Promise<DemoResult> {
  const parsed = demoInputSchema.safeParse({ ...DEMO_DEFAULTS, ...raw });
  if (!parsed.success) throw new DemoSetupError(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('proguzellik:create-demo-salon'))`;
    const tenant = await tx.tenant.findUnique({ where: { slug: input.slug } });
    const user = await tx.user.findUnique({ where: { email: input.ownerEmail } });

    if (tenant || user) {
      const membership = tenant && user ? await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } }) : null;
      if (!tenant || !user || membership?.role !== "OWNER" || tenant.email !== input.ownerEmail || user.isPlatformAdmin) {
        throw new DemoSetupError("Bu adres veya e-posta demo dışı bir işletmeye/kullanıcıya ait; hiçbir şey değiştirilmedi.");
      }
      if (!opts.resetPassword) return { status: "exists", tenantId: tenant.id, slug: tenant.slug, ownerEmail: user.email } as const;
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, isActive: true, mustChangePassword: false, failedLogins: 0, lockedUntil: null, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaFailedAttempts: 0 },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, action: "demo.owner_password_reset", entity: "User", entityId: user.id, metadata: { via: "cli" } } });
      return { status: "exists", tenantId: tenant.id, slug: tenant.slug, ownerEmail: user.email, password } as const;
    }

    const now = new Date();
    const created = await tx.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        status: "TRIAL",
        trialEndsAt: new Date(now.getTime() + input.trialDays * 86_400_000),
        email: input.ownerEmail,
        address: "Demo salon: gerçek bir işletme değildir",
        onlineBookingEnabled: true,
      },
    });
    const owner = await tx.user.create({ data: { email: input.ownerEmail, fullName: input.ownerName, passwordHash, emailVerifiedAt: now } });
    await tx.membership.create({ data: { tenantId: created.id, userId: owner.id, role: "OWNER" } });
    await tx.tenantPwaSettings.create({
      data: { tenantId: created.id, businessPwaEnabled: true, customerPwaEnabled: true, customerBookingEnabled: true, customerSessionTrackingEnabled: true, flagsUpdatedAt: now },
    });
    await tx.auditLog.create({
      data: { tenantId: created.id, actorId: owner.id, action: "demo.salon_created", entity: "Tenant", entityId: created.id, metadata: { via: "cli", trialDays: input.trialDays } },
    });
    return { status: "created", tenantId: created.id, slug: created.slug, ownerEmail: owner.email, password } as const;
  });
}
