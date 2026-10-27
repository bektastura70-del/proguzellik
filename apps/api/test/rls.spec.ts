import { PrismaClient } from "@prisma/client";
import { createTenantWithUser, owner, resetDb } from "./helpers";

/**
 * Veritabanı düzeyinde kiracı izolasyonu testleri.
 * Uygulama kodundan bağımsız olarak RLS'nin kendisini doğrular.
 */
describe("PostgreSQL RLS — kiracı izolasyonu", () => {
  const su = owner();
  const app = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;

  const asTenant = <T>(tenantId: string | null, fn: (tx: any) => Promise<T>) =>
    app.$transaction(async (tx) => {
      if (tenantId) await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
  });

  afterAll(async () => {
    await Promise.all([su.$disconnect(), app.$disconnect()]);
  });

  it("uygulama rolü süper kullanıcı değildir ve RLS'yi atlayamaz", async () => {
    const [r] = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("tenantId sütunu olan HER tabloda RLS açık, zorunlu ve politika tanımlı", async () => {
    const rows = await su.$queryRaw<{ table: string; rls: boolean; force: boolean; policies: number }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenantId')`;
    expect(rows.length).toBeGreaterThan(0);
    const unsafe = rows.filter((r) => !r.rls || !r.force || r.policies === 0);
    expect(unsafe).toEqual([]);
  });

  it("uygulama rolünün erişebildiği tüm tablolarda RLS açık", async () => {
    const rows = await su.$queryRaw<{ table: string }[]>`
      SELECT DISTINCT g.table_name AS table
      FROM information_schema.role_table_grants g
      JOIN pg_class c ON c.relname = g.table_name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE g.grantee = 'app_tenant' AND g.table_schema = 'public' AND c.relrowsecurity = false`;
    expect(rows).toEqual([]);
  });

  it("kiracı bağlamı yoksa hiçbir satır görünmez", async () => {
    await asTenant(null, async (tx) => {
      expect(await tx.tenant.count()).toBe(0);
      expect(await tx.membership.count()).toBe(0);
      expect(await tx.user.count()).toBe(0);
    });
  });

  it("A bağlamında yalnızca A verisi görünür", async () => {
    await asTenant(A.tenant.id, async (tx) => {
      const tenants = await tx.tenant.findMany();
      expect(tenants.map((t: any) => t.id)).toEqual([A.tenant.id]);
      const members = await tx.membership.findMany();
      expect(members.every((m: any) => m.tenantId === A.tenant.id)).toBe(true);
      const users = await tx.user.findMany({ select: { id: true } });
      expect(users.map((u: any) => u.id)).toEqual([A.user.id]);
    });
  });

  it("A bağlamında B'ye ait satır eklenemez", async () => {
    await expect(
      asTenant(A.tenant.id, (tx) =>
        tx.membership.create({ data: { tenantId: B.tenant.id, userId: A.user.id, role: "STAFF" } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("A bağlamında B'nin satırları güncellenemez ve silinemez", async () => {
    await asTenant(A.tenant.id, async (tx) => {
      const upd = await tx.membership.updateMany({ where: { tenantId: B.tenant.id }, data: { role: "STAFF" } });
      expect(upd.count).toBe(0);
      const del = await tx.membership.deleteMany({ where: { tenantId: B.tenant.id } });
      expect(del.count).toBe(0);
      const t = await tx.tenant.updateMany({ where: { id: B.tenant.id }, data: { name: "Ele geçirildi" } });
      expect(t.count).toBe(0);
    });
    const b = await su.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } });
    expect(b.name).toBe("Salon B");
  });

  it("kiracı bağlamı transaction dışına sızmaz (SET LOCAL)", async () => {
    await asTenant(A.tenant.id, async (tx) => expect(await tx.tenant.count()).toBe(1));
    const [r] = await app.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS v`;
    expect(r.v === null || r.v === "").toBe(true);
    expect(await app.tenant.count()).toBe(0);
  });

  it("parola özetleri uygulama rolüne kapalıdır", async () => {
    await expect(
      asTenant(A.tenant.id, (tx) => tx.$queryRaw`SELECT "passwordHash" FROM "User"`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("denetim kayıtları değiştirilemez ve silinemez", async () => {
    await asTenant(A.tenant.id, (tx) =>
      tx.auditLog.create({ data: { tenantId: A.tenant.id, action: "test.event" } }),
    );
    await expect(
      asTenant(A.tenant.id, (tx) => tx.auditLog.updateMany({ data: { action: "değişti" } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(asTenant(A.tenant.id, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(
      /permission denied/i,
    );
  });
});
